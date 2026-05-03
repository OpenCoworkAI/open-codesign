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

import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ChatAppendInput,
  ChatMessageRow,
  Design,
  DesignSnapshot,
  SnapshotCreateInput,
} from '@open-codesign/shared';
import { ChatMessageKind, CodesignError } from '@open-codesign/shared';
import type { BrowserWindow } from 'electron';
import {
  bindWorkspace,
  checkWorkspaceFolderExists,
  copyTrackedWorkspaceFiles,
  openWorkspaceFolder,
} from './design-workspace';
import { app, dialog, ipcMain } from './electron-runtime';
import { getLogger } from './logger';
import {
  appendSessionChatMessage,
  appendSessionToolStatus,
  type ChatToolStatusUpdate,
  listSessionChatMessages,
  type SessionChatStoreOptions,
  seedSessionChatFromSnapshots,
} from './session-chat';
import {
  createDesign,
  createSnapshot,
  type Database,
  deleteDesignForRollback,
  deleteSnapshot,
  duplicateDesign,
  getDesign,
  getSnapshot,
  listDesigns,
  listSnapshots,
  normalizeDesignFilePath,
  renameDesign,
  setDesignThumbnail,
  softDeleteDesign,
  upsertDesignFile,
} from './snapshots-db';
import { prepareWorkspaceWriteContent } from './workspace-file-content';
import { normalizeWorkspacePath } from './workspace-path';
import {
  classifyWorkspaceFileKind,
  listWorkspaceFilesAt,
  readWorkspaceFileAt,
  resolveSafeWorkspaceChildPath,
  type WorkspaceFileEntry,
  type WorkspaceFileReadResult,
} from './workspace-reader';
import { registerFilesWatcherIpc } from './workspace-watcher';

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

function isAlreadyExists(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'EEXIST';
}

function resolveDefaultWorkspaceRoot(db: Database): string {
  if (path.isAbsolute(db.dataDir)) {
    return path.join(db.dataDir, 'workspaces');
  }
  return path.join(app.getPath('documents'), 'CoDesign');
}

async function allocateDefaultWorkspacePath(db: Database, name: string): Promise<string> {
  const defaultRoot = resolveDefaultWorkspaceRoot(db);
  await mkdir(defaultRoot, { recursive: true });
  const slug = defaultDesignSlug(name);

  for (let attempt = 0; attempt <= 100; attempt += 1) {
    const workspacePath = path.join(defaultRoot, attempt === 0 ? slug : `${slug}-${attempt}`);
    try {
      await mkdir(workspacePath);
      return workspacePath;
    } catch (err) {
      if (isAlreadyExists(err)) continue;
      throw err;
    }
  }

  throw new Error(`Could not find a unique workspace path under ${defaultRoot}`);
}

