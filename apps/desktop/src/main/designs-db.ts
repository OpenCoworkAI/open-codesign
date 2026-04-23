/**
 * SQLite persistence layer for designs, design_files, and diagnostic events.
 *
 * Uses better-sqlite3 (synchronous API — safe in the Electron main process,
 * which is the only caller). WAL mode for concurrent read performance.
 *
 * NOTE (T2.4): the legacy snapshots / chat_messages / comments helpers were
 * removed when v0.2 moved chat / snapshot / comment persistence into the
 * pi-coding-agent session JSONL files. The remaining tables here are:
 *   - designs        (T2.6 will fold this into the JSONL session)
 *   - design_files   (T2.6 will fold this into the JSONL session)
 *   - diagnostic_events (kept; will become an append-only log later)
 *
 * Call initSnapshotsDb(dbPath) once at app start.
 * Call initInMemoryDb() in tests to get an isolated in-memory instance.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type {
  Design,
  DesignFile,
  DiagnosticEventInput,
  DiagnosticEventRow,
  DiagnosticLevel,
} from '@open-codesign/shared';
import type BetterSqlite3 from 'better-sqlite3';

// better-sqlite3 is a native module — require() instead of import.
const require = createRequire(import.meta.url);

type Database = BetterSqlite3.Database;

let singleton: Database | null = null;

/**
 * Resolve the .node binary that matches the active runtime ABI.
 *
 * scripts/install-sqlite-bindings.cjs stages the host Node prebuild plus
 * per-arch Electron prebuilds side by side:
 *   build/Release/better_sqlite3.node-node.node          ← Node 22 (vitest)
 *   build/Release/better_sqlite3.node-electron-x64.node  ← Electron x64 app
 *   build/Release/better_sqlite3.node-electron-arm64.node← Electron arm64 app
 *   build/Release/better_sqlite3.node-electron.node      ← legacy host-arch alias
 * so that one `pnpm install` covers both runtimes without
 * an electron-rebuild step that toggles the single default binary.
 */
export function resolveNativeBindingPath(
  releaseDir: string,
  isElectron = typeof process.versions.electron === 'string',
  arch = process.arch,
): string {
  if (isElectron) {
    const archSpecific = path.join(releaseDir, `better_sqlite3.node-electron-${arch}.node`);
    if (fs.existsSync(archSpecific)) return archSpecific;
  }
  const runtimeSpecific = path.join(
    releaseDir,
    isElectron ? 'better_sqlite3.node-electron.node' : 'better_sqlite3.node-node.node',
  );
  if (fs.existsSync(runtimeSpecific)) return runtimeSpecific;
  if (isElectron) return path.join(releaseDir, 'better_sqlite3.node');
  return runtimeSpecific;
}

