import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { makeScaffoldTool } from '@open-codesign/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeTextEditorFs } from './ipc/runtime-fs';
import { createDesign, initInMemoryDb, updateDesignWorkspace } from './snapshots-db';
import { registerWorkspaceIpc } from './snapshots-ipc';

type Handler = (event: unknown, raw: unknown) => Promise<unknown>;
const control = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  beforeWrite: async (_content: unknown): Promise<void> => {},
  resolved: (_file: string): void => {},
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn(async (...args: Parameters<typeof actual.writeFile>) => {
      await control.beforeWrite(args[1]);
      return actual.writeFile(...args);
    }),
  };
});
vi.mock('./workspace-reader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./workspace-reader')>();
  return {
    ...actual,
    resolveSafeWorkspaceChildPath: async (root: string, file: string) => {
      const result = await actual.resolveSafeWorkspaceChildPath(root, file);
      control.resolved(file);
      return result;
    },
  };
});
vi.mock('./electron-runtime', () => ({
  app: { getPath: vi.fn(() => '/unused-test-path') },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: {
    handle: (channel: string, handler: Handler) => control.handlers.set(channel, handler),
  },
}));
vi.mock('./logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function deferred() {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('coordinated workspace publication', () => {
  let root: string;
  afterEach(async () => {
    control.beforeWrite = async () => {};
    control.resolved = () => {};
    control.handlers.clear();
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function setup(sharedWorkspace: boolean) {
    root = await mkdtemp(path.join(tmpdir(), 'codesign-overlapping-save-'));
    await writeFile(path.join(root, 'App.jsx'), 'original', 'utf8');
    const db = initInMemoryDb();
    const first = createDesign(db, 'First design');
    const second = sharedWorkspace ? createDesign(db, 'Shared workspace design') : first;
    updateDesignWorkspace(db, first.id, root);
    updateDesignWorkspace(db, second.id, path.join(root, '.'));
    registerWorkspaceIpc(db, () => null);
    const write = control.handlers.get('codesign:files:v1:write');
    if (!write) throw new Error('Write IPC not registered');
    const save = (designId: string, content: string) =>
      write(null, {
        schemaVersion: 1,
        designId,
        path: 'App.jsx',
        content,
        expectedContent: 'original',
      });
    return { db, first, second, save };
  }

  for (const sharedWorkspace of [false, true]) {
    it(`allows exactly one overlapping conditional save (${sharedWorkspace ? 'two designs' : 'same design'})`, async () => {
      const { first, second, save } = await setup(sharedWorkspace);
      const started = deferred();
      const release = deferred();
      const secondResolved = deferred();
      control.beforeWrite = async (content) => {
        if (content !== 'first revision') return;
        started.resolve();
        await release.promise;
      };
      const firstSave = save(first.id, 'first revision');
      await started.promise;
      control.resolved = () => secondResolved.resolve();
      const secondSave = save(second.id, 'second revision');
      const results = Promise.allSettled([firstSave, secondSave]);
      try {
        await secondResolved.promise;
        // Both requests have resolved the real target while the first publication is held.
        await setImmediate();
      } finally {
        release.resolve();
      }
      const [winner, loser] = await results;
      expect(winner).toMatchObject({
        status: 'fulfilled',
        value: { path: 'App.jsx', content: 'first revision' },
      });
      expect(loser).toMatchObject({ status: 'rejected', reason: { code: 'IPC_CONFLICT' } });
      expect(await readFile(path.join(root, 'App.jsx'), 'utf8')).toBe('first revision');
      // A conflict must release the queue for the next legitimate save.
      const write = control.handlers.get('codesign:files:v1:write');
      await expect(
        write?.(null, {
          schemaVersion: 1,
          designId: second.id,
          path: 'App.jsx',
          content: 'next revision',
          expectedContent: 'first revision',
        }),
      ).resolves.toMatchObject({ content: 'next revision' });
    });
  }

  it('checks source after a shared-workspace agent publication, not during it', async () => {
    const { db, first, second, save } = await setup(true);
    const runtime = createRuntimeTextEditorFs({
      db,
      designId: first.id,
      generationId: 'test-generation',
      previousSource: null,
      sendEvent: vi.fn(),
      logger: { error: vi.fn() },
    });
    const started = deferred();
    const release = deferred();
    const secondResolved = deferred();
    control.beforeWrite = async (content) => {
      if (content !== 'agent revision') return;
      started.resolve();
      await release.promise;
    };
    const agentWrite = runtime.fs.create('App.jsx', 'agent revision');
    await started.promise;
    control.resolved = () => secondResolved.resolve();
    const tweakSave = save(second.id, 'stale tweak');
    const results = Promise.allSettled([agentWrite, tweakSave]);
    try {
      await secondResolved.promise;
      await setImmediate();
    } finally {
      release.resolve();
    }
    expect(await results).toMatchObject([
      { status: 'fulfilled' },
      { status: 'rejected', reason: { code: 'IPC_CONFLICT' } },
    ]);
    expect(await readFile(path.join(root, 'App.jsx'), 'utf8')).toBe('agent revision');
  });

  for (const method of ['strReplace', 'insert'] as const) {
    it(`rejects stale agent ${method} after an overlapping IPC save and permits explicit view/retry`, async () => {
      const { db, first, second, save } = await setup(true);
      const sendEvent = vi.fn();
      const logger = { error: vi.fn() };
      const { fs } = createRuntimeTextEditorFs({
        db,
        designId: second.id,
        generationId: 'test-generation',
        previousSource: null,
        initialFiles: [{ file: 'App.jsx', contents: 'original' }],
        sendEvent,
        logger,
      });
      expect(fs.view('App.jsx')?.content).toBe('original');
      const started = deferred();
      const release = deferred();
      const secondResolved = deferred();
      control.beforeWrite = async (content) => {
        if (content !== 'editor revision') return;
        started.resolve();
        await release.promise;
      };
      const editorSave = save(first.id, 'editor revision');
      await started.promise;
      control.resolved = () => secondResolved.resolve();
      const agentSave =
        method === 'strReplace'
          ? fs.strReplace('App.jsx', 'original', 'stale agent')
          : fs.insert('App.jsx', 1, 'stale agent');
      const results = Promise.allSettled([editorSave, agentSave]);
      try {
        await secondResolved.promise;
        await setImmediate();
      } finally {
        release.resolve();
      }
      expect(await results).toMatchObject([
        { status: 'fulfilled' },
        {
          status: 'rejected',
          reason: { message: expect.stringContaining('Workspace file changed') },
        },
      ]);
      expect(await readFile(path.join(root, 'App.jsx'), 'utf8')).toBe('editor revision');
      expect(logger.error).toHaveBeenCalledOnce();
      expect(sendEvent).not.toHaveBeenCalled();
      expect(fs.view('App.jsx')?.content).toBe('editor revision');
      if (method === 'strReplace') {
        await fs.strReplace('App.jsx', 'editor revision', 'explicit retry');
        expect(await readFile(path.join(root, 'App.jsx'), 'utf8')).toBe('explicit retry');
      } else {
        await fs.insert('App.jsx', 1, 'explicit retry');
        expect(await readFile(path.join(root, 'App.jsx'), 'utf8')).toBe(
          'editor revision\nexplicit retry',
        );
      }
    });
  }

  it('coordinates scaffold publication with conditional saves', async () => {
    const { second, save } = await setup(true);
    const scaffoldsRoot = path.join(root, 'templates', 'scaffolds');
    await mkdir(scaffoldsRoot, { recursive: true });
    await writeFile(
      path.join(scaffoldsRoot, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        scaffolds: {
          example: {
            description: 'Local fixture',
            path: 'example.jsx',
            license: 'MIT',
            source: 'test fixture',
          },
        },
      }),
    );
    await writeFile(path.join(scaffoldsRoot, 'example.jsx'), 'scaffold revision');
    const started = deferred();
    const release = deferred();
    const secondResolved = deferred();
    control.beforeWrite = async (content) => {
      if (content !== 'scaffold revision') return;
      started.resolve();
      await release.promise;
    };
    const scaffoldWrite = makeScaffoldTool(
      () => root,
      () => scaffoldsRoot,
    ).execute('scaffold-test', { kind: 'example', destPath: 'App.jsx' });
    await started.promise;
    control.resolved = () => secondResolved.resolve();
    const editorSave = save(second.id, 'stale editor');
    const results = Promise.allSettled([scaffoldWrite, editorSave]);
    try {
      await secondResolved.promise;
      await setImmediate();
    } finally {
      release.resolve();
    }
    expect(await results).toMatchObject([
      { status: 'fulfilled', value: { details: { ok: true } } },
      { status: 'rejected', reason: { code: 'IPC_CONFLICT' } },
    ]);
    expect(await readFile(path.join(root, 'App.jsx'), 'utf8')).toBe('scaffold revision');
  });

  it('releases the writer after a failed IPC publication and preserves its error code', async () => {
    const { first, save } = await setup(false);
    control.beforeWrite = async (content) => {
      if (content === 'failed revision') throw new Error('test disk write failure');
    };
    await expect(save(first.id, 'failed revision')).rejects.toMatchObject({
      code: 'IPC_DB_ERROR',
      message: 'Failed to write workspace file',
    });
    expect(await readFile(path.join(root, 'App.jsx'), 'utf8')).toBe('original');
    await expect(save(first.id, 'retry revision')).resolves.toMatchObject({
      content: 'retry revision',
    });
  });

  it('rejects an external edit already visible on disk and refreshes the agent view', async () => {
    const { db, first } = await setup(false);
    const { fs } = createRuntimeTextEditorFs({
      db,
      designId: first.id,
      generationId: 'test-generation',
      previousSource: null,
      initialFiles: [{ file: 'App.jsx', contents: 'original' }],
      sendEvent: vi.fn(),
      logger: { error: vi.fn() },
    });
    await writeFile(path.join(root, 'App.jsx'), 'external revision');
    await expect(fs.strReplace('App.jsx', 'original', 'stale edit')).rejects.toThrow(
      'Workspace file changed',
    );
    expect(await readFile(path.join(root, 'App.jsx'), 'utf8')).toBe('external revision');
    expect(fs.view('App.jsx')?.content).toBe('external revision');
  });
});
