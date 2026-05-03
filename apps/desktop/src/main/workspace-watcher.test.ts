import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (e: unknown, raw: unknown) => unknown>();

vi.mock('./electron-runtime', () => ({
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, raw: unknown) => unknown) => {
      handlers.set(channel, fn);
    },
  },
}));

vi.mock('./logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const watchMock = vi.hoisted(() => vi.fn(() => ({ on: vi.fn(), close: vi.fn() })));
const getDesignMock = vi.hoisted(() => vi.fn());

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, watch: watchMock };
});

vi.mock('./snapshots-db', () => ({
  getDesign: (...args: unknown[]) => getDesignMock(...args),
}));

import { __test, registerFilesWatcherIpc, shutdownAllFilesWatchers } from './workspace-watcher';

describe('workspace-watcher ignore patterns', () => {
  for (const ignored of [
    'node_modules/foo/bar.js',
    'apps/desktop/node_modules/y',
    '.git/HEAD',
    'sub/.git/index',
    '.codesign/sessions/abc.jsonl',
    '.DS_Store',
    'sub/.DS_Store',
    'dist/index.html',
    'out/main.js',
  ]) {
    it(`ignores ${ignored}`, () => {
      expect(__test.isIgnored(ignored)).toBe(true);
    });
  }
  for (const allowed of [
    'index.html',
    'src/App.tsx',
    'DESIGN.md',
    'AGENTS.md',
    'page/landing.jsx',
  ]) {
    it(`watches ${allowed}`, () => {
      expect(__test.isIgnored(allowed)).toBe(false);
    });
  }
});

function reset(): void {
  shutdownAllFilesWatchers();
  handlers.clear();
  watchMock.mockReset();
  watchMock.mockImplementation(() => ({ on: vi.fn(), close: vi.fn() }) as never);
  getDesignMock.mockReset();
}

function getHandler(channel: string): (e: unknown, raw: unknown) => unknown {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return handler;
}

function captureError(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err;
  }
}

function tempWorkspace(name: string): string {
  return path.join(tmpdir(), name).replaceAll('\\', '/');
}

