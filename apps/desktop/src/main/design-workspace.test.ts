import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDesign,
  createDesignFile,
  initInMemoryDb,
  updateDesignWorkspace,
} from './snapshots-db';

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
  },
}));

import { dialog, shell } from 'electron';
import {
  bindWorkspace,
  normalizeWorkspacePath,
  openWorkspaceFolder,
  pickWorkspaceFolder,
} from './design-workspace';

const showOpenDialog = vi.mocked(dialog.showOpenDialog);
const openPath = vi.mocked(shell.openPath);

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeWorkspaceFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

afterEach(async () => {
  showOpenDialog.mockReset();
  openPath.mockReset();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('normalizeWorkspacePath', () => {
  it('strips trailing slash, resolves absolute path, and normalizes separators', () => {
    const relative = path.join('tmp', 'designs', '..', 'designs', 'workspace') + path.sep;
    const normalized = normalizeWorkspacePath(relative);

    expect(path.isAbsolute(normalized)).toBe(true);
    expect(normalized).toBe(path.resolve('tmp/designs/workspace').replaceAll('\\', '/'));
    expect(normalized.endsWith('/')).toBe(false);
  });
});

describe('pickWorkspaceFolder', () => {
  it('returns the selected folder path', async () => {
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/workspace'],
    } as Awaited<ReturnType<typeof dialog.showOpenDialog>>);

    await expect(pickWorkspaceFolder({} as never)).resolves.toBe('/tmp/workspace');
  });

  it('returns null when the picker is canceled', async () => {
    showOpenDialog.mockResolvedValue({
      canceled: true,
      filePaths: [],
    } as Awaited<ReturnType<typeof dialog.showOpenDialog>>);

    await expect(pickWorkspaceFolder({} as never)).resolves.toBeNull();
  });
});

describe('openWorkspaceFolder', () => {
  it('opens the folder in the OS file manager', async () => {
    openPath.mockResolvedValue('');

    await expect(openWorkspaceFolder('/tmp/workspace')).resolves.toBeUndefined();
    expect(openPath).toHaveBeenCalledWith('/tmp/workspace');
  });

  it('throws when Electron reports an open error', async () => {
    openPath.mockResolvedValue('no application is associated');

    await expect(openWorkspaceFolder('/tmp/workspace')).rejects.toThrow(
      'Failed to open workspace folder: no application is associated',
    );
  });
});

describe('bindWorkspace', () => {
  it('returns the current design unchanged when rebinding the same normalized path', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db);
    const workspace = await makeTempDir('ocd-ws-same-');
    const normalized = normalizeWorkspacePath(workspace);
    const bound = updateDesignWorkspace(db, design.id, normalized);
    await writeWorkspaceFile(workspace, 'tracked.txt', 'tracked');
    createDesignFile(db, design.id, 'tracked.txt', 'tracked');
    const destinationBefore = await stat(path.join(workspace, 'tracked.txt'));

    const rebound = await bindWorkspace(db, design.id, `${workspace}${path.sep}`, true);

    expect(rebound).toEqual(bound);
    expect(await stat(path.join(workspace, 'tracked.txt'))).toEqual(destinationBefore);
  });

  it('throws when another active design already owns the workspace path', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db);
    const otherDesign = createDesign(db);
    const conflictPath = normalizeWorkspacePath(await makeTempDir('ocd-ws-conflict-'));
    updateDesignWorkspace(db, otherDesign.id, conflictPath);

    await expect(bindWorkspace(db, design.id, conflictPath, false)).rejects.toThrow(
      'Workspace path is already bound to another design',
    );
    expect(db.prepare('SELECT workspace_path FROM designs WHERE id = ?').get(design.id)).toEqual({
      workspace_path: null,
    });
  });

  it('copies tracked files only during migration', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db);
    const source = await makeTempDir('ocd-ws-source-');
    const destination = await makeTempDir('ocd-ws-dest-');
    updateDesignWorkspace(db, design.id, normalizeWorkspacePath(source));
    createDesignFile(db, design.id, 'tracked.txt', 'tracked root');
    createDesignFile(db, design.id, 'nested/child.txt', 'tracked nested');
    await writeWorkspaceFile(source, 'tracked.txt', 'tracked root');
    await writeWorkspaceFile(source, 'nested/child.txt', 'tracked nested');
    await writeWorkspaceFile(source, 'ignored.txt', 'untracked');

    const updated = await bindWorkspace(db, design.id, destination, true);

    expect(updated.workspacePath).toBe(normalizeWorkspacePath(destination));
    expect(await readFile(path.join(destination, 'tracked.txt'), 'utf8')).toBe('tracked root');
    expect(await readFile(path.join(destination, 'nested/child.txt'), 'utf8')).toBe(
      'tracked nested',
    );
    await expect(readFile(path.join(destination, 'ignored.txt'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(path.join(source, 'tracked.txt'), 'utf8')).toBe('tracked root');
    expect(await readFile(path.join(source, 'ignored.txt'), 'utf8')).toBe('untracked');
  });

  it('aborts migration on destination collision and leaves the binding unchanged', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db);
    const source = await makeTempDir('ocd-ws-source-');
    const destination = await makeTempDir('ocd-ws-dest-');
    const sourcePath = normalizeWorkspacePath(source);
    updateDesignWorkspace(db, design.id, sourcePath);
    createDesignFile(db, design.id, 'tracked.txt', 'tracked root');
    await writeWorkspaceFile(source, 'tracked.txt', 'tracked root');
    await writeWorkspaceFile(destination, 'tracked.txt', 'existing destination');

    await expect(bindWorkspace(db, design.id, destination, true)).rejects.toThrow(
      'Workspace migration collision: tracked.txt',
    );
    expect(db.prepare('SELECT workspace_path FROM designs WHERE id = ?').get(design.id)).toEqual({
      workspace_path: sourcePath,
    });
    expect(await readFile(path.join(destination, 'tracked.txt'), 'utf8')).toBe(
      'existing destination',
    );
  });

  it('clears the workspace binding without touching the filesystem', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db);
    const source = await makeTempDir('ocd-ws-clear-');
    const normalizedSource = normalizeWorkspacePath(source);
    updateDesignWorkspace(db, design.id, normalizedSource);
    await writeWorkspaceFile(source, 'tracked.txt', 'tracked root');
    const beforeEntries = await readdir(source);

    const cleared = await bindWorkspace(db, design.id, null, false);

    expect(cleared.workspacePath).toBeNull();
    expect(await readdir(source)).toEqual(beforeEntries);
  });
});
