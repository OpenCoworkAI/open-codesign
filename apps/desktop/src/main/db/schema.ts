import type { Database } from './native-binding';

/**
 * Per-connection pragmas plus all CREATE TABLE / CREATE INDEX DDL. Idempotent.
 */
export function applySchema(db: Database): void {
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
 * Additive column migrations plus one-shot db_meta-gated cleanups.
 *
 * Each column block uses PRAGMA table_info to detect whether the column
 * already exists; SQLite has no IF NOT EXISTS for ADD COLUMN. Safe to run on
 * every boot.
 *
 * The db_meta key names below are migration idempotency guards and MUST NOT
 * be renamed even if they look ugly.
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
