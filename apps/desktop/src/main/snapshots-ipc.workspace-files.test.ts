import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesign, initInMemoryDb } from './snapshots-db';
import { registerWorkspaceIpc } from './snapshots-ipc';

type Handler = (event: unknown, raw: unknown) => unknown;

const handlers = vi.hoisted(() => new Map<string, Handler>());

vi.mock('./electron-runtime', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/open-codesign-tests'),
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

describe('workspace files IPC legacy workspace fallback', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
  });

  it('returns an empty file list when a legacy design has no workspace path', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Legacy unbound design');
    registerWorkspaceIpc(db, () => null);

    const list = getHandler('codesign:files:v1:list');

    await expect(list(null, { schemaVersion: 1, designId: design.id })).resolves.toEqual([]);
  });

  it('returns an empty typed file result when a legacy design has no workspace path', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Legacy unbound design');
    registerWorkspaceIpc(db, () => null);

    const read = getHandler('codesign:files:v1:read');

    await expect(
      read(null, { schemaVersion: 1, designId: design.id, path: 'src/App.jsx' }),
    ).resolves.toEqual({
      path: 'src/App.jsx',
      kind: 'jsx',
      size: 0,
      updatedAt: new Date(0).toISOString(),
      content: '',
    });
  });

  it('rejects file writes when a legacy design has no workspace path', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Legacy unbound design');
    registerWorkspaceIpc(db, () => null);

    const write = getHandler('codesign:files:v1:write');

    await expect(
      write(null, {
        schemaVersion: 1,
        designId: design.id,
        path: 'src/App.jsx',
        content: 'function App() { return <main />; }',
      }),
    ).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'IPC_BAD_INPUT',
    });
  });
});