function resolveNativeBinding(): string {
  const pkgJson = require.resolve('better-sqlite3/package.json');
  return resolveNativeBindingPath(path.join(path.dirname(pkgJson), 'build', 'Release'));
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

    CREATE TABLE IF NOT EXISTS design_files (
      id          TEXT PRIMARY KEY,
      design_id   TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
      path        TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      UNIQUE (design_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_design_files_design ON design_files(design_id);

    CREATE TABLE IF NOT EXISTS diagnostic_events (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      schema_version  INTEGER NOT NULL DEFAULT 1,
      ts              INTEGER NOT NULL,
      level           TEXT    NOT NULL CHECK (level IN ('info','warn','error')),
      code            TEXT    NOT NULL,
      scope           TEXT    NOT NULL,
      run_id          TEXT,
      fingerprint     TEXT    NOT NULL,
      message         TEXT    NOT NULL,
      stack           TEXT,
      transient       INTEGER NOT NULL DEFAULT 0,
      count           INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_diag_events_ts          ON diagnostic_events(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_diag_events_fingerprint ON diagnostic_events(fingerprint);
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

  // diagnostic_events v2 — add `context_json` (TEXT, nullable) so rows from
  // provider errors can persist the full NormalizedProviderError payload
  // (upstream_request_id, upstream_status, retry_count, redacted_body_head).
  // Nullable so existing rows keep working; renderer deserializes JSON when
  // rendering the Report dialog.
  const diagEventCols = (
    db.prepare('PRAGMA table_info(diagnostic_events)').all() as ColumnInfo[]
  ).map((c) => c.name);
  if (!diagEventCols.includes('context_json')) {
    db.exec('ALTER TABLE diagnostic_events ADD COLUMN context_json TEXT');
  }

  // db_meta is a key/value table the older schema used to gate one-shot
  // migrations. Kept (still referenced by upgraded installs) but no new
  // markers are written by v0.2 — the snapshots / chat / comments tables
  // those migrations targeted no longer exist.
  db.exec(`
    CREATE TABLE IF NOT EXISTS db_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
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
  thumbnail_text: string | null;
  deleted_at: string | null;
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
 * Duplicate a design row. Snapshots / messages / chat / comments no longer
 * live in SQLite (T2.4), so this is now a flat row clone — T2.6 will rewrite
 * to fan out the JSONL session as well.
 */
export function duplicateDesign(db: Database, sourceId: string, newName: string): Design | null {
  const source = getDesign(db, sourceId);
  if (source === null) return null;

  const newId = crypto.randomUUID();
  const now = new Date().toISOString();
  const trimmed = newName.trim() || `${source.name} copy`;

  db.prepare(
    'INSERT INTO designs (id, schema_version, name, created_at, updated_at, thumbnail_text, deleted_at) VALUES (?, 1, ?, ?, ?, ?, NULL)',
  ).run(newId, trimmed, now, now, source.thumbnailText);

  return getDesign(db, newId);
}

// ---------------------------------------------------------------------------
// Virtual FS — design_files (Workstream E Phase 2)
//
// Paths are stored verbatim. Callers MUST pass POSIX-relative paths that were
// already validated via normalizeDesignFilePath(); this helper throws for
// absolute paths and ".." traversal so tool implementations don't have to
// repeat the check.
// ---------------------------------------------------------------------------

interface DesignFileRowDb {
  id: string;
  design_id: string;
  path: string;
  content: string;
  created_at: string;
  updated_at: string;
}

function rowToDesignFile(row: DesignFileRowDb): DesignFile {
  return {
    schemaVersion: 1,
    id: row.id,
    designId: row.design_id,
    path: row.path,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Reject absolute paths, drive letters, "..", and empty segments. Returns
 * the cleaned POSIX path on success.
 */
export function normalizeDesignFilePath(raw: string): string {
  const s = raw.trim();
  if (s.length === 0) throw new Error('path must not be empty');
  if (s.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(s))
    throw new Error(`path must be relative: ${raw}`);
  const parts = s.replaceAll('\\', '/').split('/');
  for (const p of parts) {
    if (p === '..' || p === '') throw new Error(`invalid path segment in ${raw}`);
  }
  return parts.join('/');
}

export function viewDesignFile(db: Database, designId: string, path: string): DesignFile | null {
  const p = normalizeDesignFilePath(path);
  const row = db
    .prepare('SELECT * FROM design_files WHERE design_id = ? AND path = ?')
    .get(designId, p) as DesignFileRowDb | undefined;
  return row ? rowToDesignFile(row) : null;
}

export function listDesignFiles(db: Database, designId: string): DesignFile[] {
  return (
    db
      .prepare('SELECT * FROM design_files WHERE design_id = ? ORDER BY path ASC')
      .all(designId) as DesignFileRowDb[]
  ).map(rowToDesignFile);
}

/**
 * List files whose path matches `${dir}/*` (one segment deeper only). Used by
 * text_editor's `view` command when the caller points at a directory.
 */
export function listDesignFilesInDir(db: Database, designId: string, dir: string): string[] {
  const clean = dir === '' || dir === '.' ? '' : normalizeDesignFilePath(dir);
  const prefix = clean.length === 0 ? '' : `${clean}/`;
  const files = listDesignFiles(db, designId);
  const names = new Set<string>();
  for (const f of files) {
    if (!f.path.startsWith(prefix)) continue;
    const rest = f.path.slice(prefix.length);
    if (rest.length === 0) continue;
    const first = rest.split('/')[0] ?? rest;
    names.add(first);
  }
  return [...names].sort();
}

export function createDesignFile(
  db: Database,
  designId: string,
  path: string,
  content: string,
): DesignFile {
  const p = normalizeDesignFilePath(path);
  const existing = db
    .prepare('SELECT 1 FROM design_files WHERE design_id = ? AND path = ?')
    .get(designId, p);
  if (existing) throw new Error(`File already exists: ${p}`);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO design_files (id, design_id, path, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, designId, p, content, now, now);
  const row = db.prepare('SELECT * FROM design_files WHERE id = ?').get(id) as DesignFileRowDb;
  return rowToDesignFile(row);
}

export function strReplaceInDesignFile(
  db: Database,
  designId: string,
  path: string,
  oldStr: string,
  newStr: string,
): DesignFile {
  const p = normalizeDesignFilePath(path);
  const row = db
    .prepare('SELECT * FROM design_files WHERE design_id = ? AND path = ?')
    .get(designId, p) as DesignFileRowDb | undefined;
  if (!row) throw new Error(`File not found: ${p}`);
  const occurrences = row.content.split(oldStr).length - 1;
  if (occurrences === 0) throw new Error(`old_str not found in ${p}`);
  if (occurrences > 1)
    throw new Error(`old_str matched ${occurrences} times in ${p}; must be unique`);
  const next = row.content.replace(oldStr, newStr);
  const now = new Date().toISOString();
  db.prepare('UPDATE design_files SET content = ?, updated_at = ? WHERE id = ?').run(
    next,
    now,
    row.id,
  );
  return rowToDesignFile({ ...row, content: next, updated_at: now });
}

export function insertInDesignFile(
  db: Database,
  designId: string,
  path: string,
  line: number,
  text: string,
): DesignFile {
  const p = normalizeDesignFilePath(path);
  const row = db
    .prepare('SELECT * FROM design_files WHERE design_id = ? AND path = ?')
    .get(designId, p) as DesignFileRowDb | undefined;
  if (!row) throw new Error(`File not found: ${p}`);
  const lines = row.content.split('\n');
  if (line < 0 || line > lines.length)
    throw new Error(`insert_line ${line} out of range (0..${lines.length}) for ${p}`);
  const insertion = text.endsWith('\n') ? text.slice(0, -1) : text;
  lines.splice(line, 0, insertion);
  const next = lines.join('\n');
  const now = new Date().toISOString();
  db.prepare('UPDATE design_files SET content = ?, updated_at = ? WHERE id = ?').run(
    next,
    now,
    row.id,
  );
  return rowToDesignFile({ ...row, content: next, updated_at: now });
}

// ---------------------------------------------------------------------------
// Diagnostic events (PR3 — main-process error/log capture store)
//
// 200ms dedup: if the most recent row with the same fingerprint was inserted
// within the window, bump its count + ts and OR-merge the transient flag
// instead of inserting a new row. Run_id is intentionally ignored for the
// match — dedup groups collapse regardless of which run produced the repeat.
// ---------------------------------------------------------------------------

const DIAGNOSTIC_DEDUP_WINDOW_MS = 200;

interface DiagnosticEventRowDb {
  id: number;
  schema_version: number;
  ts: number;
  level: string;
  code: string;
  scope: string;
  run_id: string | null;
  fingerprint: string;
  message: string;
  stack: string | null;
  transient: number;
  count: number;
  context_json: string | null;
}

function rowToDiagnosticEvent(row: DiagnosticEventRowDb): DiagnosticEventRow {
  let context: Record<string, unknown> | undefined;
  if (row.context_json !== null && row.context_json.length > 0) {
    try {
      const parsed: unknown = JSON.parse(row.context_json);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        context = parsed as Record<string, unknown>;
      }
    } catch {
      // Corrupt JSON — ignore rather than crash the list view.
    }
  }
  return {
    id: row.id,
    schemaVersion: 1,
    ts: row.ts,
    level: row.level as DiagnosticLevel,
    code: row.code,
    scope: row.scope,
    runId: row.run_id ?? undefined,
    fingerprint: row.fingerprint,
    message: row.message,
    stack: row.stack ?? undefined,
    transient: row.transient === 1,
    count: row.count,
    context,
  };
}

export function recordDiagnosticEvent(
  db: Database,
  input: DiagnosticEventInput,
  now: () => number = Date.now,
): number {
  const ts = now();
  const recent = db
    .prepare(
      'SELECT id, count, transient FROM diagnostic_events WHERE fingerprint = ? AND ts > ? ORDER BY ts DESC LIMIT 1',
    )
    .get(input.fingerprint, ts - DIAGNOSTIC_DEDUP_WINDOW_MS) as
    | { id: number; count: number; transient: number }
    | undefined;

  if (recent !== undefined) {
    const mergedTransient = recent.transient === 1 || input.transient ? 1 : 0;
    db.prepare(
      'UPDATE diagnostic_events SET count = count + 1, ts = ?, transient = ? WHERE id = ?',
    ).run(ts, mergedTransient, recent.id);
    return recent.id;
  }

  const result = db
    .prepare(
      `INSERT INTO diagnostic_events
       (schema_version, ts, level, code, scope, run_id, fingerprint, message, stack, transient, count, context_json)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    )
    .run(
      ts,
      input.level,
      input.code,
      input.scope,
      input.runId ?? null,
      input.fingerprint,
      input.message,
      input.stack ?? null,
      input.transient ? 1 : 0,
      input.context !== undefined ? JSON.stringify(input.context) : null,
    );
  return Number(result.lastInsertRowid);
}

export function getDiagnosticEventById(db: Database, id: number): DiagnosticEventRow | undefined {
  const row = db.prepare('SELECT * FROM diagnostic_events WHERE id = ?').get(id) as
    | DiagnosticEventRowDb
    | undefined;
  return row === undefined ? undefined : rowToDiagnosticEvent(row);
}

export function listDiagnosticEvents(
  db: Database,
  opts?: { limit?: number; includeTransient?: boolean },
): DiagnosticEventRow[] {
  const limit = opts?.limit ?? 100;
  const includeTransient = opts?.includeTransient ?? false;
  const sql = includeTransient
    ? 'SELECT * FROM diagnostic_events ORDER BY ts DESC, id DESC LIMIT ?'
    : 'SELECT * FROM diagnostic_events WHERE transient = 0 ORDER BY ts DESC, id DESC LIMIT ?';
  const rows = db.prepare(sql).all(limit) as DiagnosticEventRowDb[];
  return rows.map(rowToDiagnosticEvent);
}

export function pruneDiagnosticEvents(db: Database, maxRows: number): number {
  const result = db
    .prepare(
      `DELETE FROM diagnostic_events
       WHERE id NOT IN (
         SELECT id FROM diagnostic_events ORDER BY ts DESC, id DESC LIMIT ?
       )`,
    )
    .run(maxRows);
  return result.changes;
}
