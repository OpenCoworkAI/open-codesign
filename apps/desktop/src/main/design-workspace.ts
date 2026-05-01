import { existsSync } from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Design } from '@open-codesign/shared';
import { type BrowserWindow, dialog, shell } from 'electron';
import { getLogger } from './logger';
import {
  clearDesignWorkspace,
  type Database,
  getDesign,
  listDesigns,
  updateDesignWorkspace,
} from './snapshots-db';
import { normalizeWorkspacePath } from './workspace-path';
import { listWorkspaceFilesAt, resolveSafeWorkspaceChildPath } from './workspace-reader';

export { normalizeWorkspacePath } from './workspace-path';

const logger = getLogger('design-workspace');

function workspacePathComparisonKey(p: string): string {
  const normalized = normalizeWorkspacePath(p);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
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
  db: Database,
  designId: string,
  normalizedPath: string,
): boolean {
  const comparisonPath = workspacePathComparisonKey(normalizedPath);
  return listDesigns(db).some(
    (design) =>
      design.id !== designId &&
      design.workspacePath !== null &&
      workspacePathComparisonKey(design.workspacePath) === comparisonPath,
  );
}

export async function migrateWorkspaceFiles(
  db: Database,
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
  const sourceRoot = normalizeWorkspacePath(design.workspacePath);
  const destinationRoot = normalizeWorkspacePath(destPath);

  await copyTrackedWorkspaceFiles(db, designId, sourceRoot, destinationRoot);
}

export async function copyTrackedWorkspaceFiles(
  _db: Database,
  _designId: string,
  sourceRoot: string,
  destPath: string,
): Promise<void> {
  const source = normalizeWorkspacePath(sourceRoot);
  const destinationRoot = normalizeWorkspacePath(destPath);
  const trackedFiles = await listWorkspaceFilesAt(source);
  const pendingCopies = await Promise.all(
    trackedFiles.map(async (file) => ({
      source: await resolveSafeWorkspaceChildPath(source, file.path),
      destination: await resolveSafeWorkspaceChildPath(destinationRoot, file.path),
      relativePath: file.path,
    })),
  );

  for (const copyOp of pendingCopies) {
    if (existsSync(copyOp.destination)) {
      throw new Error(`Workspace migration collision: ${copyOp.relativePath}`);
    }
    if (!existsSync(copyOp.source)) {
      throw new Error(`Workspace file missing: ${copyOp.relativePath}`);
    }
  }

  for (const copyOp of pendingCopies) {
    await mkdir(path.dirname(copyOp.destination), { recursive: true });
    await copyFile(copyOp.source, copyOp.destination);
  }
}

function requireDesign(db: Database, designId: string): Design {
  const design = getDesign(db, designId);
  if (design === null) {
    throw new Error(`Design not found: ${designId}`);
  }
  return design;
}

async function assertExistingWorkspaceDirectory(workspacePath: string): Promise<void> {
  const entry = await stat(workspacePath);
  if (!entry.isDirectory()) {
    throw new Error('Workspace path is not a directory');
  }
}

export function checkWorkspaceFolderExists(p: string): boolean {
  return existsSync(p);
}

export async function bindWorkspace(
  db: Database,
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
  const comparisonPath = workspacePathComparisonKey(normalizedPath);
  if (
    current.workspacePath !== null &&
    workspacePathComparisonKey(current.workspacePath) === comparisonPath
  ) {
    logger.info('workspace.bind.noop', { designId, workspacePath: normalizedPath });
    return current;
  }
  if (checkWorkspaceConflict(db, designId, normalizedPath)) {
    throw new Error('Workspace path is already bound to another design');
  }
  await assertExistingWorkspaceDirectory(normalizedPath);

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
