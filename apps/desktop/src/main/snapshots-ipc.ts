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

import { copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
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
import {
  createWorkspaceDocumentPreview,
  createWorkspaceDocumentThumbnail,
  type WorkspaceDocumentPreviewResult,
  type WorkspaceDocumentThumbnailResult,
} from './document-preview';
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
  touchDesignActivity,
  updateDesignWorkspace,
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
 * slug style — Unicode letters/numbers + dashes, max 48 chars.
 */
export function defaultDesignSlug(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 48);
  return cleaned.length > 0 ? cleaned : 'untitled-design';
}

function defaultWorkspaceRoot(): string {
  return path.join(app.getPath('documents'), 'CoDesign');
}

function isDefaultWorkspaceNameForDesign(workspacePath: string, designName: string): boolean {
  const base = path.basename(workspacePath);
  const slug = defaultDesignSlug(designName);
  return base === slug || base.startsWith(`${slug}-`);
}

export function isAutoManagedWorkspacePath(input: {
  workspacePath: string;
  designName: string;
  defaultRoot: string;
}): boolean {
  const workspacePath = normalizeWorkspacePath(input.workspacePath);
  const defaultRoot = normalizeWorkspacePath(input.defaultRoot);
  return (
    path.dirname(workspacePath) === defaultRoot &&
    isDefaultWorkspaceNameForDesign(workspacePath, input.designName)
  );
}

function isAlreadyExists(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'EEXIST';
}

