/**
 * SQLite persistence layer for designs, snapshots, and chat messages.
 *
 * Uses better-sqlite3 (synchronous API — safe in the Electron main process,
 * which is the only caller). WAL mode for concurrent read performance.
 *
 * Call initSnapshotsDb(dbPath) once at app start.
 * Call initInMemoryDb() in tests to get an isolated in-memory instance.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getLogger } from './logger';
import type {
  ChatAppendInput,
  ChatMessageKind,
  ChatMessageRow,
  CommentCreateInput,
  CommentKind,
  CommentRect,
  CommentRow,
  CommentScope,
  CommentStatus,
  CommentUpdateInput,
  Design,
  DesignFile,
  DesignSnapshot,
  DiagnosticEventInput,
  DiagnosticEventRow,
  DiagnosticLevel,
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

    CREATE TABLE IF NOT EXISTS chat_messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      design_id   TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
      seq         INTEGER NOT NULL,
      kind        TEXT NOT NULL CHECK (kind IN (
                    'user',
                    'assistant_text',
                    'tool_call',
                    'artifact_delivered',
                    'error'
                  )),
      payload     TEXT NOT NULL,
      snapshot_id TEXT REFERENCES design_snapshots(id) ON DELETE SET NULL,
      created_at  TEXT NOT NULL,
      UNIQUE (design_id, seq)
    );

    CREATE INDEX IF NOT EXISTS idx_chat_design ON chat_messages(design_id, seq);

    CREATE TABLE IF NOT EXISTS comments (
      id                     TEXT PRIMARY KEY,
      schema_version         INTEGER NOT NULL DEFAULT 1,
      design_id              TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
      snapshot_id            TEXT NOT NULL REFERENCES design_snapshots(id) ON DELETE CASCADE,
      kind                   TEXT NOT NULL CHECK (kind IN ('note','edit')),
      selector               TEXT NOT NULL,
      tag                    TEXT NOT NULL,
      outer_html             TEXT NOT NULL,
      rect                   TEXT NOT NULL,
      text                   TEXT NOT NULL,
      status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','dismissed')),
      created_at             TEXT NOT NULL,
      applied_in_snapshot_id TEXT REFERENCES design_snapshots(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comments_design_snapshot ON comments(design_id, snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_comments_design_status   ON comments(design_id, status);

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
  if (!designCols.includes('workspace_path')) {
    db.exec('ALTER TABLE designs ADD COLUMN workspace_path TEXT');
  }

  // Comments v2 — add scope ('element'|'global') and parent_outer_html for
  // richer prompt enrichment. Both are additive; old rows backfill to
  // scope='element' / parent_outer_html=NULL.
  const commentCols = (db.prepare('PRAGMA table_info(comments)').all() as ColumnInfo[]).map(
    (c) => c.name,
  );
  if (!commentCols.includes('scope')) {
    db.exec("ALTER TABLE comments ADD COLUMN scope TEXT NOT NULL DEFAULT 'element'");
  }
  if (!commentCols.includes('parent_outer_html')) {
    db.exec('ALTER TABLE comments ADD COLUMN parent_outer_html TEXT');
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

  // One-shot cleanup: chat_messages rows written before the designId race
  // fixes (commits 2a316b7 / f41d1f8) may carry the wrong design_id and
  // cross-contaminate the Sidebar history. Clear the table once; the next
  // open of any design will re-seed from snapshots with the correct id.
  // Gated by a meta row so it only runs once per install.
  db.exec(`
    CREATE TABLE IF NOT EXISTS db_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  const flag = db
    .prepare('SELECT value FROM db_meta WHERE key = ?')
    .get('chat_messages_purged_2026_04_20') as { value?: string } | undefined;
  if (flag === undefined) {
    db.exec('DELETE FROM chat_messages');
    db.prepare('INSERT INTO db_meta (key, value) VALUES (?, ?)').run(
      'chat_messages_purged_2026_04_20',
      new Date().toISOString(),
    );
  }

  // One-shot normalization: pre-2026-04-20 builds wrote tool_call rows with
  // status='running' at start time but never updated them when the result
  // event arrived. Anything older than an hour is unreachable — flip it to
  // 'done' so the WorkingCard renderer stops showing a stuck spinner. Newer
  // rows are left alone so an in-flight generation isn't disturbed.
  const toolStatusFlag = db
    .prepare('SELECT value FROM db_meta WHERE key = ?')
    .get('tool_status_normalize_2026_04_20') as { value?: string } | undefined;
  if (toolStatusFlag === undefined) {
    db.exec(
      `UPDATE chat_messages
         SET payload = json_set(payload, '$.status', 'done')
       WHERE kind = 'tool_call'
         AND json_extract(payload, '$.status') = 'running'
         AND created_at < datetime('now','-1 hour')`,
    );
    db.prepare('INSERT INTO db_meta (key, value) VALUES (?, ?)').run(
      'tool_status_normalize_2026_04_20',
      new Date().toISOString(),
    );
  }

  // Comments v2 schema bump marker — record once after the new columns are
  // present so future migrations can branch on whether the v1→v2 backfill
  // already ran for this database file.
  const commentsV2 = db
    .prepare('SELECT value FROM db_meta WHERE key = ?')
    .get('comments_schema_v2') as { value?: string } | undefined;
  if (commentsV2 === undefined) {
    // Backfill: existing rows get scope='element' (safe default — same blast
    // radius as before v2) and a NULL parent_outer_html.
    db.exec("UPDATE comments SET scope = 'element' WHERE scope IS NULL OR scope = ''");
    db.prepare('INSERT INTO db_meta (key, value) VALUES (?, ?)').run(
      'comments_schema_v2',
      new Date().toISOString(),
    );
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
    } catch (closeErr) {
      const logger = getLogger();
      logger.warn('db.init.close_failed', { cause: closeErr });
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
  workspace_path: string | null;
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
    workspacePath: row.workspace_path ?? null,
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
// Designs
// ---------------------------------------------------------------------------

export function createDesign(db: Database, name = 'Untitled design'): Design {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO designs (id, schema_version, name, created_at, updated_at, workspace_path) VALUES (?, 1, ?, ?, ?, NULL)',
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

export function updateDesignWorkspace(
  db: Database,
  id: string,
  workspacePath: string,
): Design | null {
  const now = new Date().toISOString();
  const result = db
    .prepare('UPDATE designs SET workspace_path = ?, updated_at = ? WHERE id = ?')
    .run(workspacePath, now, id);
  if (result.changes === 0) return null;
  return getDesign(db, id);
}

export function clearDesignWorkspace(db: Database, id: string): Design | null {
  const now = new Date().toISOString();
  const result = db
    .prepare('UPDATE designs SET workspace_path = NULL, updated_at = ? WHERE id = ?')
    .run(now, id);
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
      'INSERT INTO designs (id, schema_version, name, created_at, updated_at, thumbnail_text, deleted_at, workspace_path) VALUES (?, 1, ?, ?, ?, ?, NULL, NULL)',
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
// Chat messages (Sidebar v2)
// ---------------------------------------------------------------------------

interface ChatMessageRowDb {
  id: number;
  design_id: string;
  seq: number;
  kind: string;
  payload: string;
  snapshot_id: string | null;
  created_at: string;
}

function rowToChatMessage(row: ChatMessageRowDb): ChatMessageRow {
  let payload: unknown = null;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    payload = { _raw: row.payload };
  }
  return {
    schemaVersion: 1,
    id: row.id,
    designId: row.design_id,
    seq: row.seq,
    kind: row.kind as ChatMessageKind,
    payload,
    snapshotId: row.snapshot_id,
    createdAt: row.created_at,
  };
}

export function listChatMessages(db: Database, designId: string): ChatMessageRow[] {
  return (
    db
      .prepare('SELECT * FROM chat_messages WHERE design_id = ? ORDER BY seq ASC')
      .all(designId) as ChatMessageRowDb[]
  ).map(rowToChatMessage);
}

/**
 * Atomically append a chat_messages row with a monotonically increasing seq.
 * seq is computed inside the transaction from COALESCE(MAX(seq), -1) + 1 so
 * concurrent appenders can't collide on the UNIQUE (design_id, seq) index.
 */