async function cleanupAutoAllocatedWorkspace(
  workspacePath: string,
  context: string,
): Promise<void> {
  try {
    await rm(workspacePath, { recursive: true, force: true });
  } catch (err) {
    logger.warn('workspace.auto_cleanup.failed', {
      context,
      workspacePath,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function parseCreateDesignWorkspacePath(r: Record<string, unknown>): string | undefined {
  const raw = r['workspacePath'];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new CodesignError(
      'workspacePath must be a non-empty string when provided',
      'IPC_BAD_INPUT',
    );
  }
  try {
    return normalizeWorkspacePath(raw);
  } catch (cause) {
    throw new CodesignError('workspacePath is invalid', 'IPC_BAD_INPUT', { cause });
  }
}

function translateWorkspaceBindError(err: unknown, fallbackMessage: string): CodesignError {
  if (err instanceof CodesignError) return err;
  if (err instanceof Error && err.message.includes('already bound')) {
    return new CodesignError(err.message, 'IPC_CONFLICT', { cause: err });
  }
  if (
    err instanceof Error &&
    (err.message.includes('Workspace migration collision') ||
      err.message.includes('Tracked workspace file missing') ||
      err.message.includes('Workspace path is not a directory'))
  ) {
    return new CodesignError(err.message, 'IPC_BAD_INPUT', { cause: err });
  }
  if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
    return new CodesignError('Workspace path does not exist', 'IPC_BAD_INPUT', { cause: err });
  }
  return new CodesignError(fallbackMessage, 'IPC_DB_ERROR', { cause: err });
}

function requireBoundWorkspacePath(design: Design, message: string): string {
  if (design.workspacePath === null) {
    throw new CodesignError(message, 'IPC_BAD_INPUT');
  }
  try {
    return normalizeWorkspacePath(design.workspacePath);
  } catch (cause) {
    throw new CodesignError('Stored workspace path is invalid', 'IPC_BAD_INPUT', { cause });
  }
}

/**
 * Translate store errors into typed CodesignErrors so the renderer never sees
 * low-level persistence details.
 */
function translateStoreError(err: unknown, context: string): CodesignError {
  logger.error('snapshot.store_error', {
    context,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  return new CodesignError(`Design store error (${context})`, 'IPC_DB_ERROR', { cause: err });
}

function runDb<T>(context: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof CodesignError) throw err;
    throw translateStoreError(err, context);
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

function parseDesignIdPayload(raw: unknown, channel: string): string {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError(`${channel} expects an object with designId`, 'IPC_BAD_INPUT');
  }
  const r = raw as Record<string, unknown>;
  requireSchemaV1(r, channel);
  if (typeof r['designId'] !== 'string' || r['designId'].trim().length === 0) {
    throw new CodesignError('designId must be a non-empty string', 'IPC_BAD_INPUT');
  }
  return r['designId'] as string;
}

function parseChatAppendInput(raw: unknown): ChatAppendInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('chat:v1:append expects a chat message object', 'IPC_BAD_INPUT');
  }
  const r = raw as Record<string, unknown>;
  requireSchemaV1(r, 'chat:v1:append');
  if (typeof r['designId'] !== 'string' || r['designId'].trim().length === 0) {
    throw new CodesignError('designId must be a non-empty string', 'IPC_BAD_INPUT');
  }
  const kind = ChatMessageKind.safeParse(r['kind']);
  if (!kind.success) {
    throw new CodesignError('kind must be a valid chat message kind', 'IPC_BAD_INPUT');
  }
  const snapshotId = r['snapshotId'];
  if (snapshotId !== undefined && snapshotId !== null && typeof snapshotId !== 'string') {
    throw new CodesignError('snapshotId must be a string or null', 'IPC_BAD_INPUT');
  }
  const base: ChatAppendInput = {
    designId: r['designId'] as string,
    kind: kind.data,
    payload: r['payload'] ?? {},
  };
  if (snapshotId !== undefined) {
    return { ...base, snapshotId: snapshotId as string | null };
  }
  return base;
}

function parseToolStatusInput(raw: unknown): ChatToolStatusUpdate {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError(
      'chat:v1:update-tool-status expects an object payload',
      'IPC_BAD_INPUT',
    );
  }
  const r = raw as Record<string, unknown>;
  requireSchemaV1(r, 'chat:v1:update-tool-status');
  if (typeof r['designId'] !== 'string' || r['designId'].trim().length === 0) {
    throw new CodesignError('designId must be a non-empty string', 'IPC_BAD_INPUT');
  }
  if (!Number.isInteger(r['seq']) || (r['seq'] as number) < 0) {
    throw new CodesignError('seq must be a non-negative integer', 'IPC_BAD_INPUT');
  }
  if (r['status'] !== 'done' && r['status'] !== 'error') {
    throw new CodesignError('status must be done or error', 'IPC_BAD_INPUT');
  }
  if (r['durationMs'] !== undefined && typeof r['durationMs'] !== 'number') {
    throw new CodesignError('durationMs must be a number when provided', 'IPC_BAD_INPUT');
  }
  if (r['errorMessage'] !== undefined && typeof r['errorMessage'] !== 'string') {
    throw new CodesignError('errorMessage must be a string when provided', 'IPC_BAD_INPUT');
  }
  return {
    designId: r['designId'] as string,
    seq: r['seq'] as number,
    status: r['status'] as 'done' | 'error',
    ...(r['result'] !== undefined ? { result: r['result'] } : {}),
    ...(typeof r['durationMs'] === 'number' ? { durationMs: r['durationMs'] } : {}),
    ...(typeof r['errorMessage'] === 'string' ? { errorMessage: r['errorMessage'] } : {}),
  };
}