async function allocateDefaultWorkspacePath(name: string): Promise<string> {
  const defaultRoot = defaultWorkspaceRoot();
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

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

async function allocateRenamedDefaultWorkspacePath(
  defaultRoot: string,
  name: string,
  currentPath: string,
): Promise<string | null> {
  const slug = defaultDesignSlug(name);
  for (let attempt = 0; attempt <= 100; attempt += 1) {
    const candidate = path.join(defaultRoot, attempt === 0 ? slug : `${slug}-${attempt}`);
    if (candidate === currentPath) return null;
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error(`Could not find a unique renamed workspace path under ${defaultRoot}`);
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

type WorkspaceImportSource = 'composer' | 'workspace' | 'canvas' | 'clipboard';
type WorkspaceImportKind = 'reference' | 'asset';

interface WorkspaceImportFileInput {
  path: string;
  name?: string;
  size?: number;
}

interface WorkspaceImportBlobInput {
  name?: string;
  mediaType: string;
  dataBase64: string;
}

interface WorkspaceImportResult {
  path: string;
  absolutePath: string;
  name: string;
  size: number;
  mediaType: string;
  kind: WorkspaceImportKind;
  source: WorkspaceImportSource;
}

const ASSET_EXTENSIONS = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.mp3',
  '.mp4',
  '.ogg',
  '.otf',
  '.png',
  '.svg',
  '.ttf',
  '.wav',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.jsx': 'text/javascript',
  '.md': 'text/markdown',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.toml': 'application/toml',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.txt': 'text/plain',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
};

function parseImportSource(value: unknown): WorkspaceImportSource {
  if (
    value === 'composer' ||
    value === 'workspace' ||
    value === 'canvas' ||
    value === 'clipboard'
  ) {
    return value;
  }
  throw new CodesignError(
    'source must be composer, workspace, canvas, or clipboard',
    'IPC_BAD_INPUT',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeImportName(input: string, fallback: string): string {
  const base = path
    .basename(input.trim() || fallback)
    .replace(/[\\/:*?"<>|]/g, '-')
    .split('')
    .map((char) => (char.charCodeAt(0) < 32 ? '-' : char))
    .join('');
  return base.length > 0 ? base : fallback;
}

function extensionForMediaType(mediaType: string): string {
  if (mediaType === 'image/png') return '.png';
  if (mediaType === 'image/jpeg') return '.jpg';
  if (mediaType === 'image/webp') return '.webp';
  if (mediaType === 'image/gif') return '.gif';
  if (mediaType === 'image/svg+xml') return '.svg';
  if (mediaType === 'application/pdf') return '.pdf';
  if (mediaType.startsWith('text/')) return '.txt';
  return '.bin';
}

function mediaTypeForName(name: string, fallback = 'application/octet-stream'): string {
  return MIME_BY_EXTENSION[path.extname(name).toLowerCase()] ?? fallback;
}

function pastedName(
  name: string | undefined,
  mediaType: string,
  timestamp: string | undefined,
): string {
  const sanitized = sanitizeImportName(name ?? '', '');
  if (sanitized.length > 0) return sanitized;
  const stamp = (timestamp ? new Date(timestamp) : new Date())
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '')
    .replace('T', '-');
  return `pasted-${stamp}${extensionForMediaType(mediaType)}`;
}

function importKindFor(
  source: WorkspaceImportSource,
  name: string,
  mediaType: string,
): WorkspaceImportKind {
  if (source === 'composer' || source === 'canvas' || source === 'clipboard') return 'reference';
  const ext = path.extname(name).toLowerCase();
  if (ASSET_EXTENSIONS.has(ext)) return 'asset';
  if (
    mediaType.startsWith('image/') ||
    mediaType.startsWith('video/') ||
    mediaType.startsWith('audio/')
  ) {
    return 'asset';
  }
  return 'reference';
}

async function uniqueWorkspaceDestination(
  workspacePath: string,
  kind: WorkspaceImportKind,
  name: string,
): Promise<{ relativePath: string; absolutePath: string; name: string }> {
  const dir = kind === 'asset' ? 'assets' : 'references';
  const parsed = path.parse(sanitizeImportName(name, 'imported-file'));
  const ext = parsed.ext;
  const stem = parsed.name.length > 0 ? parsed.name : 'imported-file';
  for (let index = 1; index < 10_000; index += 1) {
    const candidateName = index === 1 ? `${stem}${ext}` : `${stem}-${index}${ext}`;
    const relativePath = `${dir}/${candidateName}`;
    const absolutePath = await resolveSafeWorkspaceChildPath(workspacePath, relativePath);
    try {
      await stat(absolutePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { relativePath, absolutePath, name: candidateName };
      }
      throw err;
    }
  }
  throw new CodesignError('Could not allocate a unique import filename', 'IPC_DB_ERROR');
}

function parseImportFiles(value: unknown): WorkspaceImportFileInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new CodesignError('files must be an array', 'IPC_BAD_INPUT');
  return value.map((entry, index) => {
    if (
      !isRecord(entry) ||
      typeof entry['path'] !== 'string' ||
      entry['path'].trim().length === 0
    ) {
      throw new CodesignError(`files[${index}].path must be a non-empty string`, 'IPC_BAD_INPUT');
    }
    return {
      path: entry['path'],
      ...(typeof entry['name'] === 'string' ? { name: entry['name'] } : {}),
      ...(typeof entry['size'] === 'number' ? { size: entry['size'] } : {}),
    };
  });
}

function parseImportBlobs(value: unknown): WorkspaceImportBlobInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new CodesignError('blobs must be an array', 'IPC_BAD_INPUT');
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new CodesignError(`blobs[${index}] must be an object`, 'IPC_BAD_INPUT');
    }
    if (typeof entry['mediaType'] !== 'string' || entry['mediaType'].trim().length === 0) {
      throw new CodesignError(
        `blobs[${index}].mediaType must be a non-empty string`,
        'IPC_BAD_INPUT',
      );
    }
    if (typeof entry['dataBase64'] !== 'string' || entry['dataBase64'].trim().length === 0) {
      throw new CodesignError(
        `blobs[${index}].dataBase64 must be a non-empty string`,
        'IPC_BAD_INPUT',
      );
    }
    return {
      ...(typeof entry['name'] === 'string' ? { name: entry['name'] } : {}),
      mediaType: entry['mediaType'],
      dataBase64: entry['dataBase64'],
    };
  });
}

function runDb<T>(context: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof CodesignError) throw err;
    throw translateStoreError(err, context);
  }
}

const workspaceRenameQueues = new Map<string, Promise<void>>();

