import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesign, getDesign, initInMemoryDb, updateDesignWorkspace } from './snapshots-db';
import {
  defaultDesignSlug,
  isAutoManagedWorkspacePath,
  renameAutoManagedWorkspaceForDesign,
} from './snapshots-ipc';

vi.mock('./electron-runtime', () => ({
  app: {
    getPath: vi.fn(() => path.join(os.tmpdir(), 'CoDesign')),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(),
  },
}));

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

describe('auto-managed workspace naming', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'codesign-workspace-name-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('uses readable filesystem slugs for design titles', () => {
    expect(defaultDesignSlug('Untitled design 1')).toBe('Untitled-design-1');
    expect(defaultDesignSlug('Studio Loop Welcome Email')).toBe('Studio-Loop-Welcome-Email');
  });

  it('detects only direct default-root workspace folders matching the current design name', () => {
    expect(
      isAutoManagedWorkspacePath({
        workspacePath: path.join(root, 'Untitled-design-1-22'),
        designName: 'Untitled design 1',
        defaultRoot: root,
      }),
    ).toBe(true);
    expect(
      isAutoManagedWorkspacePath({
        workspacePath: path.join(root, 'Custom-client-folder'),
        designName: 'Untitled design 1',
        defaultRoot: root,
      }),
    ).toBe(false);
  });

  it('renames an auto-managed workspace folder when the design receives a real title', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Untitled design 1');
    const oldWorkspace = path.join(root, 'Untitled-design-1');
    await mkdir(oldWorkspace);
    await writeFile(path.join(oldWorkspace, 'App.jsx'), 'function App() { return null; }', 'utf8');
    updateDesignWorkspace(db, design.id, oldWorkspace);

    const updated = await renameAutoManagedWorkspaceForDesign({
      db,
      designBeforeRename: { ...design, workspacePath: oldWorkspace },
      newName: 'Studio Loop Welcome Email',
      defaultRoot: root,
    });

    const expected = path.join(root, 'Studio-Loop-Welcome-Email');
    expect(updated?.workspacePath).toBe(expected);
    expect(getDesign(db, design.id)?.workspacePath).toBe(expected);
    await expect(exists(oldWorkspace)).resolves.toBe(false);
    await expect(exists(path.join(expected, 'App.jsx'))).resolves.toBe(true);
  });

  it('adds a numeric suffix when the desired renamed workspace already exists', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Untitled design 1');
    const oldWorkspace = path.join(root, 'Untitled-design-1');
    await mkdir(oldWorkspace);
    await mkdir(path.join(root, 'Studio-Loop-Welcome-Email'));
    updateDesignWorkspace(db, design.id, oldWorkspace);

    const updated = await renameAutoManagedWorkspaceForDesign({
      db,
      designBeforeRename: { ...design, workspacePath: oldWorkspace },
      newName: 'Studio Loop Welcome Email',
      defaultRoot: root,
    });

    expect(updated?.workspacePath).toBe(path.join(root, 'Studio-Loop-Welcome-Email-1'));
  });

  it('leaves user-chosen workspaces alone', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Untitled design 1');
    const userWorkspace = await mkdtemp(path.join(os.tmpdir(), 'codesign-custom-workspace-'));
    try {
      updateDesignWorkspace(db, design.id, userWorkspace);

      const updated = await renameAutoManagedWorkspaceForDesign({
        db,
        designBeforeRename: { ...design, workspacePath: userWorkspace },
        newName: 'Studio Loop Welcome Email',
        defaultRoot: root,
      });

      expect(updated).toBeNull();
      expect(getDesign(db, design.id)?.workspacePath).toBe(userWorkspace);
      await expect(exists(userWorkspace)).resolves.toBe(true);
    } finally {
      await rm(userWorkspace, { recursive: true, force: true });
    }
  });
});
