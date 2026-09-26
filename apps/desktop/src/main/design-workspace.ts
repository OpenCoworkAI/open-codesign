import { existsSync } from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Design, WorkspaceMode } from '@open-codesign/shared';
import { type BrowserWindow, dialog, shell } from 'electron';
import { getLogger } from './logger';
import { type Database, getDesign, listDesigns } from './snapshots-db';
import { changeSourceEntryWorkspace } from './source-entry';
import { normalizeWorkspacePath } from './workspace-path';
import { runWithWorkspaceRenameQueue } from './workspace-path-lock';
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
  return findWorkspaceConflict(db, designId, normalizedPath) !== null;
}

export function findWorkspaceConflict(
  db: Database,
  designId: string,
  normalizedPath: string,
): Design | null {
  const comparisonPath = workspacePathComparisonKey(normalizedPath);
  return (
    listDesigns(db).find(
      (design) =>
        design.id !== designId &&
        design.workspacePath !== null &&
        workspacePathComparisonKey(design.workspacePath) === comparisonPath,
    ) ?? null
  );
}

function workspaceConflictMessage(conflict: Design): string {
  return [
    `Workspace path is already bound to another design ("${conflict.name}").`,
    'Choose a different folder, or open that design and change its workspace before reusing this folder.',
  ].join(' ');
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
  workspaceMode?: WorkspaceMode,
): Promise<Design> {
  return runWithWorkspaceRenameQueue(designId, async () => {
    const current = requireDesign(db, designId);
    const normalizedPath = workspacePath === null ? null : normalizeWorkspacePath(workspacePath);
    const samePath =
      normalizedPath !== null &&
      current.workspacePath !== null &&
      workspacePathComparisonKey(current.workspacePath) ===
        workspacePathComparisonKey(normalizedPath);
    if (normalizedPath !== null && !samePath) {
      const conflict = findWorkspaceConflict(db, designId, normalizedPath);
      if (conflict !== null) throw new Error(workspaceConflictMessage(conflict));
      await assertExistingWorkspaceDirectory(normalizedPath);
    }
    const updated = await changeSourceEntryWorkspace(
      db,
      designId,
      normalizedPath,
      migrateFiles,
      async () => {
        if (migrateFiles && normalizedPath !== null)
          await migrateWorkspaceFiles(db, designId, normalizedPath);
      },
      workspaceMode,
    );
    logger.info('workspace.bind.done', { designId, workspacePath: normalizedPath, migrateFiles });
    return updated;
  });
}
