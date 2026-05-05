import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesign, getDesign, initInMemoryDb, updateDesignWorkspace } from './snapshots-db';
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

  it('returns an empty file list when the bound workspace folder is missing', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Missing workspace folder');
    updateDesignWorkspace(db, design.id, '/tmp/open-codesign-missing-workspace-for-list');
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

  it('touches design activity when writing a workspace file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-write-touch-'));
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-01T00:00:00.000Z'));
      const db = initInMemoryDb();
      const design = createDesign(db, 'Write activity');
      updateDesignWorkspace(db, design.id, root);
      registerWorkspaceIpc(db, () => null);

      vi.setSystemTime(new Date('2026-05-02T00:00:00.000Z'));
      const write = getHandler('codesign:files:v1:write');
      await write(null, {
        schemaVersion: 1,
        designId: design.id,
        path: 'App.jsx',
        content: 'function App() { return <main />; }',
      });

      expect(getDesign(db, design.id)?.updatedAt).toBe('2026-05-02T00:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('imports external files into references or assets with deduped names', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-import-workspace-'));
    const sourceDir = await mkdtemp(path.join(tmpdir(), 'codesign-import-source-'));
    const briefPath = path.join(sourceDir, 'brief.md');
    const logoPath = path.join(sourceDir, 'logo.png');
    await writeFile(briefPath, '# Brief', 'utf8');
    await writeFile(logoPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await mkdir(path.join(root, 'references'), { recursive: true });
    await writeFile(path.join(root, 'references', 'brief.md'), 'existing', 'utf8');

    const db = initInMemoryDb();
    const design = createDesign(db, 'Import design');
    updateDesignWorkspace(db, design.id, root);
    registerWorkspaceIpc(db, () => null);

    const importFiles = getHandler('codesign:files:v1:import-to-workspace');
    const result = await importFiles(null, {
      schemaVersion: 1,
      designId: design.id,
      source: 'workspace',
      files: [{ path: briefPath }, { path: logoPath }],
    });

    expect(result).toMatchObject([
      { path: 'references/brief-2.md', kind: 'reference', source: 'workspace' },
      { path: 'assets/logo.png', kind: 'asset', source: 'workspace' },
    ]);
    await expect(readFile(path.join(root, 'references', 'brief-2.md'), 'utf8')).resolves.toBe(
      '# Brief',
    );
    await expect(readFile(path.join(root, 'assets', 'logo.png'))).resolves.toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
  });

  it('touches design activity when importing files into the workspace', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-import-touch-workspace-'));
    const sourceDir = await mkdtemp(path.join(tmpdir(), 'codesign-import-touch-source-'));
    const briefPath = path.join(sourceDir, 'brief.md');
    await writeFile(briefPath, '# Brief', 'utf8');
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-01T00:00:00.000Z'));
      const db = initInMemoryDb();
      const design = createDesign(db, 'Import activity');
      updateDesignWorkspace(db, design.id, root);
      registerWorkspaceIpc(db, () => null);

      vi.setSystemTime(new Date('2026-05-02T00:00:00.000Z'));
      const importFiles = getHandler('codesign:files:v1:import-to-workspace');
      await importFiles(null, {
        schemaVersion: 1,
        designId: design.id,
        source: 'workspace',
        files: [{ path: briefPath }],
      });

      expect(getDesign(db, design.id)?.updatedAt).toBe('2026-05-02T00:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('writes clipboard blobs to references with stable pasted names', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-import-clipboard-'));
    const db = initInMemoryDb();
    const design = createDesign(db, 'Clipboard design');
    updateDesignWorkspace(db, design.id, root);
    registerWorkspaceIpc(db, () => null);

    const importFiles = getHandler('codesign:files:v1:import-to-workspace');
    const result = await importFiles(null, {
      schemaVersion: 1,
      designId: design.id,
      source: 'clipboard',
      blobs: [
        {
          name: '',
          mediaType: 'image/png',
          dataBase64: Buffer.from([1, 2, 3]).toString('base64'),
        },
      ],
      timestamp: '2026-05-05T12:34:56.000Z',
    });

    expect(result).toMatchObject([
      {
        path: 'references/pasted-20260505-123456.png',
        name: 'pasted-20260505-123456.png',
        kind: 'reference',
        source: 'clipboard',
      },
    ]);
    await expect(
      readFile(path.join(root, 'references', 'pasted-20260505-123456.png')),
    ).resolves.toEqual(Buffer.from([1, 2, 3]));
  });
});