async function waitForWorkspaceRename(designId: string): Promise<void> {
  await workspaceRenameQueues.get(designId);
}

async function runWithWorkspaceRenameQueue<T>(
  designId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = workspaceRenameQueues.get(designId) ?? Promise.resolve();
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => gate);
  workspaceRenameQueues.set(designId, queued);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (workspaceRenameQueues.get(designId) === queued) {
      workspaceRenameQueues.delete(designId);
    }
  }
}

async function getDesignAfterPendingWorkspaceRename(
  db: Database,
  context: string,
  designId: string,
): Promise<Design | null> {
  await waitForWorkspaceRename(designId);
  return runDb(context, () => getDesign(db, designId));
}

export async function renameAutoManagedWorkspaceForDesign(input: {
  db: Database;
  designBeforeRename: Design;
  newName: string;
  defaultRoot?: string | undefined;
}): Promise<Design | null> {
  const workspacePath = input.designBeforeRename.workspacePath;
  if (workspacePath === null) return null;

  const defaultRoot = normalizeWorkspacePath(input.defaultRoot ?? defaultWorkspaceRoot());
  const currentPath = normalizeWorkspacePath(workspacePath);
  if (
    !isAutoManagedWorkspacePath({
      workspacePath: currentPath,
      designName: input.designBeforeRename.name,
      defaultRoot,
    })
  ) {
    return null;
  }

  const nextPath = await allocateRenamedDefaultWorkspacePath(
    defaultRoot,
    input.newName,
    currentPath,
  );
  if (nextPath === null) return null;

  await rename(currentPath, nextPath);
  return runDb('rename-design.workspace', () =>
    updateDesignWorkspace(input.db, input.designBeforeRename.id, nextPath),
  );
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
      // v0.2: every design MUST have a workspace — per docs/v0.2-plan.md §2.3.
      // When the user hasn't picked one explicitly, seed
      //   <Documents>/CoDesign/<slug(name)>[-N]/
      // and bind it. Collision suffix handles duplicate names.
      let autoWorkspacePath: string | null = null;
      try {
        const workspacePath = requestedWorkspacePath ?? (await allocateDefaultWorkspacePath(name));
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

  ipcMain.handle(
    'snapshots:v1:rename-design',
    async (_e: unknown, raw: unknown): Promise<Design> => {
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
      const designId = r['id'] as string;
      const name = r['name'] as string;
      return await runWithWorkspaceRenameQueue(designId, async () => {
        const before = runDb('rename-design.lookup', () => getDesign(db, designId));
        if (before === null) {
          throw new CodesignError('Design not found', 'IPC_NOT_FOUND');
        }
        const updated = runDb('rename-design', () => renameDesign(db, designId, name));
        if (updated === null) {
          throw new CodesignError('Design not found', 'IPC_NOT_FOUND');
        }
        let finalDesign = updated;
        try {
          finalDesign =
            (await renameAutoManagedWorkspaceForDesign({
              db,
              designBeforeRename: before,
              newName: updated.name,
            })) ?? updated;
        } catch (err) {
          logger.warn('design.workspace_rename.skipped', {
            id: updated.id,
            workspacePath: before.workspacePath,
            targetName: updated.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        logger.info('design.renamed', {
          id: finalDesign.id,
          name: finalDesign.name,
          workspacePath: finalDesign.workspacePath,
        });
        return finalDesign;
      });
    },
  );

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
        const workspacePath = await allocateDefaultWorkspacePath(name);
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

      const designId = r['designId'] as string;
      const design = await getDesignAfterPendingWorkspaceRename(db, 'workspace:open', designId);
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

      const designId = r['designId'] as string;
      const design = await getDesignAfterPendingWorkspaceRename(db, 'workspace:check', designId);
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
      const designId = r['designId'] as string;
      const design = await getDesignAfterPendingWorkspaceRename(db, 'files:list', designId);
      if (design === null) {
        throw new CodesignError('Design not found', 'IPC_NOT_FOUND');
      }
      if (design.workspacePath === null) {
        logger.warn('files.list.workspace_missing', { designId: design.id });
        return [];
      }
      const workspacePath = requireBoundWorkspacePath(design, 'Design is not bound to a workspace');
      if (!checkWorkspaceFolderExists(workspacePath)) {
        logger.warn('files.list.workspace_unavailable', {
          designId: design.id,
          workspacePath,
        });
        return [];
      }
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
      const designId = r['designId'] as string;
      const design = await getDesignAfterPendingWorkspaceRename(db, 'files:read', designId);
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
    'codesign:files:v1:preview',
    async (_e: unknown, raw: unknown): Promise<WorkspaceDocumentPreviewResult> => {
      if (typeof raw !== 'object' || raw === null) {
        throw new CodesignError(
          'codesign:files:v1:preview expects { designId, path }',
          'IPC_BAD_INPUT',
        );
      }
      const r = raw as Record<string, unknown>;
      requireSchemaV1(r, 'codesign:files:v1:preview');
      if (typeof r['designId'] !== 'string' || r['designId'].trim().length === 0) {
        throw new CodesignError('designId must be a non-empty string', 'IPC_BAD_INPUT');
      }
      if (typeof r['path'] !== 'string' || r['path'].trim().length === 0) {
        throw new CodesignError('path must be a non-empty string', 'IPC_BAD_INPUT');
      }
      const designId = r['designId'] as string;
      const design = await getDesignAfterPendingWorkspaceRename(db, 'files:preview', designId);
      if (design === null) {
        throw new CodesignError('Design not found', 'IPC_NOT_FOUND');
      }
      if (design.workspacePath === null) {
        throw new CodesignError('Design is not bound to a workspace', 'IPC_BAD_INPUT');
      }
      let normalizedPath: string;
      try {
        normalizedPath = normalizeDesignFilePath(r['path'] as string);
      } catch (cause) {
        throw new CodesignError('Invalid workspace file path', 'IPC_BAD_INPUT', { cause });
      }
      const workspacePath = requireBoundWorkspacePath(design, 'Design is not bound to a workspace');
      let absPath: string;
      try {
        absPath = await resolveSafeWorkspaceChildPath(workspacePath, normalizedPath);
      } catch (cause) {
        throw new CodesignError('Invalid workspace file path', 'IPC_BAD_INPUT', { cause });
      }
      try {
        return await createWorkspaceDocumentPreview({ absPath, relPath: normalizedPath });
      } catch (cause) {
        throw new CodesignError('Failed to preview workspace file', 'IPC_BAD_INPUT', { cause });
      }
    },
  );

  ipcMain.handle(
    'codesign:files:v1:thumbnail',
    async (_e: unknown, raw: unknown): Promise<WorkspaceDocumentThumbnailResult> => {
      if (typeof raw !== 'object' || raw === null) {
        throw new CodesignError(
          'codesign:files:v1:thumbnail expects { designId, path }',
          'IPC_BAD_INPUT',
        );
      }
      const r = raw as Record<string, unknown>;
      requireSchemaV1(r, 'codesign:files:v1:thumbnail');
      if (typeof r['designId'] !== 'string' || r['designId'].trim().length === 0) {
        throw new CodesignError('designId must be a non-empty string', 'IPC_BAD_INPUT');
      }
      if (typeof r['path'] !== 'string' || r['path'].trim().length === 0) {
        throw new CodesignError('path must be a non-empty string', 'IPC_BAD_INPUT');
      }
      const designId = r['designId'] as string;
      const design = await getDesignAfterPendingWorkspaceRename(db, 'files:thumbnail', designId);
      if (design === null) {
        throw new CodesignError('Design not found', 'IPC_NOT_FOUND');
      }
      if (design.workspacePath === null) {
        throw new CodesignError('Design is not bound to a workspace', 'IPC_BAD_INPUT');
      }
      let normalizedPath: string;
      try {
        normalizedPath = normalizeDesignFilePath(r['path'] as string);
      } catch (cause) {
        throw new CodesignError('Invalid workspace file path', 'IPC_BAD_INPUT', { cause });
      }
      const workspacePath = requireBoundWorkspacePath(design, 'Design is not bound to a workspace');
      let absPath: string;
      try {
        absPath = await resolveSafeWorkspaceChildPath(workspacePath, normalizedPath);
      } catch (cause) {
        throw new CodesignError('Invalid workspace file path', 'IPC_BAD_INPUT', { cause });
      }
      return await createWorkspaceDocumentThumbnail({ absPath, relPath: normalizedPath });
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

      const content = r['content'] as string;
      const designId = r['designId'] as string;
      const design = await getDesignAfterPendingWorkspaceRename(
        db,
        'files:write.lookup-design',
        designId,
      );
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

  ipcMain.handle(
    'codesign:files:v1:import-to-workspace',
    async (_e: unknown, raw: unknown): Promise<WorkspaceImportResult[]> => {
      if (typeof raw !== 'object' || raw === null) {
        throw new CodesignError(
          'codesign:files:v1:import-to-workspace expects { designId, source, files?, blobs? }',
          'IPC_BAD_INPUT',
        );
      }
      const r = raw as Record<string, unknown>;
      requireSchemaV1(r, 'codesign:files:v1:import-to-workspace');
      if (typeof r['designId'] !== 'string' || r['designId'].trim().length === 0) {
        throw new CodesignError('designId must be a non-empty string', 'IPC_BAD_INPUT');
      }
      const source = parseImportSource(r['source']);
      const files = parseImportFiles(r['files']);
      const blobs = parseImportBlobs(r['blobs']);
      const timestamp = typeof r['timestamp'] === 'string' ? r['timestamp'] : undefined;
      if (files.length === 0 && blobs.length === 0) return [];

      const designId = r['designId'] as string;
      const design = await getDesignAfterPendingWorkspaceRename(
        db,
        'files:import.lookup-design',
        designId,
      );
      if (design === null) {
        throw new CodesignError('Design not found', 'IPC_NOT_FOUND');
      }
      if (design.workspacePath === null) {
        throw new CodesignError('Design is not bound to a workspace', 'IPC_BAD_INPUT');
      }
      const workspacePath = requireBoundWorkspacePath(design, 'Design is not bound to a workspace');
      const imported: WorkspaceImportResult[] = [];

      for (const file of files) {
        const sourcePath = path.resolve(file.path);
        const sourceStat = await stat(sourcePath);
        if (!sourceStat.isFile()) {
          throw new CodesignError('Imported path must be a file', 'IPC_BAD_INPUT');
        }
        const inputName = sanitizeImportName(file.name ?? sourcePath, 'imported-file');
        const mediaType = mediaTypeForName(inputName);
        const kind = importKindFor(source, inputName, mediaType);
        const destination = await uniqueWorkspaceDestination(workspacePath, kind, inputName);
        await mkdir(path.dirname(destination.absolutePath), { recursive: true });
        await copyFile(sourcePath, destination.absolutePath);
        const written = await stat(destination.absolutePath);
        imported.push({
          path: destination.relativePath,
          absolutePath: destination.absolutePath,
          name: destination.name,
          size: written.size,
          mediaType,
          kind,
          source,
        });
      }

      for (const blob of blobs) {
        const inputName = pastedName(blob.name, blob.mediaType, timestamp);
        const mediaType = blob.mediaType;
        const kind = importKindFor(source, inputName, mediaType);
        const destination = await uniqueWorkspaceDestination(workspacePath, kind, inputName);
        await mkdir(path.dirname(destination.absolutePath), { recursive: true });
        const bytes = Buffer.from(blob.dataBase64, 'base64');
        await writeFile(destination.absolutePath, bytes);
        const written = await stat(destination.absolutePath);
        imported.push({
          path: destination.relativePath,
          absolutePath: destination.absolutePath,
          name: destination.name,
          size: written.size,
          mediaType,
          kind,
          source,
        });
      }

      runDb('files:import.touch-design', () => touchDesignActivity(db, designId));

      return imported;
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
  'codesign:files:v1:preview',
  'codesign:files:v1:thumbnail',
  'codesign:files:v1:write',
  'codesign:files:v1:import-to-workspace',
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
