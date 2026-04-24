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

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Design, DesignSnapshot, SnapshotCreateInput } from '@open-codesign/shared';
import { CodesignError } from '@open-codesign/shared';
import type BetterSqlite3 from 'better-sqlite3';
import type { BrowserWindow } from 'electron';
import { bindWorkspace, checkWorkspaceFolderExists, openWorkspaceFolder } from './design-workspace';
import { app, dialog, ipcMain } from './electron-runtime';
import { getLogger } from './logger';
import {
  createDesign,
  createSnapshot,
  deleteSnapshot,
  duplicateDesign,
  getDesign,
  getSnapshot,
  listDesigns,
  listSnapshots,
  renameDesign,
  setDesignThumbnail,
  softDeleteDesign,
} from './snapshots-db';
import { listWorkspaceFilesAt, type WorkspaceFileEntry } from './workspace-reader';
import { registerFilesWatcherIpc } from './workspace-watcher';

type Database = BetterSqlite3.Database;

const logger = getLogger('snapshots-ipc');

/**
 * Derive a filesystem-safe directory name from a design title for the
 * auto-bound default workspace. Kept in sync with renderer's workspace-path
 * slug style — ASCII alphanumerics + dashes, max 48 chars.
 */
function defaultDesignSlug(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 48);
  return cleaned.length > 0 ? cleaned : 'untitled-design';
}

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

  ipcMain.handle(
    'snapshots:v1:create-design',
    async (_e: unknown, raw: unknown): Promise<Design> => {
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
      const name = (r['name'] as string).trim();
      const design = runDb('create-design', () => createDesign(db, name));
      // v0.2: every design MUST have a workspace — per docs/v0.2-plan.md §2.3.
      // When the user hasn't picked one explicitly, seed
      //   <Documents>/CoDesign/<slug(name)>[-N]/
      // and bind it. Collision suffix handles duplicate names.
      try {
        const defaultRoot = path.join(app.getPath('documents'), 'CoDesign');
        const slug = defaultDesignSlug(name);
        let attempt = 0;
        let workspacePath = path.join(defaultRoot, slug);
        while (existsSync(workspacePath)) {
          attempt += 1;
          workspacePath = path.join(defaultRoot, `${slug}-${attempt}`);
          if (attempt > 100) {
            throw new Error(`Could not find a unique workspace path under ${defaultRoot}`);
          }
        }
        await mkdir(workspacePath, { recursive: true });
        return await bindWorkspace(db, design.id, workspacePath, false);
      } catch (err) {
        // Non-fatal: design row is committed; user can pick a workspace
        // manually from the FilesTab WorkspaceSection. Log and return the
        // workspace-less design instead of surfacing a boot-time error.
        logger.warn('create-design.default-workspace.failed', {
          designId: design.id,
          error: err instanceof Error ? err.message : String(err),
        });
        return design;
      }
    },
  );

  ipcMain.handle('snapshots:v1:get-design', (_e: unknown, raw: unknown): Design | null => {
    const id = parseIdPayload(raw, 'get-design');
    return runDb('get-design', () => getDesign(db, id));
  });

  ipcMain.handle('snapshots:v1:rename-design', (_e: unknown, raw: unknown): Design => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError('snapshots:v1:rename-design expects { id, name }', 'IPC_BAD_INPUT');
    }
    const r = raw as Record<string, unknown>;
    requireSchemaV1(r, 'snapshots:v1:rename-design');
    if (typeof r['id'] !== 'string' || r['id'].trim().length === 0) {
      throw new CodesignError('id must be a non-empty string', 'IPC_BAD_INPUT');
    }
    if (typeof r['name'] !== 'string' || r['name'].trim().length === 0) {
      throw new CodesignError('name must be a non-empty string', 'IPC_BAD_INPUT');
    }
    const updated = runDb('rename-design', () =>
      renameDesign(db, r['id'] as string, r['name'] as string),
    );
    if (updated === null) {
      throw new CodesignError('Design not found', 'IPC_NOT_FOUND');
    }
    logger.info('design.renamed', { id: updated.id, name: updated.name });
    return updated;
  });

  ipcMain.handle('snapshots:v1:set-thumbnail', (_e: unknown, raw: unknown): Design => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError(
        'snapshots:v1:set-thumbnail expects { id, thumbnailText }',
        'IPC_BAD_INPUT',
      );
    }
    const r = raw as Record<string, unknown>;
    requireSchemaV1(r, 'snapshots:v1:set-thumbnail');
    if (typeof r['id'] !== 'string' || r['id'].trim().length === 0) {
      throw new CodesignError('id must be a non-empty string', 'IPC_BAD_INPUT');
    }
    const value = r['thumbnailText'];
    if (value !== null && typeof value !== 'string') {
      throw new CodesignError('thumbnailText must be a string or null', 'IPC_BAD_INPUT');
    }
    const updated = runDb('set-thumbnail', () =>
      setDesignThumbnail(db, r['id'] as string, value as string | null),
    );
    if (updated === null) {
      throw new CodesignError('Design not found', 'IPC_NOT_FOUND');
    }
    return updated;
  });

  ipcMain.handle('snapshots:v1:soft-delete-design', (_e: unknown, raw: unknown): Design => {
    const id = parseIdPayload(raw, 'soft-delete-design');
    const updated = runDb('soft-delete-design', () => softDeleteDesign(db, id));
    if (updated === null) {
      throw new CodesignError('Design not found', 'IPC_NOT_FOUND');
    }
    logger.info('design.soft_deleted', { id });
    return updated;
  });

  ipcMain.handle('snapshots:v1:duplicate-design', (_e: unknown, raw: unknown): Design => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError(
        'snapshots:v1:duplicate-design expects { id, name }',
        'IPC_BAD_INPUT',
      );
    }
    const r = raw as Record<string, unknown>;
    requireSchemaV1(r, 'snapshots:v1:duplicate-design');
    if (typeof r['id'] !== 'string' || r['id'].trim().length === 0) {
      throw new CodesignError('id must be a non-empty string', 'IPC_BAD_INPUT');
    }
    if (typeof r['name'] !== 'string' || r['name'].trim().length === 0) {
      throw new CodesignError('name must be a non-empty string', 'IPC_BAD_INPUT');
    }
    const cloned = runDb('duplicate-design', () =>
      duplicateDesign(db, r['id'] as string, r['name'] as string),
    );
    if (cloned === null) {
      throw new CodesignError('Source design not found', 'IPC_NOT_FOUND');
    }
    logger.info('design.duplicated', { sourceId: r['id'], newId: cloned.id });
    return cloned;
  });
}

