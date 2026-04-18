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

/**
 * Translate a raw better-sqlite3 SqliteError into a typed CodesignError so the
 * renderer never sees provider-specific error strings. Constraint subcodes are
 * matched individually because the bare `SQLITE_CONSTRAINT` parent code covers
 * unrelated failures (UNIQUE, NOT NULL, CHECK, FK), and surfacing all of them
 * as a single message would mislead the UI. The FK message is keyed by call-site
 * context because the same SQLITE_CONSTRAINT_FOREIGNKEY code fires for both a
 * missing `design_id` and a missing `parent_id` in design_snapshots — naming
 * only the parent led contributors to chase the wrong cause. Unrecognised
 * errors fall through as IPC_DB_ERROR with the original cause attached for
 * server-side logs.
 */
const FK_MESSAGES: Record<string, string> = {
  create: 'Referenced design or parent snapshot does not exist',
  'create.lookup-parent': 'Referenced design or parent snapshot does not exist',
};

type Translation = {
  code: 'IPC_BAD_INPUT' | 'IPC_CONFLICT' | 'IPC_DB_BUSY' | 'IPC_DB_FULL';
  message: string;
};

function staticTranslation(sqliteCode: string): Translation | null {
  switch (sqliteCode) {
    case 'SQLITE_CONSTRAINT_UNIQUE':
    case 'SQLITE_CONSTRAINT_PRIMARYKEY':
      return { code: 'IPC_CONFLICT', message: 'Snapshot already exists' };
    case 'SQLITE_CONSTRAINT_NOTNULL':
    case 'SQLITE_CONSTRAINT_CHECK':
      return { code: 'IPC_BAD_INPUT', message: 'Snapshot input violates database constraints' };
    case 'SQLITE_BUSY':
    case 'SQLITE_LOCKED':
      return { code: 'IPC_DB_BUSY', message: 'Database is locked, retry shortly' };
    case 'SQLITE_FULL':
      return { code: 'IPC_DB_FULL', message: 'Disk is full' };
    default:
      return null;
  }
}

function translateSqliteError(err: unknown, context: string): CodesignError {
  const code = (err as { code?: unknown })?.code;
  if (typeof code === 'string') {
    if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      const message = FK_MESSAGES[context] ?? 'Referenced item does not exist';
      return new CodesignError(message, 'IPC_BAD_INPUT', { cause: err });
    }
    const t = staticTranslation(code);
    if (t !== null) {
      return new CodesignError(t.message, t.code, { cause: err });
    }
  }
  logger.error('snapshot.db_error', {
    context,
    code: typeof code === 'string' ? code : 'unknown',
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  return new CodesignError(`Snapshot database error (${context})`, 'IPC_DB_ERROR', { cause: err });
}

function runDb<T>(context: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof CodesignError) throw err;
    throw translateSqliteError(err, context);
  }
}

/**
 * Every snapshots:v1:* object payload carries `schemaVersion: 1` so that future
 * handler revisions can reject older callers up-front rather than silently
 * mis-parsing fields. Bare scalar payloads (none currently) would not carry one.
 */
function requireSchemaV1(r: Record<string, unknown>, channel: string): void {
  if (r['schemaVersion'] !== 1) {
    throw new CodesignError(`${channel} requires schemaVersion: 1`, 'IPC_BAD_INPUT');
  }
}

function parseSnapshotCreateInput(raw: unknown): SnapshotCreateInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('snapshots:v1:create expects an object payload', 'IPC_BAD_INPUT');
  }
  const r = raw as Record<string, unknown>;
  requireSchemaV1(r, 'snapshots:v1:create');

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
  ipcMain.handle('snapshots:v1:list-designs', (_e: unknown, raw: unknown): Design[] => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError(
        'snapshots:v1:list-designs expects an object payload',
        'IPC_BAD_INPUT',
      );
    }
    requireSchemaV1(raw as Record<string, unknown>, 'snapshots:v1:list-designs');
    return runDb('list-designs', () => listDesigns(db));
  });

  ipcMain.handle('snapshots:v1:list', (_e: unknown, raw: unknown): DesignSnapshot[] => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError('snapshots:v1:list expects an object with designId', 'IPC_BAD_INPUT');
    }
    const r = raw as Record<string, unknown>;
    requireSchemaV1(r, 'snapshots:v1:list');
    if (typeof r['designId'] !== 'string' || r['designId'].trim().length === 0) {
      throw new CodesignError('designId must be a non-empty string', 'IPC_BAD_INPUT');
    }
    return runDb('list', () => listSnapshots(db, r['designId'] as string));
  });

  ipcMain.handle('snapshots:v1:get', (_e: unknown, raw: unknown): DesignSnapshot | null => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError('snapshots:v1:get expects an object with id', 'IPC_BAD_INPUT');
    }
    const r = raw as Record<string, unknown>;
    requireSchemaV1(r, 'snapshots:v1:get');
    if (typeof r['id'] !== 'string' || r['id'].trim().length === 0) {
      throw new CodesignError('id must be a non-empty string', 'IPC_BAD_INPUT');
    }
    return runDb('get', () => getSnapshot(db, r['id'] as string));
  });

  ipcMain.handle('snapshots:v1:create', (_e: unknown, raw: unknown): DesignSnapshot => {
    const input = parseSnapshotCreateInput(raw);
    if (input.parentId !== null) {
      const parent = runDb('create.lookup-parent', () => getSnapshot(db, input.parentId as string));
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
    const snapshot = runDb('create', () => createSnapshot(db, input));
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
    requireSchemaV1(r, 'snapshots:v1:delete');
    if (typeof r['id'] !== 'string' || r['id'].trim().length === 0) {
      throw new CodesignError('id must be a non-empty string', 'IPC_BAD_INPUT');
    }
    runDb('delete', () => deleteSnapshot(db, r['id'] as string));
    logger.info('snapshot.deleted', { id: r['id'] });
  });

  ipcMain.handle('snapshots:v1:create-design', (_e: unknown, raw: unknown): Design => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError(
        'snapshots:v1:create-design expects an object with name',
        'IPC_BAD_INPUT',
      );
    }
    const r = raw as Record<string, unknown>;
    requireSchemaV1(r, 'snapshots:v1:create-design');
    if (typeof r['name'] !== 'string' || r['name'].trim().length === 0) {
      throw new CodesignError('name must be a non-empty string', 'IPC_BAD_INPUT');
    }
    return runDb('create-design', () => createDesign(db, (r['name'] as string).trim()));
  });
}

/**
 * Stub channels installed when snapshots DB init fails at boot. Without these,
 * any renderer call to window.codesign.snapshots.* would surface as Electron's
 * generic "No handler registered for ..." rejection — opaque to the user and
 * to logs. We register handlers that throw a typed CodesignError so the
 * renderer can branch on `SNAPSHOTS_UNAVAILABLE` and surface a placeholder.
 *
 * Channels listed here MUST match the set registered in registerSnapshotsIpc.
 */
export const SNAPSHOTS_CHANNELS_V1 = [
  'snapshots:v1:list-designs',
  'snapshots:v1:create-design',
  'snapshots:v1:list',
  'snapshots:v1:get',
  'snapshots:v1:create',
  'snapshots:v1:delete',
] as const;

export function registerSnapshotsUnavailableIpc(reason: string): void {
  const message = `Snapshots database failed to initialize. Check Settings → Storage for diagnostics. (${reason})`;
  const fail = (): never => {
    throw new CodesignError(message, 'SNAPSHOTS_UNAVAILABLE');
  };
  for (const channel of SNAPSHOTS_CHANNELS_V1) {
    ipcMain.handle(channel, fail);
  }
}
