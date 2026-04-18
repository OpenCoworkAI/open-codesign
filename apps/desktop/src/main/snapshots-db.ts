/**
 * SQLite persistence layer for design snapshots.
 *
 * Uses better-sqlite3 (synchronous API — safe in the Electron main process,
 * which is the only caller). WAL mode for concurrent read performance.
 *
 * Call initSnapshotsDb(dbPath) once at app start.
 * Call initInMemoryDb() in tests to get an isolated in-memory instance.
 */

import { createRequire } from 'node:module';
import type { Design, DesignSnapshot, SnapshotCreateInput } from '@open-codesign/shared';
import type BetterSqlite3 from 'better-sqlite3';

// better-sqlite3 is a native module — require() instead of import.
const require = createRequire(import.meta.url);

type Database = BetterSqlite3.Database;

let singleton: Database | null = null;

function openDatabase(path: string, options?: BetterSqlite3.Options): Database {
  const Database = require('better-sqlite3') as typeof BetterSqlite3;
  return new Database(path, options);
}

function applySchema(db: Database): void {
  // foreign_keys is a per-connection pragma and defaults to OFF; enabling it
  // here is what makes the ON DELETE CASCADE / SET NULL clauses below actually fire.
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS designs (
      id            TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL DEFAULT 1,
      name          TEXT NOT NULL DEFAULT 'Untitled design',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS design_snapshots (
      id             TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL DEFAULT 1,
      design_id      TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
      parent_id      TEXT REFERENCES design_snapshots(id) ON DELETE SET NULL,
      type           TEXT NOT NULL CHECK(type IN ('initial','edit','fork')),
      prompt         TEXT,
      artifact_type  TEXT NOT NULL CHECK(artifact_type IN ('html','react','svg')),
      artifact_source TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      message        TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_design_created
      ON design_snapshots(design_id, created_at DESC);
  `);
}

/** Initialize and return the singleton DB instance for production use. */
export function initSnapshotsDb(dbPath: string): Database {
  if (singleton) return singleton;
  const db = openDatabase(dbPath);
  try {
    applySchema(db);
  } catch (cause) {
    // Don't cache a half-open DB — let the next caller retry from scratch.
    try {
      db.close();
    } catch {
      /* swallow secondary close failure */
    }
    throw cause;
  }
  singleton = db;
  return singleton;
}

/**
 * Boot-time wrapper that never throws. Returns either the live DB or the
 * underlying error, so the caller can degrade gracefully without blocking
 * the BrowserWindow from opening when snapshot persistence is unavailable
 * (e.g. corrupt file, permission denied, native binding missing).
 */
export function safeInitSnapshotsDb(
  dbPath: string,
): { ok: true; db: Database } | { ok: false; error: Error } {
  try {
    return { ok: true, db: initSnapshotsDb(dbPath) };
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    return { ok: false, error };
  }
}

/** For use in Vitest tests only — returns a fresh isolated in-memory instance. */
export function initInMemoryDb(): Database {
  // ':memory:' as filename creates an in-memory database in better-sqlite3.
  const db = openDatabase(':memory:');
  applySchema(db);
  return db;
}

// ---------------------------------------------------------------------------
// Row types (snake_case columns from SQLite)
// ---------------------------------------------------------------------------

interface DesignRow {
  id: string;
  schema_version: number;
  name: string;
  created_at: string;
  updated_at: string;
}

interface SnapshotRow {
  id: string;
  schema_version: number;
  design_id: string;
  parent_id: string | null;
  type: string;
  prompt: string | null;
  artifact_type: string;
  artifact_source: string;
  created_at: string;
  message: string | null;
}

// ---------------------------------------------------------------------------
// Row → domain type mappers
// ---------------------------------------------------------------------------

function rowToDesign(row: DesignRow): Design {
  return {
    schemaVersion: 1,
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSnapshot(row: SnapshotRow): DesignSnapshot {
  return {
    schemaVersion: 1,
    id: row.id,
    designId: row.design_id,
    parentId: row.parent_id,
    type: row.type as DesignSnapshot['type'],
    prompt: row.prompt,
    artifactType: row.artifact_type as DesignSnapshot['artifactType'],
    artifactSource: row.artifact_source,
    createdAt: row.created_at,
    ...(row.message !== null ? { message: row.message } : {}),
  };
}

// ---------------------------------------------------------------------------
// Public DB functions
// ---------------------------------------------------------------------------

export function createDesign(db: Database, name = 'Untitled design'): Design {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO designs (id, schema_version, name, created_at, updated_at) VALUES (?, 1, ?, ?, ?)',
  ).run(id, name, now, now);
  return rowToDesign(db.prepare('SELECT * FROM designs WHERE id = ?').get(id) as DesignRow);
}

export function listDesigns(db: Database): Design[] {
  // updated_at bumps on each new snapshot, so recently edited designs surface first;
  // created_at is the tiebreaker for designs that have never been edited.
  return (
    db
      .prepare('SELECT * FROM designs ORDER BY updated_at DESC, created_at DESC')
      .all() as DesignRow[]
  ).map(rowToDesign);
}

export function createSnapshot(db: Database, input: SnapshotCreateInput): DesignSnapshot {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO design_snapshots
       (id, schema_version, design_id, parent_id, type, prompt, artifact_type, artifact_source, created_at, message)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.designId,
    input.parentId,
    input.type,
    input.prompt,
    input.artifactType,
    input.artifactSource,
    now,
    input.message ?? null,
  );
  // Bump the parent design's updated_at so clients can sort designs by activity.
  db.prepare('UPDATE designs SET updated_at = ? WHERE id = ?').run(now, input.designId);
  return rowToSnapshot(
    db.prepare('SELECT * FROM design_snapshots WHERE id = ?').get(id) as SnapshotRow,
  );
}

export function listSnapshots(db: Database, designId: string): DesignSnapshot[] {
  return (
    db
      .prepare('SELECT * FROM design_snapshots WHERE design_id = ? ORDER BY created_at DESC')
      .all(designId) as SnapshotRow[]
  ).map(rowToSnapshot);
}

export function getSnapshot(db: Database, id: string): DesignSnapshot | null {
  const row = db.prepare('SELECT * FROM design_snapshots WHERE id = ?').get(id) as
    | SnapshotRow
    | undefined;
  return row ? rowToSnapshot(row) : null;
}

export function deleteSnapshot(db: Database, id: string): void {
  db.prepare('DELETE FROM design_snapshots WHERE id = ?').run(id);
}
