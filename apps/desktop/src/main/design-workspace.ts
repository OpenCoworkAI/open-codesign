import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Design } from '@open-codesign/shared';
import type Database from 'better-sqlite3';
import { type BrowserWindow, dialog, shell } from 'electron';
import { getLogger } from './logger';
import {
  clearDesignWorkspace,
  getDesign,
  listDesignFiles,
  updateDesignWorkspace,
} from './snapshots-db';

const logger = getLogger('design-workspace');

function stripTrailingSlash(value: string): string {
  if (value === '/' || /^[A-Za-z]:\/$/.test(value)) {
    return value;
  }
  return value.replace(/\/+$/, '');
}

export function normalizeWorkspacePath(p: string): string {
  return stripTrailingSlash(path.resolve(p).replaceAll('\\', '/'));
}

export async function pickWorkspaceFolder(win: BrowserWindow): Promise<string | null> {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0] ?? null;
}

export async function openWorkspaceFolder(p: string): Promise<void> {
  const result = await shell.openPath(p);
  if (result.length > 0) {
    throw new Error(`Failed to open workspace folder: ${result}`);
  }
}

export function checkWorkspaceConflict(
  db: Database.Database,
  designId: string,
  normalizedPath: string,
): boolean {
  const row = db
    .prepare(
      'SELECT 1 FROM designs WHERE workspace_path = ? AND id != ? AND deleted_at IS NULL LIMIT 1',
    )
    .get(normalizedPath, designId);
  return row !== undefined;
}

export async function migrateWorkspaceFiles(
  db: Database.Database,
  designId: string,
  destPath: string,
): Promise<void> {
  const design = getDesign(db, designId);
  if (design === null) {
    throw new Error(`Design not found: ${designId}`);
  }
  if (design.workspacePath === null) {
    throw new Error('Cannot migrate workspace files without an existing workspace path');
  }

  const trackedFiles = listDesignFiles(db, designId);
  const pendingCopies = trackedFiles.map((file) => ({
    source: path.join(design.workspacePath as string, file.path),
    destination: path.join(destPath, file.path),
    relativePath: file.path,
  }));

  for (const copyOp of pendingCopies) {
    if (existsSync(copyOp.destination)) {
      throw new Error(`Workspace migration collision: ${copyOp.relativePath}`);
    }
    if (!existsSync(copyOp.source)) {
      throw new Error(`Tracked workspace file missing: ${copyOp.relativePath}`);
    }
  }

  for (const copyOp of pendingCopies) {
    await mkdir(path.dirname(copyOp.destination), { recursive: true });
    await copyFile(copyOp.source, copyOp.destination);
  }
}

function requireDesign(db: Database.Database, designId: string): Design {
  const design = getDesign(db, designId);
  if (design === null) {
    throw new Error(`Design not found: ${designId}`);
  }
  return design;
}

export function checkWorkspaceFolderExists(p: string): boolean {
  return existsSync(p);
}

export async function bindWorkspace(
  db: Database.Database,
  designId: string,
  workspacePath: string | null,
  migrateFiles: boolean,
): Promise<Design> {
  const current = requireDesign(db, designId);

  if (workspacePath === null) {
    logger.info('workspace.clear.start', { designId });
    const cleared = clearDesignWorkspace(db, designId);
    if (cleared === null) {
      throw new Error(`Design not found: ${designId}`);
    }
    logger.info('workspace.clear.done', { designId });
    return cleared;
  }

  const normalizedPath = normalizeWorkspacePath(workspacePath);
  if (
    current.workspacePath !== null &&
    normalizeWorkspacePath(current.workspacePath) === normalizedPath
  ) {
    logger.info('workspace.bind.noop', { designId, workspacePath: normalizedPath });
    return current;
  }
  if (checkWorkspaceConflict(db, designId, normalizedPath)) {
    throw new Error('Workspace path is already bound to another design');
  }

  logger.info('workspace.bind.start', {
    designId,
    workspacePath: normalizedPath,
    migrateFiles,
  });

  if (migrateFiles) {
    await migrateWorkspaceFiles(db, designId, normalizedPath);
  }

  const updated = updateDesignWorkspace(db, designId, normalizedPath);
  if (updated === null) {
    throw new Error(`Design not found: ${designId}`);
  }

  logger.info('workspace.bind.done', {
    designId,
    workspacePath: normalizedPath,
    migrateFiles,
  });
  return updated;
}
