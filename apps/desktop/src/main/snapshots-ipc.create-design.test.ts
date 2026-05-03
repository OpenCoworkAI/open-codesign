import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Design } from '@open-codesign/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initSnapshotsDb } from './snapshots-db';
import { registerSnapshotsIpc } from './snapshots-ipc';
import { normalizeWorkspacePath } from './workspace-path';

type Handler = (event: unknown, raw: unknown) => unknown;

const testState = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  appPaths: {
    documents: '',
    userData: '',
  },
}));

vi.mock('./electron-runtime', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'documents') return testState.appPaths.documents;
      if (name === 'userData') return testState.appPaths.userData;
      return testState.appPaths.userData;
    }),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => {
      testState.handlers.set(channel, handler);
    }),
  },
}));

vi.mock('./logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const tempDirs: string[] = [];

async function makeTempRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function getHandler(channel: string): Handler {
  const handler = testState.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return handler;
}

describe('snapshots create-design workspace allocation', () => {
  beforeEach(() => {
    testState.handlers.clear();
    testState.appPaths.documents = '';
    testState.appPaths.userData = '';
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('auto-binds new designs inside the active data directory', async () => {
    const userDataRoot = await makeTempRoot('ocd-data-root-');
    const documentsRoot = await makeTempRoot('ocd-documents-root-');
    testState.appPaths.userData = userDataRoot;
    testState.appPaths.documents = documentsRoot;

    const db = initSnapshotsDb(path.join(userDataRoot, 'design-store.json'));
    registerSnapshotsIpc(db);

    const createDesign = getHandler('snapshots:v1:create-design');
    const design = (await createDesign(null, {
      schemaVersion: 1,
      name: 'Poster Study',
    })) as Design;

    const expectedWorkspacePath = normalizeWorkspacePath(
      path.join(userDataRoot, 'workspaces', 'Poster-Study'),
    );
    expect(design.workspacePath).toBe(expectedWorkspacePath);
    expect(existsSync(expectedWorkspacePath)).toBe(true);
    expect(design.workspacePath).not.toContain(normalizeWorkspacePath(documentsRoot));
  });

  it('allocates duplicated design workspaces inside the active data directory', async () => {
    const userDataRoot = await makeTempRoot('ocd-data-root-');
    const documentsRoot = await makeTempRoot('ocd-documents-root-');
    testState.appPaths.userData = userDataRoot;
    testState.appPaths.documents = documentsRoot;

    const db = initSnapshotsDb(path.join(userDataRoot, 'design-store.json'));
    registerSnapshotsIpc(db);
    const createDesign = getHandler('snapshots:v1:create-design');
    const duplicateDesign = getHandler('snapshots:v1:duplicate-design');
    const source = (await createDesign(null, {
      schemaVersion: 1,
      name: 'Source Design',
    })) as Design;
    if (source.workspacePath === null) throw new Error('Expected source workspace');
    await writeFile(path.join(source.workspacePath, 'index.html'), '<main>copy me</main>', 'utf8');

    const cloned = (await duplicateDesign(null, {
      schemaVersion: 1,
      id: source.id,
      name: 'Source copy',
    })) as Design;

    const expectedWorkspacePath = normalizeWorkspacePath(
      path.join(userDataRoot, 'workspaces', 'Source-copy'),
    );
    expect(cloned.workspacePath).toBe(expectedWorkspacePath);
    expect(existsSync(expectedWorkspacePath)).toBe(true);
    await expect(readFile(path.join(expectedWorkspacePath, 'index.html'), 'utf8')).resolves.toBe(
      '<main>copy me</main>',
    );
    expect(cloned.workspacePath).not.toContain(normalizeWorkspacePath(documentsRoot));
  });
});