export function registerWorkspaceIpc(db: Database, getWin: () => BrowserWindow | null): void {
  ipcMain.handle(
    'snapshots:v1:workspace:pick',
    async (_e: unknown, raw: unknown): Promise<string | null> => {
      if (typeof raw !== 'object' || raw === null) {
        throw new CodesignError(
          'snapshots:v1:workspace:pick expects an object payload',
          'IPC_BAD_INPUT',
        );
      }
      requireSchemaV1(raw as Record<string, unknown>, 'snapshots:v1:workspace:pick');
      const win = getWin();
      if (!win) {
        throw new CodesignError('Window not available', 'IPC_DB_ERROR');
      }
      let result: Awaited<ReturnType<typeof dialog.showOpenDialog>>;
      try {
        result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
      } catch (cause) {
        throw new CodesignError('Failed to open folder picker dialog', 'IPC_DB_ERROR', { cause });
      }
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0] ?? null;
    },
  );

  ipcMain.handle(
    'snapshots:v1:workspace:update',
    async (_e: unknown, raw: unknown): Promise<Design> => {
      if (typeof raw !== 'object' || raw === null) {
        throw new CodesignError(
          'snapshots:v1:workspace:update expects an object payload',
          'IPC_BAD_INPUT',
        );
      }
      const r = raw as Record<string, unknown>;
      requireSchemaV1(r, 'snapshots:v1:workspace:update');

      if (typeof r['designId'] !== 'string' || r['designId'].trim().length === 0) {
        throw new CodesignError('designId must be a non-empty string', 'IPC_BAD_INPUT');
      }
      const workspacePath = r['workspacePath'];
      if (workspacePath !== null && typeof workspacePath !== 'string') {
        throw new CodesignError('workspacePath must be a string or null', 'IPC_BAD_INPUT');
      }
      if (typeof r['migrateFiles'] !== 'boolean') {
        throw new CodesignError('migrateFiles must be a boolean', 'IPC_BAD_INPUT');
      }

      try {
        const design = await bindWorkspace(
          db,
          r['designId'] as string,
          workspacePath as string | null,
          r['migrateFiles'] as boolean,
        );
        if (design === null) {
          throw new CodesignError('Design not found', 'IPC_NOT_FOUND');
        }
        logger.info('design.workspace_updated', {
          id: design.id,
          workspacePath: design.workspacePath,
        });
        return design;
      } catch (err) {
        if (err instanceof CodesignError) throw err;
        if (err instanceof Error && err.message.includes('already bound')) {
          throw new CodesignError(err.message, 'IPC_CONFLICT', { cause: err });
        }
        if (
          err instanceof Error &&
          (err.message.includes('Workspace migration collision') ||
            err.message.includes('Tracked workspace file missing'))
        ) {
          throw new CodesignError(err.message, 'IPC_BAD_INPUT', { cause: err });
        }
        throw new CodesignError('Workspace update failed', 'IPC_DB_ERROR', { cause: err });
      }
    },
  );

  ipcMain.handle(
    'snapshots:v1:workspace:open',
    async (_e: unknown, raw: unknown): Promise<void> => {
      if (typeof raw !== 'object' || raw === null) {
        throw new CodesignError(
          'snapshots:v1:workspace:open expects an object payload',
          'IPC_BAD_INPUT',
        );
      }
      const r = raw as Record<string, unknown>;
      requireSchemaV1(r, 'snapshots:v1:workspace:open');

      if (typeof r['designId'] !== 'string' || r['designId'].trim().length === 0) {
        throw new CodesignError('designId must be a non-empty string', 'IPC_BAD_INPUT');
      }

      const design = runDb('workspace:open', () => getDesign(db, r['designId'] as string));
      if (design === null) {
        throw new CodesignError('Design not found', 'IPC_NOT_FOUND');
      }
      if (design.workspacePath === null) {
        throw new CodesignError('No workspace bound to this design', 'IPC_BAD_INPUT');
      }

      try {
        await openWorkspaceFolder(design.workspacePath);
      } catch (err) {
        throw new CodesignError(
          err instanceof Error ? err.message : 'Failed to open workspace folder',
          'IPC_BAD_INPUT',
          { cause: err instanceof Error ? err : undefined },
        );
      }
    },
  );

  ipcMain.handle(
    'snapshots:v1:workspace:check',
    async (_e: unknown, raw: unknown): Promise<{ exists: boolean }> => {
      if (typeof raw !== 'object' || raw === null) {
        throw new CodesignError(
          'snapshots:v1:workspace:check expects an object payload',
          'IPC_BAD_INPUT',
        );
      }
      const r = raw as Record<string, unknown>;
      requireSchemaV1(r, 'snapshots:v1:workspace:check');

      if (typeof r['designId'] !== 'string' || r['designId'].trim().length === 0) {
        throw new CodesignError('designId must be a non-empty string', 'IPC_BAD_INPUT');
      }

      const design = runDb('workspace:check', () => getDesign(db, r['designId'] as string));
      if (design === null) {
        throw new CodesignError('Design not found', 'IPC_NOT_FOUND');
      }

      if (design.workspacePath === null) {
        throw new CodesignError('Design is not bound to a workspace', 'IPC_BAD_INPUT');
      }

      let exists: boolean;
      try {
        exists = await checkWorkspaceFolderExists(design.workspacePath);
      } catch (cause) {
        throw new CodesignError('Failed to check workspace folder existence', 'IPC_DB_ERROR', {
          cause,
        });
      }
      return { exists };
    },
  );

  ipcMain.handle(
    'codesign:files:v1:list',
    async (_e: unknown, raw: unknown): Promise<WorkspaceFileEntry[]> => {
      if (typeof raw !== 'object' || raw === null) {
        throw new CodesignError('codesign:files:v1:list expects { designId }', 'IPC_BAD_INPUT');
      }
      const r = raw as Record<string, unknown>;
      requireSchemaV1(r, 'codesign:files:v1:list');
      if (typeof r['designId'] !== 'string' || r['designId'].trim().length === 0) {
        throw new CodesignError('designId must be a non-empty string', 'IPC_BAD_INPUT');
      }
      const design = runDb('files:list', () => getDesign(db, r['designId'] as string));
      if (design === null || design.workspacePath === null) return [];
      try {
        return await listWorkspaceFilesAt(design.workspacePath);
      } catch (cause) {
        throw new CodesignError('Failed to list workspace files', 'IPC_DB_ERROR', { cause });
      }
    },
  );

  registerFilesWatcherIpc(db, getWin);
}

function parseIdPayload(raw: unknown, channel: string): string {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError(`snapshots:v1:${channel} expects { id }`, 'IPC_BAD_INPUT');
  }
  const r = raw as Record<string, unknown>;
  requireSchemaV1(r, `snapshots:v1:${channel}`);
  if (typeof r['id'] !== 'string' || r['id'].trim().length === 0) {
    throw new CodesignError('id must be a non-empty string', 'IPC_BAD_INPUT');
  }
  return r['id'] as string;
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
  'snapshots:v1:get-design',
  'snapshots:v1:rename-design',
  'snapshots:v1:set-thumbnail',
  'snapshots:v1:soft-delete-design',
  'snapshots:v1:duplicate-design',
  'snapshots:v1:list',
  'snapshots:v1:get',
  'snapshots:v1:create',
  'snapshots:v1:delete',
  'snapshots:v1:workspace:pick',
  'snapshots:v1:workspace:update',
  'snapshots:v1:workspace:open',
  'snapshots:v1:workspace:check',
  'codesign:files:v1:list',
  'codesign:files:v1:subscribe',
  'codesign:files:v1:unsubscribe',
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
