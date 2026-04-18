/**
 * Snapshot IPC handlers (main process).
 *
 * All channels are namespaced snapshots:v1:* so they can be versioned
 * independently of other codesign:* channels.
 *
 * The `db` argument is injected so tests can pass an in-memory instance
 * without module-level state. Production callers pass the singleton from
 * initSnapshotsDb().
 */

import type { Design, DesignSnapshot, SnapshotCreateInput } from '@open-codesign/shared';
import { CodesignError } from '@open-codesign/shared';
import type BetterSqlite3 from 'better-sqlite3';
import { ipcMain } from './electron-runtime';
import { getLogger } from './logger';
import {
  createDesign,
  createSnapshot,
  deleteSnapshot,
  getSnapshot,
  listDesigns,
  listSnapshots,
} from './snapshots-db';

type Database = BetterSqlite3.Database;

const logger = getLogger('snapshots-ipc');

function parseSnapshotCreateInput(raw: unknown): SnapshotCreateInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('snapshots:v1:create expects an object payload', 'IPC_BAD_INPUT');
  }
  const r = raw as Record<string, unknown>;

  if (typeof r['designId'] !== 'string' || r['designId'].trim().length === 0) {
    throw new CodesignError('designId must be a non-empty string', 'IPC_BAD_INPUT');
  }
  if (r['parentId'] !== null && typeof r['parentId'] !== 'string') {
    throw new CodesignError('parentId must be a string or null', 'IPC_BAD_INPUT');
  }
  const validTypes = ['initial', 'edit', 'fork'] as const;
  if (!validTypes.includes(r['type'] as (typeof validTypes)[number])) {
    throw new CodesignError(`type must be one of: ${validTypes.join(', ')}`, 'IPC_BAD_INPUT');
  }
  if (r['prompt'] !== null && typeof r['prompt'] !== 'string') {
    throw new CodesignError('prompt must be a string or null', 'IPC_BAD_INPUT');
  }
  const validArtifactTypes = ['html', 'react', 'svg'] as const;
  if (!validArtifactTypes.includes(r['artifactType'] as (typeof validArtifactTypes)[number])) {
    throw new CodesignError(
      `artifactType must be one of: ${validArtifactTypes.join(', ')}`,
      'IPC_BAD_INPUT',
    );
  }
  if (typeof r['artifactSource'] !== 'string') {
    throw new CodesignError('artifactSource must be a string', 'IPC_BAD_INPUT');
  }
  if (r['message'] !== undefined && typeof r['message'] !== 'string') {
    throw new CodesignError('message must be a string if provided', 'IPC_BAD_INPUT');
  }

  const base = {
    designId: r['designId'] as string,
    parentId: r['parentId'] as string | null,
    type: r['type'] as SnapshotCreateInput['type'],
    prompt: r['prompt'] as string | null,
    artifactType: r['artifactType'] as SnapshotCreateInput['artifactType'],
    artifactSource: r['artifactSource'] as string,
  };
  if (typeof r['message'] === 'string') {
    return { ...base, message: r['message'] };
  }
  return base;
}

export function registerSnapshotsIpc(db: Database): void {
  ipcMain.handle('snapshots:v1:list-designs', (): Design[] => {
    return listDesigns(db);
  });

  ipcMain.handle('snapshots:v1:list', (_e: unknown, raw: unknown): DesignSnapshot[] => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError('snapshots:v1:list expects an object with designId', 'IPC_BAD_INPUT');
    }
    const r = raw as Record<string, unknown>;
    if (typeof r['designId'] !== 'string' || r['designId'].trim().length === 0) {
      throw new CodesignError('designId must be a non-empty string', 'IPC_BAD_INPUT');
    }
    return listSnapshots(db, r['designId'] as string);
  });

  ipcMain.handle('snapshots:v1:get', (_e: unknown, raw: unknown): DesignSnapshot | null => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError('snapshots:v1:get expects an object with id', 'IPC_BAD_INPUT');
    }
    const r = raw as Record<string, unknown>;
    if (typeof r['id'] !== 'string' || r['id'].trim().length === 0) {
      throw new CodesignError('id must be a non-empty string', 'IPC_BAD_INPUT');
    }
    return getSnapshot(db, r['id'] as string);
  });

  ipcMain.handle('snapshots:v1:create', (_e: unknown, raw: unknown): DesignSnapshot => {
    const input = parseSnapshotCreateInput(raw);
    if (input.parentId !== null) {
      const parent = getSnapshot(db, input.parentId);
      if (parent === null) {
        throw new CodesignError(
          'parentId references a snapshot that does not exist',
          'IPC_BAD_INPUT',
        );
      }
      if (parent.designId !== input.designId) {
        throw new CodesignError(
          'parentId must reference a snapshot in the same design',
          'IPC_BAD_INPUT',
        );
      }
    }
    const snapshot = createSnapshot(db, input);
    logger.info('snapshot.created', {
      id: snapshot.id,
      type: input.type,
      designId: input.designId,
    });
    return snapshot;
  });

  ipcMain.handle('snapshots:v1:delete', (_e: unknown, raw: unknown): void => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError('snapshots:v1:delete expects an object with id', 'IPC_BAD_INPUT');
    }
    const r = raw as Record<string, unknown>;
    if (typeof r['id'] !== 'string' || r['id'].trim().length === 0) {
      throw new CodesignError('id must be a non-empty string', 'IPC_BAD_INPUT');
    }
    deleteSnapshot(db, r['id'] as string);
    logger.info('snapshot.deleted', { id: r['id'] });
  });

  ipcMain.handle('snapshots:v1:create-design', (_e: unknown, raw: unknown): Design => {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new CodesignError('name must be a non-empty string', 'IPC_BAD_INPUT');
    }
    return createDesign(db, raw.trim());
  });
}
