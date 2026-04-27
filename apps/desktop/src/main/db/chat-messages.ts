import {
  type ChatAppendInput,
  type ChatMessageKind,
  type ChatMessageRow,
  CodesignError,
  ERROR_CODES,
} from '@open-codesign/shared';
import type { Database } from './native-binding';
import type { SnapshotRow } from './snapshots';

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
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload);
  } catch (cause) {
    throw new CodesignError('Corrupt chat message payload JSON', ERROR_CODES.IPC_DB_ERROR, {
      cause,
    });
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
