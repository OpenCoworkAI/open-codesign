import type {
  DiagnosticEventInput,
  DiagnosticEventRow,
  DiagnosticLevel,
} from '@open-codesign/shared';
import type { Database } from './native-binding';

// 200ms dedup: if the most recent row with the same fingerprint was inserted
// within the window, bump its count + ts and OR-merge the transient flag
// instead of inserting a new row. Run_id is intentionally ignored for the
// match — dedup groups collapse regardless of which run produced the repeat.
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
