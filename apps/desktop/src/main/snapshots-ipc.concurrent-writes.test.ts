import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { makeScaffoldTool, makeTextEditorTool } from '@open-codesign/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeTextEditorFs } from './ipc/runtime-fs';
import { createDesign, initInMemoryDb, updateDesignWorkspace } from './snapshots-db';
import { registerWorkspaceIpc } from './snapshots-ipc';

type Handler = (event: unknown, raw: unknown) => Promise<unknown>;
const control = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  beforeWrite: async (_content: unknown): Promise<void> => {},
  resolved: (_file: string): void => {},
  afterMkdir: async (): Promise<void> => {},
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn(async (...args: Parameters<typeof actual.writeFile>) => {
      await control.beforeWrite(args[1]);
      return actual.writeFile(...args);
    }),
    mkdir: vi.fn(async (...args: Parameters<typeof actual.mkdir>) => {
      const result = await actual.mkdir(...args);
      await control.afterMkdir();
      return result;
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
    control.afterMkdir = async () => {};
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

  for (const replacement of ['agent create', 'unguarded IPC'] as const) {
    it(`preserves explicit ${replacement} replacement semantics after a guarded save`, async () => {
      const { db, first, second, save } = await setup(true);
      const { fs } = createRuntimeTextEditorFs({
        db,
        designId: second.id,
        generationId: 'test-generation',
        previousSource: null,
        initialFiles: [{ file: 'App.jsx', contents: 'original' }],
        sendEvent: vi.fn(),
        logger: { error: vi.fn() },
      });
      const started = deferred();
      const release = deferred();
      const secondResolved = deferred();
      control.beforeWrite = async (content) => {
        if (content !== 'guarded revision') return;
        started.resolve();
        await release.promise;
      };
      const guardedSave = save(first.id, 'guarded revision');
      await started.promise;
      control.resolved = () => secondResolved.resolve();
      const write = control.handlers.get('codesign:files:v1:write');
      if (!write) throw new Error('Write IPC not registered');
      const replacementSave =
        replacement === 'agent create'
          ? fs.create('App.jsx', 'explicit full replacement')
          : write(null, {
              schemaVersion: 1,
              designId: second.id,
              path: 'App.jsx',
              content: 'explicit full replacement',
            });
      const results = Promise.allSettled([guardedSave, replacementSave]);
      try {
        await secondResolved.promise;
        await setImmediate();
      } finally {
        release.resolve();
      }
      expect(await results).toMatchObject([
        { status: 'fulfilled', value: { content: 'guarded revision' } },
        { status: 'fulfilled' },
      ]);
      expect(await readFile(path.join(root, 'App.jsx'), 'utf8')).toBe('explicit full replacement');
    });
  }

  for (const command of ['str_replace', 'insert'] as const) {
    it(`offers same-generation view/retry through the actual ${command} tool after conflict`, async () => {
      const { db, first, second, save } = await setup(true);
      const { fs } = createRuntimeTextEditorFs({
        db,
        designId: second.id,
        generationId: 'test-generation',
        previousSource: null,
        initialFiles: [{ file: 'App.jsx', contents: 'original' }],
        sendEvent: vi.fn(),
        logger: { error: vi.fn() },
      });
      const tool = makeTextEditorTool(fs);
      await tool.execute('initial-view', { command: 'view', path: 'App.jsx' });
      await save(first.id, 'editor revision');
      const stale = await tool.execute('stale-edit', {
        command,
        path: 'App.jsx',
        old_str: 'original',
        new_str: 'stale agent',
        insert_line: 1,
      });
      expect(stale.details.result).toMatchObject({ failed: true });
      const message = stale.content[0]?.type === 'text' ? stale.content[0].text : '';
      expect(message).toContain('Workspace file changed');
      expect(message).toContain('retry');
      expect(message).not.toContain('Stop retrying');
      expect(await readFile(path.join(root, 'App.jsx'), 'utf8')).toBe('editor revision');
      const fresh = await tool.execute('fresh-view', {
        command: 'view',
        path: 'App.jsx',
        view_range: [1, -1],
      });
      expect(fresh.content[0]?.type === 'text' ? fresh.content[0].text : '').toContain(
        'editor revision',
      );
      const retried = await tool.execute('explicit-retry', {
        command,
        path: 'App.jsx',
        old_str: 'editor revision',
        new_str: 'explicit retry',
        insert_line: 1,
      });
      expect(retried.details.result).toEqual({ path: 'App.jsx' });
      expect(await readFile(path.join(root, 'App.jsx'), 'utf8')).toBe(
        command === 'str_replace' ? 'explicit retry' : 'editor revision\nexplicit retry',
      );
    });
  }

  it('does not publish a cancelled agent write queued behind another writer', async () => {
    const { db, first, second, save } = await setup(true);
    const controller = new AbortController();
    const sendEvent = vi.fn();
    const { fs } = createRuntimeTextEditorFs({
      db,
      designId: second.id,
      generationId: 'cancelled-generation',
      previousSource: null,
      initialFiles: [{ file: 'App.jsx', contents: 'original' }],
      signal: controller.signal,
      sendEvent,
      logger: { error: vi.fn() },
    });
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
    let queuedSettled = false;
    const queued = fs.create('App.jsx', 'cancelled replacement').finally(() => {
      queuedSettled = true;
    });
    const results = Promise.allSettled([editorSave, queued]);
    try {
      await secondResolved.promise;
      controller.abort();
      await setImmediate();
      expect(queuedSettled).toBe(false);
    } finally {
      release.resolve();
    }
    expect(await results).toMatchObject([
      { status: 'fulfilled' },
      { status: 'rejected', reason: { message: expect.stringContaining('abort') } },
    ]);
    expect(await readFile(path.join(root, 'App.jsx'), 'utf8')).toBe('editor revision');
    expect(sendEvent).not.toHaveBeenCalled();
    expect(fs.view('App.jsx')?.content).toBe('original');
    const write = control.handlers.get('codesign:files:v1:write');
    await expect(
      write?.(null, {
        schemaVersion: 1,
        designId: first.id,
        path: 'App.jsx',
        content: 'subsequent revision',
        expectedContent: 'editor revision',
      }),
    ).resolves.toMatchObject({ content: 'subsequent revision' });
  });

  it('rechecks cancellation after mkdir and before starting an OS write', async () => {
    const { db, first } = await setup(false);
    const controller = new AbortController();
    const { fs } = createRuntimeTextEditorFs({
      db,
      designId: first.id,
      generationId: 'cancelled-generation',
      previousSource: null,
      signal: controller.signal,
      sendEvent: vi.fn(),
      logger: { error: vi.fn() },
    });
    control.afterMkdir = async () => controller.abort();
    await expect(fs.create('App.jsx', 'cancelled replacement')).rejects.toThrow(/abort/u);
    expect(await readFile(path.join(root, 'App.jsx'), 'utf8')).toBe('original');
    await expect(fs.create('App.jsx', 'another replacement')).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