export function appendChatMessage(db: Database, input: ChatAppendInput): ChatMessageRow {
  const now = new Date().toISOString();
  const payloadJson = JSON.stringify(input.payload ?? {});
  const snapshotId = input.snapshotId ?? null;

  const tx = db.transaction((): ChatMessageRow => {
    const nextSeqRow = db
      .prepare(
        'SELECT COALESCE(MAX(seq), -1) + 1 AS nextSeq FROM chat_messages WHERE design_id = ?',
      )
      .get(input.designId) as { nextSeq: number };
    const info = db
      .prepare(
        `INSERT INTO chat_messages (design_id, seq, kind, payload, snapshot_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(input.designId, nextSeqRow.nextSeq, input.kind, payloadJson, snapshotId, now);
    const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(info.lastInsertRowid) as
      | ChatMessageRowDb
      | undefined;
    if (!row) throw new Error('Failed to read back appended chat message');
    return rowToChatMessage(row);
  });
  return tx();
}

/**
 * Patch a tool_call row's status (and optional errorMessage) in place.
 *
 * Tool calls are persisted at start-time with status='running'; this is the
 * counterpart that flips them to 'done' / 'error' when the result event lands.
 * Silent no-op if the row doesn't exist or isn't a tool_call — the renderer
 * may briefly race ahead of the persisted append, and we'd rather drop the
 * update than throw on a not-yet-committed row.
 */
export function updateChatToolCallStatus(
  db: Database,
  designId: string,
  seq: number,
  status: 'done' | 'error',
  errorMessage?: string,
): void {
  if (errorMessage === undefined) {
    db.prepare(
      `UPDATE chat_messages
         SET payload = json_set(payload, '$.status', ?)
       WHERE design_id = ? AND seq = ? AND kind = 'tool_call'`,
    ).run(status, designId, seq);
    return;
  }
  db.prepare(
    `UPDATE chat_messages
       SET payload = json_set(payload, '$.status', ?, '$.errorMessage', ?)
     WHERE design_id = ? AND seq = ? AND kind = 'tool_call'`,
  ).run(status, errorMessage, designId, seq);
}

/**
 * Idempotent — only runs if chat_messages is empty for this design. Walks
 * snapshots in chronological order and emits a (user) + (artifact_delivered)
 * pair per snapshot so pre-existing designs light up with a chat history on
 * first Sidebar v2 open.
 */
export function seedChatFromSnapshots(db: Database, designId: string): number {
  const existing = db
    .prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE design_id = ?')
    .get(designId) as { n: number };
  if (existing.n > 0) return 0;

  const snaps = db
    .prepare(
      'SELECT * FROM design_snapshots WHERE design_id = ? ORDER BY created_at ASC, rowid ASC',
    )
    .all(designId) as SnapshotRow[];
  if (snaps.length === 0) return 0;

  let inserted = 0;
  const tx = db.transaction(() => {
    for (const s of snaps) {
      if (typeof s.prompt === 'string' && s.prompt.trim().length > 0) {
        appendChatMessage(db, {
          designId,
          kind: 'user',
          payload: { text: s.prompt },
        });
        inserted += 1;
      }
      appendChatMessage(db, {
        designId,
        kind: 'artifact_delivered',
        payload: { createdAt: s.created_at },
        snapshotId: s.id,
      });
      inserted += 1;
    }
  });
  tx();
  return inserted;
}

export function clearChatMessages(db: Database, designId: string): void {
  db.prepare('DELETE FROM chat_messages WHERE design_id = ?').run(designId);
}

// ---------------------------------------------------------------------------
// Comments (Workstream D — inline comment mode)
// ---------------------------------------------------------------------------

interface CommentRowDb {
  id: string;
  schema_version: number;
  design_id: string;
  snapshot_id: string;
  kind: string;
  selector: string;
  tag: string;
  outer_html: string;
  rect: string;
  text: string;
  status: string;
  created_at: string;
  applied_in_snapshot_id: string | null;
  scope: string | null;
  parent_outer_html: string | null;
}

function rowToComment(row: CommentRowDb): CommentRow {
  let rect: CommentRect = { top: 0, left: 0, width: 0, height: 0 };
  try {
    const parsed = JSON.parse(row.rect) as Partial<CommentRect>;
    rect = {
      top: typeof parsed.top === 'number' ? parsed.top : 0,
      left: typeof parsed.left === 'number' ? parsed.left : 0,
      width: typeof parsed.width === 'number' ? parsed.width : 0,
      height: typeof parsed.height === 'number' ? parsed.height : 0,
    };
  } catch {
    /* keep zero rect */
  }
  const scope: CommentScope = row.scope === 'global' ? 'global' : 'element';
  return {
    schemaVersion: 1,
    id: row.id,
    designId: row.design_id,
    snapshotId: row.snapshot_id,
    kind: row.kind as CommentKind,
    selector: row.selector,
    tag: row.tag,
    outerHTML: row.outer_html,
    rect,
    text: row.text,
    status: row.status as CommentStatus,
    createdAt: row.created_at,
    appliedInSnapshotId: row.applied_in_snapshot_id,
    scope,
    ...(row.parent_outer_html !== null && row.parent_outer_html !== undefined
      ? { parentOuterHTML: row.parent_outer_html }
      : {}),
  };
}

export function createComment(db: Database, input: CommentCreateInput): CommentRow {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const scope: CommentScope = input.scope === 'global' ? 'global' : 'element';
  const parentOuterHTML =
    typeof input.parentOuterHTML === 'string' && input.parentOuterHTML.length > 0
      ? input.parentOuterHTML.slice(0, 600)
      : null;
  db.prepare(
    `INSERT INTO comments
       (id, schema_version, design_id, snapshot_id, kind, selector, tag, outer_html, rect, text, status, created_at, applied_in_snapshot_id, scope, parent_outer_html)
     VALUES (?, 2, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?, ?)`,
  ).run(
    id,
    input.designId,
    input.snapshotId,
    input.kind,
    input.selector,
    input.tag,
    input.outerHTML,
    JSON.stringify(input.rect),
    input.text,
    now,
    scope,
    parentOuterHTML,
  );
  const row = db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as CommentRowDb;
  return rowToComment(row);
}

export function listComments(db: Database, designId: string, snapshotId?: string): CommentRow[] {
  const rows = (
    snapshotId
      ? db
          .prepare(
            'SELECT * FROM comments WHERE design_id = ? AND snapshot_id = ? ORDER BY created_at ASC',
          )
          .all(designId, snapshotId)
      : db
          .prepare('SELECT * FROM comments WHERE design_id = ? ORDER BY created_at ASC')
          .all(designId)
  ) as CommentRowDb[];
  return rows.map(rowToComment);
}

export function listPendingEdits(db: Database, designId: string): CommentRow[] {
  const rows = db
    .prepare(
      "SELECT * FROM comments WHERE design_id = ? AND kind = 'edit' AND status = 'pending' ORDER BY created_at ASC",
    )
    .all(designId) as CommentRowDb[];
  return rows.map(rowToComment);
}

export function updateComment(
  db: Database,
  id: string,
  patch: CommentUpdateInput,
): CommentRow | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.text !== undefined) {
    fields.push('text = ?');
    values.push(patch.text);
  }
  if (patch.status !== undefined) {
    fields.push('status = ?');
    values.push(patch.status);
  }
  if (fields.length === 0) {
    const row = db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as
      | CommentRowDb
      | undefined;
    return row ? rowToComment(row) : null;
  }
  values.push(id);
  const result = db.prepare(`UPDATE comments SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  if (result.changes === 0) return null;
  const row = db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as CommentRowDb;
  return rowToComment(row);
}

export function deleteComment(db: Database, id: string): boolean {
  const result = db.prepare('DELETE FROM comments WHERE id = ?').run(id);
  return result.changes > 0;
}

export function markCommentsApplied(db: Database, ids: string[], snapshotId: string): CommentRow[] {
  if (ids.length === 0) return [];
  const tx = db.transaction(() => {
    const stmt = db.prepare(
      "UPDATE comments SET status = 'applied', applied_in_snapshot_id = ? WHERE id = ?",
    );
    for (const id of ids) stmt.run(snapshotId, id);
  });
  tx();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT * FROM comments WHERE id IN (${placeholders})`)
    .all(...ids) as CommentRowDb[];
  return rows.map(rowToComment);
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

export function upsertDesignFile(
  db: Database,
  designId: string,
  path: string,
  content: string,
): DesignFile {
  const p = normalizeDesignFilePath(path);
  const existing = db
    .prepare('SELECT * FROM design_files WHERE design_id = ? AND path = ?')
    .get(designId, p) as DesignFileRowDb | undefined;
  if (existing) {
    const now = new Date().toISOString();
    db.prepare('UPDATE design_files SET content = ?, updated_at = ? WHERE id = ?').run(
      content,
      now,
      existing.id,
    );
    return rowToDesignFile({ ...existing, content, updated_at: now });
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO design_files (id, design_id, path, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, designId, p, content, now, now);
  return rowToDesignFile(
    db.prepare('SELECT * FROM design_files WHERE id = ?').get(id) as DesignFileRowDb,
  );
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