function chatStoreOptions(db: Database): SessionChatStoreOptions {
  return {
    db,
    sessionDir: db.sessionDir,
  };
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
      const requestedWorkspacePath = parseCreateDesignWorkspacePath(r);
      const design = runDb('create-design', () => createDesign(db, name));
      // v0.2: every design must have a workspace. When the user has not picked
      // one explicitly, seed it under the active data directory so Storage >
      // Data applies to future default workspaces. Existing designs keep their
      // explicit binding until the user changes or migrates it from Files.
      let autoWorkspacePath: string | null = null;
      try {
        const workspacePath =
          requestedWorkspacePath ?? (await allocateDefaultWorkspacePath(db, name));
        if (requestedWorkspacePath === undefined) {
          autoWorkspacePath = workspacePath;
        }
        return await bindWorkspace(db, design.id, workspacePath, false);
      } catch (err) {
        if (autoWorkspacePath !== null) {
          await cleanupAutoAllocatedWorkspace(autoWorkspacePath, 'create-design');
        }
        try {
          runDb('create-design.rollback', () => deleteDesignForRollback(db, design.id));
        } catch (rollbackErr) {
          logger.error('create-design.rollback.failed', {
            designId: design.id,
            error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
          });
        }
        logger.warn('create-design.workspace.failed', {
          designId: design.id,
          requested: requestedWorkspacePath !== undefined,
          error: err instanceof Error ? err.message : String(err),
        });
        throw translateWorkspaceBindError(err, 'Workspace creation failed');
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

  ipcMain.handle(
    'snapshots:v1:duplicate-design',
    async (_e: unknown, raw: unknown): Promise<Design> => {
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
      const sourceId = r['id'] as string;
      const name = (r['name'] as string).trim();
      const source = runDb('duplicate-design.lookup-source', () => getDesign(db, sourceId));
      if (source === null) {
        throw new CodesignError('Source design not found', 'IPC_NOT_FOUND');
      }
      const sourceWorkspacePath = requireBoundWorkspacePath(
        source,
        'Source design is not bound to a workspace',
      );
      const cloned = runDb('duplicate-design', () => duplicateDesign(db, sourceId, name));
      if (cloned === null) {
        throw new CodesignError('Source design not found', 'IPC_NOT_FOUND');
      }
      let autoWorkspacePath: string | null = null;
      try {
        const workspacePath = await allocateDefaultWorkspacePath(db, name);
        autoWorkspacePath = workspacePath;
        await copyTrackedWorkspaceFiles(db, sourceId, sourceWorkspacePath, workspacePath);
        const bound = await bindWorkspace(db, cloned.id, workspacePath, false);
        logger.info('design.duplicated', { sourceId, newId: bound.id });
        return bound;
      } catch (err) {
        if (autoWorkspacePath !== null) {
          await cleanupAutoAllocatedWorkspace(autoWorkspacePath, 'duplicate-design');
        }
        try {
          runDb('duplicate-design.rollback', () => deleteDesignForRollback(db, cloned.id));
        } catch (rollbackErr) {
          logger.error('duplicate-design.rollback.failed', {
            designId: cloned.id,
            error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
          });
        }
        logger.warn('duplicate-design.workspace.failed', {
          sourceId,
          newId: cloned.id,
          error: err instanceof Error ? err.message : String(err),
        });
        throw translateWorkspaceBindError(err, 'Workspace creation failed');
      }
    },
  );

  ipcMain.handle('chat:v1:list', (_e: unknown, raw: unknown): ChatMessageRow[] => {
    const designId = parseDesignIdPayload(raw, 'chat:v1:list');
    return runDb('chat:list', () => listSessionChatMessages(chatStoreOptions(db), designId));
  });

  ipcMain.handle('chat:v1:append', (_e: unknown, raw: unknown): ChatMessageRow => {
    const input = parseChatAppendInput(raw);
    return runDb('chat:append', () => appendSessionChatMessage(chatStoreOptions(db), input));
  });

  ipcMain.handle(
    'chat:v1:seed-from-snapshots',
    (_e: unknown, raw: unknown): { inserted: number } => {
      const designId = parseDesignIdPayload(raw, 'chat:v1:seed-from-snapshots');
      return runDb('chat:seed-from-snapshots', () => ({
        inserted: seedSessionChatFromSnapshots(chatStoreOptions(db), designId),
      }));
    },
  );

  ipcMain.handle('chat:v1:update-tool-status', (_e: unknown, raw: unknown): { ok: true } => {
    const input = parseToolStatusInput(raw);
    runDb('chat:update-tool-status', () => appendSessionToolStatus(chatStoreOptions(db), input));
    return { ok: true };
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
      if (workspacePath === null) {
        throw new CodesignError('workspacePath cannot be null in v0.2', 'IPC_BAD_INPUT');
      }
      if (typeof workspacePath !== 'string') {
        throw new CodesignError('workspacePath must be a string', 'IPC_BAD_INPUT');
      }
      if (typeof r['migrateFiles'] !== 'boolean') {
        throw new CodesignError('migrateFiles must be a boolean', 'IPC_BAD_INPUT');
      }

      try {
        const design = await bindWorkspace(
          db,
          r['designId'] as string,
          workspacePath,
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
        throw translateWorkspaceBindError(err, 'Workspace update failed');
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
      const workspacePath = requireBoundWorkspacePath(design, 'No workspace bound to this design');

      try {
        await openWorkspaceFolder(workspacePath);
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

      const workspacePath = requireBoundWorkspacePath(design, 'Design is not bound to a workspace');

      let exists: boolean;
      try {
        exists = await checkWorkspaceFolderExists(workspacePath);
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
      if (design === null) {
        throw new CodesignError('Design not found', 'IPC_NOT_FOUND');
      }
      if (design.workspacePath === null) {
        logger.warn('files.list.workspace_missing', { designId: design.id });
        return [];
      }
      const workspacePath = requireBoundWorkspacePath(design, 'Design is not bound to a workspace');
      try {
        return await listWorkspaceFilesAt(workspacePath);
      } catch (cause) {
        throw new CodesignError('Failed to list workspace files', 'IPC_DB_ERROR', { cause });
      }
    },
  );

  ipcMain.handle(
    'codesign:files:v1:read',
    async (_e: unknown, raw: unknown): Promise<WorkspaceFileReadResult> => {
      if (typeof raw !== 'object' || raw === null) {
        throw new CodesignError(
          'codesign:files:v1:read expects { designId, path }',
          'IPC_BAD_INPUT',
        );
      }
      const r = raw as Record<string, unknown>;
      requireSchemaV1(r, 'codesign:files:v1:read');
      if (typeof r['designId'] !== 'string' || r['designId'].trim().length === 0) {
        throw new CodesignError('designId must be a non-empty string', 'IPC_BAD_INPUT');
      }
      if (typeof r['path'] !== 'string' || r['path'].trim().length === 0) {
        throw new CodesignError('path must be a non-empty string', 'IPC_BAD_INPUT');
      }
      const design = runDb('files:read', () => getDesign(db, r['designId'] as string));
      if (design === null) {
        throw new CodesignError('Design not found', 'IPC_NOT_FOUND');
      }
      if (design.workspacePath === null) {
        const requestedPath = r['path'] as string;
        return {
          path: requestedPath,
          kind: classifyWorkspaceFileKind(requestedPath),
          size: 0,
          updatedAt: new Date(0).toISOString(),
          content: '',
        };
      }
      const workspacePath = requireBoundWorkspacePath(design, 'Design is not bound to a workspace');
      try {
        return await readWorkspaceFileAt(workspacePath, r['path'] as string);
      } catch (cause) {
        throw new CodesignError('Failed to read workspace file', 'IPC_BAD_INPUT', { cause });
      }
    },
  );

  ipcMain.handle(
    'codesign:files:v1:write',
    async (_e: unknown, raw: unknown): Promise<WorkspaceFileReadResult> => {
      if (typeof raw !== 'object' || raw === null) {
        throw new CodesignError(
          'codesign:files:v1:write expects { designId, path, content }',
          'IPC_BAD_INPUT',
        );
      }
      const r = raw as Record<string, unknown>;
      requireSchemaV1(r, 'codesign:files:v1:write');
      if (typeof r['designId'] !== 'string' || r['designId'].trim().length === 0) {
        throw new CodesignError('designId must be a non-empty string', 'IPC_BAD_INPUT');
      }
      if (typeof r['path'] !== 'string' || r['path'].trim().length === 0) {
        throw new CodesignError('path must be a non-empty string', 'IPC_BAD_INPUT');
      }
      if (typeof r['content'] !== 'string') {
        throw new CodesignError('content must be a string', 'IPC_BAD_INPUT');
      }

      let normalizedPath: string;
      try {
        normalizedPath = normalizeDesignFilePath(r['path'] as string);
      } catch (cause) {
        throw new CodesignError('Invalid workspace file path', 'IPC_BAD_INPUT', { cause });
      }

      const designId = r['designId'] as string;
      const content = r['content'] as string;
      const design = runDb('files:write.lookup-design', () => getDesign(db, designId));
      if (design === null) {
        throw new CodesignError('Design not found', 'IPC_NOT_FOUND');
      }
      if (design.workspacePath === null) {
        throw new CodesignError('Design is not bound to a workspace', 'IPC_BAD_INPUT');
      }
      const workspacePath = requireBoundWorkspacePath(design, 'Design is not bound to a workspace');

      let destinationPath: string;
      try {
        destinationPath = await resolveSafeWorkspaceChildPath(workspacePath, normalizedPath);
      } catch (cause) {
        throw new CodesignError('Invalid workspace file path', 'IPC_BAD_INPUT', { cause });
      }
      const writeContent = prepareWorkspaceWriteContent(normalizedPath, content);
      try {
        await mkdir(path.dirname(destinationPath), { recursive: true });
        if (typeof writeContent.diskContent === 'string') {
          await writeFile(destinationPath, writeContent.diskContent, 'utf8');
        } else {
          await writeFile(destinationPath, writeContent.diskContent);
        }
      } catch (cause) {
        throw new CodesignError('Failed to write workspace file', 'IPC_DB_ERROR', { cause });
      }

      runDb('files:write.upsert-design-file', () =>
        upsertDesignFile(db, designId, normalizedPath, writeContent.storedContent),
      );

      if (writeContent.isBinaryAsset) {
        try {
          const s = await stat(destinationPath);
          return {
            path: normalizedPath,
            kind: classifyWorkspaceFileKind(normalizedPath),
            size: s.size,
            updatedAt: s.mtime.toISOString(),
            content: writeContent.storedContent,
          };
        } catch (cause) {
          throw new CodesignError('Failed to stat written workspace file', 'IPC_DB_ERROR', {
            cause,
          });
        }
      }

      try {
        return await readWorkspaceFileAt(workspacePath, normalizedPath);
      } catch (cause) {
        throw new CodesignError('Failed to read written workspace file', 'IPC_DB_ERROR', {
          cause,
        });
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
  'codesign:files:v1:read',
  'codesign:files:v1:write',
  'codesign:files:v1:subscribe',
  'codesign:files:v1:unsubscribe',
  'chat:v1:list',
  'chat:v1:append',
  'chat:v1:seed-from-snapshots',
  'chat:v1:update-tool-status',
] as const;

export function registerSnapshotsUnavailableIpc(reason: string): void {
  const message = `Design store failed to initialize. Check Settings → Storage for diagnostics. (${reason})`;
  const fail = (): never => {
    throw new CodesignError(message, 'SNAPSHOTS_UNAVAILABLE');
  };
  for (const channel of SNAPSHOTS_CHANNELS_V1) {
    ipcMain.handle(channel, fail);
  }
}
