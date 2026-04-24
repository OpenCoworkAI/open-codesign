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

describe('files-watcher subscribe / unsubscribe', () => {
  it('rejects when no design row found', async () => {
    reset();
    getDesignMock.mockReturnValue(null);
    registerFilesWatcherIpc({} as never, () => null);
    const sub = handlers.get('codesign:files:v1:subscribe');
    expect(sub).toBeDefined();
    const result = await sub?.(null, { schemaVersion: 1, designId: 'd1' });
    expect(result).toEqual({ ok: false, reason: 'design-not-found' });
  });

  it('rejects when design has no workspace', async () => {
    reset();
    getDesignMock.mockReturnValue({ id: 'd1', workspacePath: null });
    registerFilesWatcherIpc({} as never, () => null);
    const sub = handlers.get('codesign:files:v1:subscribe');
    const result = await sub?.(null, { schemaVersion: 1, designId: 'd1' });
    expect(result).toEqual({ ok: false, reason: 'no-workspace' });
  });

  it('ref-counts subscribers and tears down only after idle window', async () => {
    reset();
    vi.useFakeTimers();
    const closeSpy = vi.fn();
    watchMock.mockImplementation(() => ({ on: vi.fn(), close: closeSpy }) as never);
    getDesignMock.mockReturnValue({ id: 'd1', workspacePath: '/tmp/ws' });
    registerFilesWatcherIpc({} as never, () => null);
    const sub = handlers.get('codesign:files:v1:subscribe');
    const unsub = handlers.get('codesign:files:v1:unsubscribe');
    expect(sub && unsub).toBeTruthy();

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

  it('rejects bad payloads', () => {
    reset();
    registerFilesWatcherIpc({} as never, () => null);
    const sub = handlers.get('codesign:files:v1:subscribe');
    expect(() => sub?.(null, null)).toThrow();
    expect(() => sub?.(null, { designId: 'x' })).toThrow();
    expect(() => sub?.(null, { schemaVersion: 1 })).toThrow();
  });
});
