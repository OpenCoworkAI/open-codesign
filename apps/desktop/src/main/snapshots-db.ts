/**
 * SQLite persistence layer for designs, snapshots, and chat messages.
 *
 * Uses better-sqlite3 (synchronous API — safe in the Electron main process,
 * which is the only caller). WAL mode for concurrent read performance.
 *
 * Call initSnapshotsDb(dbPath) once at app start.
 * Call initInMemoryDb() in tests to get an isolated in-memory instance.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import type {
  Design,
  DesignMessage,
  DesignSnapshot,
  SnapshotCreateInput,
} from '@open-codesign/shared';
import type BetterSqlite3 from 'better-sqlite3';

// better-sqlite3 is a native module — require() instead of import.
const require = createRequire(import.meta.url);

type Database = BetterSqlite3.Database;

let singleton: Database | null = null;

/**
 * Resolve the .node binary that matches the active runtime ABI.
 *
 * scripts/install-sqlite-bindings.cjs stages two prebuilds side by side:
 *   build/Release/better_sqlite3.node-node.node      ← Node 22 (vitest)
 *   build/Release/better_sqlite3.node-electron.node  ← Electron (app)
 * so that one `pnpm install` covers both runtimes without
 * an electron-rebuild step that toggles the single default binary.
 */
function resolveNativeBinding(): string {
  const isElectron = typeof process.versions.electron === 'string';
  const filename = isElectron
    ? 'better_sqlite3.node-electron.node'
    : 'better_sqlite3.node-node.node';
  const pkgJson = require.resolve('better-sqlite3/package.json');
  return path.join(path.dirname(pkgJson), 'build', 'Release', filename);
}

