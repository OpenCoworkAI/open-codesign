import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Design } from '@open-codesign/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDesign,
  createSnapshot,
  initInMemoryDb,
  listDesigns,
  listSnapshots,
  updateDesignWorkspace,
} from './snapshots-db';
import { registerSnapshotsIpc } from './snapshots-ipc';
import { normalizeWorkspacePath } from './workspace-path';

type Handler = (event: unknown, raw: unknown) => unknown;

const handlers = vi.hoisted(() => new Map<string, Handler>());
const testRoots = vi.hoisted(() => {
  const fallback = process.platform === 'win32' ? 'C:/Temp' : '/tmp';
  const base = (process.env['TEMP'] ?? process.env['TMP'] ?? fallback).replaceAll('\\', '/');
  return { documentsRoot: `${base}/open-codesign-create-design-tests` };
});

vi.mock('./electron-runtime', () => ({
  app: {
    getPath: vi.fn(() => testRoots.documentsRoot),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    }),
  },
}));

vi.mock('./logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function getHandler(channel: string): Handler {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return handler;
}

describe('snapshots create-design workspace reuse', () => {
  let root: string;

  beforeEach(async () => {
    handlers.clear();
    await mkdir(testRoots.documentsRoot, { recursive: true });
    root = await mkdtemp(path.join(testRoots.documentsRoot, 'case-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('creates a fresh conversation that shares an existing workspace without copying history', async () => {
    const db = initInMemoryDb();
    const workspacePath = path.join(root, 'workspace');
    await mkdir(workspacePath);
    const source = createDesign(db, 'Existing workspace');
    updateDesignWorkspace(db, source.id, workspacePath);
    createSnapshot(db, {
      designId: source.id,
      parentId: null,
      type: 'initial',
      prompt: 'make a homepage',
      artifactType: 'html',
      artifactSource: '<main>Existing</main>',
    });
    registerSnapshotsIpc(db);

    const created = (await getHandler('snapshots:v1:create-design')(null, {
      schemaVersion: 1,
      name: 'Fresh conversation',
      workspacePath,
      workspaceReuse: 'fresh-conversation',
    })) as Design;

    expect(created.id).not.toBe(source.id);
    expect(created.workspacePath).toBe(normalizeWorkspacePath(workspacePath));
    expect(listSnapshots(db, created.id)).toEqual([]);
    expect(listSnapshots(db, source.id)).toHaveLength(1);
    expect(
      listDesigns(db).filter(
        (design) => design.workspacePath === normalizeWorkspacePath(workspacePath),
      ),
    ).toHaveLength(2);
  });

  it('keeps ordinary create-design workspace conflicts exclusive', async () => {
    const db = initInMemoryDb();
    const workspacePath = path.join(root, 'workspace');
    await mkdir(workspacePath);
    const source = createDesign(db, 'Existing workspace');
    updateDesignWorkspace(db, source.id, workspacePath);
    registerSnapshotsIpc(db);

    await expect(
      getHandler('snapshots:v1:create-design')(null, {
        schemaVersion: 1,
        name: 'Ordinary create',
        workspacePath,
      }),
    ).rejects.toMatchObject({ code: 'IPC_CONFLICT' });

    expect(listDesigns(db).map((design) => design.id)).toEqual([source.id]);
  });

  it('rejects workspace reuse without an explicit workspace path', async () => {
    const db = initInMemoryDb();
    registerSnapshotsIpc(db);

    await expect(
      getHandler('snapshots:v1:create-design')(null, {
        schemaVersion: 1,
        name: 'Fresh conversation',
        workspaceReuse: 'fresh-conversation',
      }),
    ).rejects.toMatchObject({ code: 'IPC_BAD_INPUT' });
  });
});
