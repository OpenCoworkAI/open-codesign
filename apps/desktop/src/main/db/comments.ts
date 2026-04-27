import type {
  CommentCreateInput,
  CommentKind,
  CommentRect,
  CommentRow,
  CommentScope,
  CommentStatus,
  CommentUpdateInput,
} from '@open-codesign/shared';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
import type { Database } from './native-binding';

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
  let rect: CommentRect;
  try {
    const parsed = JSON.parse(row.rect) as Partial<CommentRect>;
    if (
      typeof parsed.top !== 'number' ||
      typeof parsed.left !== 'number' ||
      typeof parsed.width !== 'number' ||
      typeof parsed.height !== 'number'
    ) {
      throw new Error('rect fields must be numbers');
    }
    rect = {
      top: parsed.top,
      left: parsed.left,
      width: parsed.width,
      height: parsed.height,
    };
  } catch (cause) {
    throw new CodesignError('Corrupt comment rect JSON', ERROR_CODES.IPC_DB_ERROR, { cause });
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
