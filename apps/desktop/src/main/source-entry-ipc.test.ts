import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesign, initInMemoryDb, updateDesignWorkspace } from './snapshots-db';
import { registerSourceEditBusyCheck } from './source-edits-ipc';
import { getSourceEntry, initializeSourceEntry } from './source-entry';
import { registerSourceEntryIpc } from './source-entry-ipc';

const handlers = vi.hoisted(
  () => new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>(),
);
vi.mock('./electron-runtime', () => ({
  ipcMain: {
    handle: (name: string, handler: (event: unknown, raw: unknown) => Promise<unknown>) =>
      handlers.set(name, handler),
  },
}));
vi.mock('./logger', () => ({
  getLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));
let root: string;
let db: ReturnType<typeof initInMemoryDb>;
let designId: string;
let busy: boolean;
let unregister: () => void;
const sender = { isDestroyed: () => false };
const win = { isDestroyed: () => false, webContents: sender } as unknown as BrowserWindow;

function invoke(kind: 'get' | 'select', raw: unknown, event: unknown = { sender }) {
  const handler = handlers.get(`codesign:source-entry:v1:${kind}`);
  if (!handler) throw new Error('Missing handler');
  return handler(event, raw);
}
async function selection(file = 'pages/other.htm') {
  const entry = await getSourceEntry(db, designId);
  return {
    schemaVersion: 1,
    designId,
    path: file,
    expectedWorkspacePath: entry.workspacePath,
    expectedRevision: entry.revision,
  };
}
beforeEach(async () => {
  handlers.clear();
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'codesign-source-selection-')));
  db = { ...initInMemoryDb(), sessionDir: path.join(root, 'sessions') };
  designId = createDesign(db, 'HTML source').id;
  const workspace = path.join(root, 'workspace');
  await mkdir(path.join(workspace, 'pages'), { recursive: true });
  await writeFile(path.join(workspace, 'index.html'), '<!doctype html><main>First</main>');
  await writeFile(
    path.join(workspace, 'pages/other.htm'),
    '<!doctype html><main>Second</main><script>document.title="Native";</script>',
  );
  updateDesignWorkspace(db, designId, workspace);
  await initializeSourceEntry(db, designId);
  busy = false;
  unregister = registerSourceEditBusyCheck(() => busy);
  registerSourceEntryIpc(db, () => win);
});
afterEach(async () => {
  unregister();
  await rm(root, { recursive: true, force: true });
});

describe('source entry IPC', () => {
  it('reads planned sources and selects nested native HTML with a new revision', async () => {
    const input = await selection();
    expect(await invoke('get', { schemaVersion: 1, designId })).toMatchObject({
      status: 'planned',
      source: { path: 'index.html', runtimeMode: 'native-html' },
    });
    const selected = await invoke('select', input);
    expect(selected).toMatchObject({
      status: 'ready',
      source: { path: 'pages/other.htm', runtimeMode: 'native-html' },
      content: expect.stringContaining('<script>'),
    });
    expect(selected).not.toMatchObject({ revision: input.expectedRevision });
    await expect(invoke('select', input)).rejects.toThrow('source entry changed');
  });
  it('blocks source changes while a generation owns the workspace', async () => {
    busy = true;
    await expect(invoke('select', await selection())).rejects.toThrow('Wait for generation');
    expect(await getSourceEntry(db, designId)).toMatchObject({ source: { path: 'index.html' } });
  });
  it('checks busy state again immediately before committing source selection', async () => {
    unregister();
    let checks = 0;
    unregister = registerSourceEditBusyCheck(() => ++checks > 1);
    await expect(invoke('select', await selection())).rejects.toThrow('Wait for generation');
    expect(await getSourceEntry(db, designId)).toMatchObject({ source: { path: 'index.html' } });
  });
  it('fails closed when generation ownership is unavailable', async () => {
    unregister();
    await expect(invoke('select', await selection())).rejects.toThrow(
      'generation state is unavailable',
    );
  });
  it('rejects unrelated senders, malformed payloads and path traversal', async () => {
    await expect(invoke('get', { schemaVersion: 1, designId }, { sender: {} })).rejects.toThrow(
      'window is unavailable',
    );
    await expect(invoke('get', { schemaVersion: 2, designId })).rejects.toThrow('Invalid source');
    await expect(invoke('select', await selection('../outside.html'))).rejects.toThrow(
      'Invalid source',
    );
    await expect(
      invoke('select', { ...(await selection()), expectedWorkspacePath: 'C:/other' }),
    ).rejects.toThrow('workspace changed');
  });
});