function openDatabase(filename: string, options?: BetterSqlite3.Options): Database {
  const Database = require('better-sqlite3') as typeof BetterSqlite3;
  return new Database(filename, { ...options, nativeBinding: resolveNativeBinding() });
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

    CREATE TABLE IF NOT EXISTS design_messages (
      design_id   TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
      ordinal     INTEGER NOT NULL,
      role        TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      PRIMARY KEY (design_id, ordinal)
    );
  `);

  applyAdditiveMigrations(db);
}

/**
 * Additive column migrations.
 *
 * Each block uses PRAGMA table_info to detect whether the column already
 * exists; SQLite has no IF NOT EXISTS for ADD COLUMN. Safe to run on every
 * boot.
 */
function applyAdditiveMigrations(db: Database): void {
  type ColumnInfo = { name: string };
  const designCols = (db.prepare('PRAGMA table_info(designs)').all() as ColumnInfo[]).map(
    (c) => c.name,
  );
  if (!designCols.includes('thumbnail_text')) {
    db.exec('ALTER TABLE designs ADD COLUMN thumbnail_text TEXT');
  }
  if (!designCols.includes('deleted_at')) {
    db.exec('ALTER TABLE designs ADD COLUMN deleted_at TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_designs_deleted_at ON designs(deleted_at)');
  }
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
  thumbnail_text: string | null;
  deleted_at: string | null;
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

interface MessageRow {
  design_id: string;
  ordinal: number;
  role: string;
  content: string;
  created_at: string;
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
    thumbnailText: row.thumbnail_text ?? null,
    deletedAt: row.deleted_at ?? null,
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

function rowToMessage(row: MessageRow): DesignMessage {
  return {
    schemaVersion: 1,
    designId: row.design_id,
    role: row.role as DesignMessage['role'],
    content: row.content,
    ordinal: row.ordinal,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Designs
// ---------------------------------------------------------------------------

export function createDesign(db: Database, name = 'Untitled design'): Design {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO designs (id, schema_version, name, created_at, updated_at) VALUES (?, 1, ?, ?, ?)',
  ).run(id, name, now, now);
  return rowToDesign(db.prepare('SELECT * FROM designs WHERE id = ?').get(id) as DesignRow);
}

export function getDesign(db: Database, id: string): Design | null {
  const row = db.prepare('SELECT * FROM designs WHERE id = ?').get(id) as DesignRow | undefined;
  return row ? rowToDesign(row) : null;
}

export function listDesigns(db: Database): Design[] {
  // Soft-deleted designs are hidden from the default list. updated_at bumps on
  // each new snapshot so recently-edited designs surface first; created_at is
  // the tiebreaker for designs that have never been edited.
  return (
    db
      .prepare(
        'SELECT * FROM designs WHERE deleted_at IS NULL ORDER BY updated_at DESC, created_at DESC',
      )
      .all() as DesignRow[]
  ).map(rowToDesign);
}

export function renameDesign(db: Database, id: string, name: string): Design | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error('Design name must not be empty');
  }
  const now = new Date().toISOString();
  const result = db
    .prepare('UPDATE designs SET name = ?, updated_at = ? WHERE id = ?')
    .run(trimmed, now, id);
  if (result.changes === 0) return null;
  return getDesign(db, id);
}

export function setDesignThumbnail(
  db: Database,
  id: string,
  thumbnailText: string | null,
): Design | null {
  const result = db
    .prepare('UPDATE designs SET thumbnail_text = ? WHERE id = ?')
    .run(thumbnailText, id);
  if (result.changes === 0) return null;
  return getDesign(db, id);
}

export function softDeleteDesign(db: Database, id: string): Design | null {
  const now = new Date().toISOString();
  const result = db.prepare('UPDATE designs SET deleted_at = ? WHERE id = ?').run(now, id);
  if (result.changes === 0) return null;
  return getDesign(db, id);
}

/**
 * Duplicate a design row + all its messages + all its snapshots. Snapshot
 * parent_id references are remapped to point at the freshly-cloned snapshots
 * so the lineage is preserved inside the new design.
 */
export function duplicateDesign(db: Database, sourceId: string, newName: string): Design | null {
  const source = getDesign(db, sourceId);
  if (source === null) return null;

  const newId = crypto.randomUUID();
  const now = new Date().toISOString();
  const trimmed = newName.trim() || `${source.name} copy`;

  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO designs (id, schema_version, name, created_at, updated_at, thumbnail_text, deleted_at) VALUES (?, 1, ?, ?, ?, ?, NULL)',
    ).run(newId, trimmed, now, now, source.thumbnailText);

    const messages = db
      .prepare('SELECT * FROM design_messages WHERE design_id = ? ORDER BY ordinal ASC')
      .all(sourceId) as MessageRow[];
    const insertMsg = db.prepare(
      'INSERT INTO design_messages (design_id, ordinal, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    for (const m of messages) {
      insertMsg.run(newId, m.ordinal, m.role, m.content, m.created_at);
    }

    // Snapshots: clone in chronological order so parent_ids are remapped first.
    // Tie-break by rowid so we always process older inserts first when two
    // snapshots share a millisecond.
    const snaps = db
      .prepare(
        'SELECT * FROM design_snapshots WHERE design_id = ? ORDER BY created_at ASC, rowid ASC',
      )
      .all(sourceId) as SnapshotRow[];
    const idMap = new Map<string, string>();
    const insertSnap = db.prepare(
      `INSERT INTO design_snapshots
         (id, schema_version, design_id, parent_id, type, prompt, artifact_type, artifact_source, created_at, message)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const s of snaps) {
      const cloneId = crypto.randomUUID();
      idMap.set(s.id, cloneId);
      const newParent = s.parent_id !== null ? (idMap.get(s.parent_id) ?? null) : null;
      insertSnap.run(
        cloneId,
        newId,
        newParent,
        s.type,
        s.prompt,
        s.artifact_type,
        s.artifact_source,
        s.created_at,
        s.message,
      );
    }
  });
  tx();

  return getDesign(db, newId);
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export function listMessages(db: Database, designId: string): DesignMessage[] {
  return (
    db
      .prepare('SELECT * FROM design_messages WHERE design_id = ? ORDER BY ordinal ASC')
      .all(designId) as MessageRow[]
  ).map(rowToMessage);
}

export interface MessageInput {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Replace the entire message list for a design atomically. We rewrite rather
 * than appending so the renderer's source-of-truth stays trivially in sync —
 * the chat list is small (< 200 entries) so a full rewrite is cheap and avoids
 * ordinal-conflict bugs across edits / cancels / retries.
 */
export function replaceMessages(
  db: Database,
  designId: string,
  messages: MessageInput[],
): DesignMessage[] {
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM design_messages WHERE design_id = ?').run(designId);
    const insert = db.prepare(
      'INSERT INTO design_messages (design_id, ordinal, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    messages.forEach((m, i) => {
      insert.run(designId, i, m.role, m.content, now);
    });
  });
  tx();
  return listMessages(db, designId);
}
