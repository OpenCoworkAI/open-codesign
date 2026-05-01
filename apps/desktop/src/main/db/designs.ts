import type { Design } from '@open-codesign/shared';
import { assertWorkspacePath } from '../workspace-path';
import { normalizeDesignFilePath } from './design-files';
import type { Database } from './native-binding';
import type { SnapshotRow } from './snapshots';

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

interface MessageRow {
  design_id: string;
  ordinal: number;
  role: string;
  content: string;
  created_at: string;
}

interface DesignFileCloneRow {
  path: string;
  content: string;
}

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

export function deleteDesignForRollback(db: Database, id: string): boolean {
  const result = db.prepare('DELETE FROM designs WHERE id = ?').run(id);
  return result.changes > 0;
}

export function updateDesignWorkspace(
  db: Database,
  id: string,
  workspacePath: string,
): Design | null {
  const now = new Date().toISOString();
  const checkedWorkspacePath = assertWorkspacePath(workspacePath);
  const result = db
    .prepare('UPDATE designs SET workspace_path = ?, updated_at = ? WHERE id = ?')
    .run(checkedWorkspacePath, now, id);
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

    const files = db
      .prepare('SELECT path, content FROM design_files WHERE design_id = ? ORDER BY path ASC')
      .all(sourceId) as DesignFileCloneRow[];
    const insertFile = db.prepare(
      'INSERT INTO design_files (id, design_id, path, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const file of files) {
      insertFile.run(
        crypto.randomUUID(),
        newId,
        normalizeDesignFilePath(file.path),
        file.content,
        now,
        now,
      );
    }
  });
  tx();

  return getDesign(db, newId);
}