describe('files-watcher subscribe / unsubscribe', () => {
  it('rejects when no design row found', () => {
    reset();
    getDesignMock.mockReturnValue(null);
    registerFilesWatcherIpc({} as never, () => null);
    const sub = getHandler('codesign:files:v1:subscribe');

    const err = captureError(() => sub(null, { schemaVersion: 1, designId: 'd1' }));

    expect(err).toMatchObject({ name: 'CodesignError', code: 'IPC_NOT_FOUND' });
    expect(watchMock).not.toHaveBeenCalled();
  });

  it('rejects when design has no workspace', () => {
    reset();
    getDesignMock.mockReturnValue({ id: 'd1', workspacePath: null });
    registerFilesWatcherIpc({} as never, () => null);
    const sub = getHandler('codesign:files:v1:subscribe');

    const err = captureError(() => sub(null, { schemaVersion: 1, designId: 'd1' }));

    expect(err).toMatchObject({ name: 'CodesignError', code: 'IPC_BAD_INPUT' });
    expect(watchMock).not.toHaveBeenCalled();
  });

  it('rejects corrupt stored workspace paths before watching', () => {
    reset();
    getDesignMock.mockReturnValue({ id: 'd1', workspacePath: '' });
    registerFilesWatcherIpc({} as never, () => null);
    const sub = getHandler('codesign:files:v1:subscribe');

    const err = captureError(() => sub(null, { schemaVersion: 1, designId: 'd1' }));

    expect(err).toMatchObject({ name: 'CodesignError', code: 'IPC_BAD_INPUT' });
    expect(watchMock).not.toHaveBeenCalled();
  });

  it('rejects when the watcher cannot start', () => {
    reset();
    watchMock.mockImplementation(() => {
      throw new Error('watch denied');
    });
    getDesignMock.mockReturnValue({
      id: 'd1',
      workspacePath: tempWorkspace('codesign-watch-denied'),
    });
    registerFilesWatcherIpc({} as never, () => null);
    const sub = getHandler('codesign:files:v1:subscribe');

    const err = captureError(() => sub(null, { schemaVersion: 1, designId: 'd1' }));

    expect(err).toMatchObject({ name: 'CodesignError', code: 'IPC_DB_ERROR' });
    expect(watchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to polling when native watch is denied by permissions', () => {
    reset();
    const err = Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    watchMock.mockImplementation(() => {
      throw err;
    });
    getDesignMock.mockReturnValue({
      id: 'd1',
      workspacePath: tempWorkspace('codesign-watch-eperm'),
    });
    registerFilesWatcherIpc({} as never, () => null);
    const sub = getHandler('codesign:files:v1:subscribe');

    expect(sub(null, { schemaVersion: 1, designId: 'd1' })).toEqual({ ok: true });

    const entry = __test.watchers.get('d1');
    expect(watchMock).toHaveBeenCalledTimes(1);
    expect(entry?.watcher).toBeNull();
    expect(entry?.pollTimer).not.toBeNull();
  });

  it('switches an active watcher to polling on runtime permission errors', () => {
    reset();
    const closeSpy = vi.fn();
    let errorHandler: ((err: Error) => void) | undefined;
    watchMock.mockImplementation(
      () =>
        ({
          on: vi.fn((event: string, cb: (err: Error) => void) => {
            if (event === 'error') errorHandler = cb;
          }),
          close: closeSpy,
        }) as never,
    );
    getDesignMock.mockReturnValue({
      id: 'd1',
      workspacePath: tempWorkspace('codesign-watch-runtime-eperm'),
    });
    registerFilesWatcherIpc({} as never, () => null);
    const sub = getHandler('codesign:files:v1:subscribe');

    expect(sub(null, { schemaVersion: 1, designId: 'd1' })).toEqual({ ok: true });
    errorHandler?.(Object.assign(new Error('operation not permitted'), { code: 'EPERM' }));

    const entry = __test.watchers.get('d1');
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(entry?.watcher).toBeNull();
    expect(entry?.pollTimer).not.toBeNull();
  });

  it('polling signatures change when workspace file metadata changes', async () => {
    reset();
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-watch-poll-'));
    await writeFile(path.join(root, 'index.html'), '<main>one</main>');
    const first = await __test.pollWorkspaceSignature(root);

    await writeFile(path.join(root, 'index.html'), '<main>two plus more bytes</main>');
    const second = await __test.pollWorkspaceSignature(root);

    expect(second).not.toBe(first);
  });

  it('tears down polling watchers after the idle unsubscribe window', () => {
    reset();
    vi.useFakeTimers();
    try {
      const err = Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
      watchMock.mockImplementation(() => {
        throw err;
      });
      getDesignMock.mockReturnValue({
        id: 'd1',
        workspacePath: tempWorkspace('codesign-watch-poll-teardown'),
      });
      registerFilesWatcherIpc({} as never, () => null);
      const sub = getHandler('codesign:files:v1:subscribe');
      const unsub = getHandler('codesign:files:v1:unsubscribe');

      expect(sub(null, { schemaVersion: 1, designId: 'd1' })).toEqual({ ok: true });
      expect(__test.watchers.get('d1')?.pollTimer).not.toBeNull();

      expect(unsub(null, { schemaVersion: 1, designId: 'd1' })).toEqual({ ok: true });
      vi.advanceTimersByTime(__test.IDLE_TEARDOWN_MS + 10);

      expect(__test.watchers.has('d1')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ref-counts subscribers and tears down only after idle window', async () => {
    reset();
    vi.useFakeTimers();
    const closeSpy = vi.fn();
    watchMock.mockImplementation(() => ({ on: vi.fn(), close: closeSpy }) as never);
    getDesignMock.mockReturnValue({
      id: 'd1',
      workspacePath: tempWorkspace('codesign-watch-refcount'),
    });
    registerFilesWatcherIpc({} as never, () => null);
    const sub = getHandler('codesign:files:v1:subscribe');
    const unsub = getHandler('codesign:files:v1:unsubscribe');

    await sub?.(null, { schemaVersion: 1, designId: 'd1' });
    await sub?.(null, { schemaVersion: 1, designId: 'd1' });
    expect(watchMock).toHaveBeenCalledTimes(1);

    await unsub?.(null, { schemaVersion: 1, designId: 'd1' });
    expect(closeSpy).not.toHaveBeenCalled();

    await unsub?.(null, { schemaVersion: 1, designId: 'd1' });
    expect(closeSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(__test.IDLE_TEARDOWN_MS + 10);
    expect(closeSpy).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('restarts a design watcher when the bound workspace path changes', () => {
    reset();
    const closeFirst = vi.fn();
    const closeSecond = vi.fn();
    watchMock
      .mockImplementationOnce(() => ({ on: vi.fn(), close: closeFirst }) as never)
      .mockImplementationOnce(() => ({ on: vi.fn(), close: closeSecond }) as never);
    const firstWorkspace = tempWorkspace('codesign-watch-one');
    const secondWorkspace = tempWorkspace('codesign-watch-two');
    getDesignMock
      .mockReturnValueOnce({ id: 'd1', workspacePath: `${firstWorkspace}/` })
      .mockReturnValueOnce({ id: 'd1', workspacePath: secondWorkspace });
    registerFilesWatcherIpc({} as never, () => null);
    const sub = getHandler('codesign:files:v1:subscribe');

    expect(sub(null, { schemaVersion: 1, designId: 'd1' })).toEqual({ ok: true });
    expect(sub(null, { schemaVersion: 1, designId: 'd1' })).toEqual({ ok: true });

    expect(closeFirst).toHaveBeenCalledTimes(1);
    expect(closeSecond).not.toHaveBeenCalled();
    expect(watchMock).toHaveBeenNthCalledWith(
      1,
      firstWorkspace,
      { recursive: true },
      expect.any(Function),
    );
    expect(watchMock).toHaveBeenNthCalledWith(
      2,
      secondWorkspace,
      { recursive: true },
      expect.any(Function),
    );
  });

  it('rejects bad payloads', () => {
    reset();
    registerFilesWatcherIpc({} as never, () => null);
    const sub = getHandler('codesign:files:v1:subscribe');
    expect(() => sub?.(null, null)).toThrow();
    expect(() => sub?.(null, { designId: 'x' })).toThrow();
    expect(() => sub?.(null, { schemaVersion: 1 })).toThrow();
  });
});
