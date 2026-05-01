import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDesign,
  createDesignFile,
  getDesign,
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
  copyTrackedWorkspaceFiles,
  normalizeWorkspacePath,
  openWorkspaceFolder,
  pickWorkspaceFolder,
} from './design-workspace';

const showOpenDialog = vi.mocked(dialog.showOpenDialog);
const openPath = vi.mocked(shell.openPath);

const tempDirs: string[] = [];

async function withMockedPlatform<T>(platform: NodeJS.Platform, run: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
  try {
    return await run();
  } finally {
    if (original) {
      Object.defineProperty(process, 'platform', original);
    }
  }
}

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
  it('strips trailing slash and normalizes absolute paths', () => {
    const absolute = path.join(os.tmpdir(), 'designs', '..', 'designs', 'workspace') + path.sep;
    const normalized = normalizeWorkspacePath(absolute);

    expect(path.isAbsolute(normalized)).toBe(true);
    expect(normalized).toBe(path.normalize(absolute).replaceAll('\\', '/').replace(/\/+$/, ''));
    expect(normalized.endsWith('/')).toBe(false);
  });

  it('rejects empty and relative workspace paths instead of resolving them against cwd', () => {
    expect(() => normalizeWorkspacePath('')).toThrow('Workspace path must not be empty');
    expect(() => normalizeWorkspacePath('   ')).toThrow('Workspace path must not be empty');
    expect(() => normalizeWorkspacePath(path.join('relative', 'workspace'))).toThrow(
      'Workspace path must be absolute for the current platform',
    );
  });

  it('rejects Windows drive paths on non-Windows platforms instead of treating them as cwd-relative', () => {
    if (process.platform === 'win32') return;

    expect(() => normalizeWorkspacePath('C:/Users/Roy/Workspace')).toThrow(
      'Workspace path must be absolute for the current platform',
    );
  });

  it('normalizes fully-qualified Windows paths on Windows', async () => {
    await withMockedPlatform('win32', async () => {
      expect(normalizeWorkspacePath('C:\\Users\\Roy\\Workspace\\')).toBe('C:/Users/Roy/Workspace');
      expect(normalizeWorkspacePath('C:/Users/Roy/Workspace/../Workspace')).toBe(
        'C:/Users/Roy/Workspace',
      );
      expect(() => normalizeWorkspacePath('/Users/Roy/Workspace')).toThrow(
        'Workspace path must be absolute for the current platform',
      );
    });
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

  it('rejects empty and relative workspace bindings before touching the db', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db);

    await expect(bindWorkspace(db, design.id, '   ', false)).rejects.toThrow(
      'Workspace path must not be empty',
    );
    await expect(bindWorkspace(db, design.id, 'relative-workspace', false)).rejects.toThrow(
      'Workspace path must be absolute for the current platform',
    );
    expect(db.prepare('SELECT workspace_path FROM designs WHERE id = ?').get(design.id)).toEqual({
      workspace_path: null,
    });
  });

  it('rejects missing workspace directories before binding', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db);
    const root = await makeTempDir('ocd-ws-missing-root-');
    const missing = path.join(root, 'missing-workspace');

    await expect(bindWorkspace(db, design.id, missing, false)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(db.prepare('SELECT workspace_path FROM designs WHERE id = ?').get(design.id)).toEqual({
      workspace_path: null,
    });
  });

  it('rejects file paths before binding them as workspaces', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db);
    const root = await makeTempDir('ocd-ws-file-root-');
    const filePath = path.join(root, 'not-a-directory');
    await writeFile(filePath, 'not a directory', 'utf8');

    await expect(bindWorkspace(db, design.id, filePath, false)).rejects.toThrow(
      'Workspace path is not a directory',
    );
    expect(db.prepare('SELECT workspace_path FROM designs WHERE id = ?').get(design.id)).toEqual({
      workspace_path: null,
    });
  });

  it('treats case-only workspace differences as the same path on Windows for the same design', async () => {
    await withMockedPlatform('win32', async () => {
      const db = initInMemoryDb();
      const design = createDesign(db);
      const storedPath = normalizeWorkspacePath('C:/Users/Roy/Workspace');
      updateDesignWorkspace(db, design.id, storedPath);

      const rebound = await bindWorkspace(db, design.id, 'C:/users/roy/workspace/', false);

      expect(rebound.workspacePath).toBe(storedPath);
      expect(db.prepare('SELECT workspace_path FROM designs WHERE id = ?').get(design.id)).toEqual({
        workspace_path: storedPath,
      });
    });
  });

  it('treats case-only workspace differences as conflicts on Windows across designs', async () => {
    await withMockedPlatform('win32', async () => {
      const db = initInMemoryDb();
      const design = createDesign(db);
      const otherDesign = createDesign(db);
      updateDesignWorkspace(db, otherDesign.id, normalizeWorkspacePath('C:/Users/Roy/Workspace'));

      await expect(bindWorkspace(db, design.id, 'C:/users/roy/workspace', false)).rejects.toThrow(
        'Workspace path is already bound to another design',
      );
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

  it('copies tracked files between workspaces without changing the binding', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db);
    const source = await makeTempDir('ocd-ws-copy-source-');
    const destination = await makeTempDir('ocd-ws-copy-dest-');
    const sourcePath = normalizeWorkspacePath(source);
    updateDesignWorkspace(db, design.id, sourcePath);
    createDesignFile(db, design.id, 'index.html', '<html>copy me</html>');
    createDesignFile(db, design.id, 'assets/logo.txt', 'asset');
    await writeWorkspaceFile(source, 'index.html', '<html>copy me</html>');
    await writeWorkspaceFile(source, 'assets/logo.txt', 'asset');
    await writeWorkspaceFile(source, 'ignored.txt', 'ignored');

    await copyTrackedWorkspaceFiles(db, design.id, sourcePath, destination);

    expect(getDesign(db, design.id)?.workspacePath).toBe(sourcePath);
    expect(await readFile(path.join(destination, 'index.html'), 'utf8')).toBe(
      '<html>copy me</html>',
    );
    expect(await readFile(path.join(destination, 'assets/logo.txt'), 'utf8')).toBe('asset');
    await expect(readFile(path.join(destination, 'ignored.txt'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects tracked file copies through symlinked workspace path segments', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db);
    const source = await makeTempDir('ocd-ws-symlink-source-');
    const outside = await makeTempDir('ocd-ws-symlink-outside-');
    const destination = await makeTempDir('ocd-ws-symlink-dest-');
    const sourcePath = normalizeWorkspacePath(source);
    updateDesignWorkspace(db, design.id, sourcePath);
    createDesignFile(db, design.id, 'assets/secret.txt', 'secret');
    await writeWorkspaceFile(outside, 'secret.txt', 'secret');
    try {
      await symlink(outside, path.join(source, 'assets'), 'dir');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
      throw err;
    }

    await expect(copyTrackedWorkspaceFiles(db, design.id, sourcePath, destination)).rejects.toThrow(
      /symbolic link/,
    );
    await expect(
      readFile(path.join(destination, 'assets', 'secret.txt'), 'utf8'),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(getDesign(db, design.id)?.workspacePath).toBe(sourcePath);
  });

  it('rejects corrupt tracked file paths before workspace migration copies', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db);
    const source = await makeTempDir('ocd-ws-source-');
    const destination = await makeTempDir('ocd-ws-dest-');
    const sourcePath = normalizeWorkspacePath(source);
    updateDesignWorkspace(db, design.id, sourcePath);
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO design_files (id, design_id, path, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('corrupt-path', design.id, '../escaped.txt', 'escaped', now, now);

    await expect(bindWorkspace(db, design.id, destination, true)).rejects.toThrow(
      'invalid path segment',
    );
    expect(db.prepare('SELECT workspace_path FROM designs WHERE id = ?').get(design.id)).toEqual({
      workspace_path: sourcePath,
    });
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
