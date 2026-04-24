import type { DesignSnapshot, SnapshotCreateInput } from '@open-codesign/shared';
import type { Database } from './native-binding';

export interface SnapshotRow {
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

export function rowToSnapshot(row: SnapshotRow): DesignSnapshot {
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
