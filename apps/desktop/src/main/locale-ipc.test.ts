import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./electron-runtime', () => ({
  app: { getLocale: () => 'en-US' },
  ipcMain: { handle: vi.fn() },
}));

const writeFileMock = vi.fn<(path: string, data: string, encoding: string) => Promise<void>>(
  async () => {},
);
const mkdirMock = vi.fn<(path: string, opts: { recursive?: boolean }) => Promise<void>>(
  async () => {},
);

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: (path: string, data: string, encoding: string) => writeFileMock(path, data, encoding),
  mkdir: (path: string, opts: { recursive?: boolean }) => mkdirMock(path, opts),
}));

import { ipcMain } from './electron-runtime';
import { registerLocaleIpc } from './locale-ipc';

describe('locale-ipc XDG_CONFIG_HOME', () => {
  it('writes locale.json under XDG_CONFIG_HOME when set', async () => {
    const prev = process.env['XDG_CONFIG_HOME'];
    const xdg = join(tmpdir(), 'xdg-locale-test');
    process.env['XDG_CONFIG_HOME'] = xdg;
    try {
      writeFileMock.mockClear();
      const handlers = new Map<string, (...args: unknown[]) => unknown>();
      const handleMock = ipcMain.handle as unknown as ReturnType<typeof vi.fn>;
      handleMock.mockImplementation((channel: unknown, fn: unknown) => {
        handlers.set(channel as string, fn as (...args: unknown[]) => unknown);
      });
      registerLocaleIpc();
      const setHandler = handlers.get('locale:set');
      if (!setHandler) throw new Error('locale:set not registered');
      await setHandler({}, 'zh-CN');
      expect(writeFileMock).toHaveBeenCalled();
      const firstCall = writeFileMock.mock.calls[0];
      expect(firstCall?.[0]).toBe(join(xdg, 'open-codesign', 'locale.json'));
    } finally {
      if (prev === undefined) process.env['XDG_CONFIG_HOME'] = undefined;
      else process.env['XDG_CONFIG_HOME'] = prev;
    }
  });
});

describe('locale-ipc input validation', () => {
  function getSetHandler(): (...args: unknown[]) => unknown {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handleMock = ipcMain.handle as unknown as ReturnType<typeof vi.fn>;
    handleMock.mockImplementation((channel: unknown, fn: unknown) => {
      handlers.set(channel as string, fn as (...args: unknown[]) => unknown);
    });
    registerLocaleIpc();
    const fn = handlers.get('locale:set');
    if (!fn) throw new Error('locale:set not registered');
    return fn;
  }

  it('rejects unsupported locale tags instead of writing garbage to disk', async () => {
    writeFileMock.mockClear();
    const set = getSetHandler();
    await expect(set({}, 'fr-FR')).rejects.toThrow(/unsupported locale/);
    await expect(set({}, 'klingon')).rejects.toThrow(/unsupported locale/);
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('canonicalizes alias forms before persisting', async () => {
    writeFileMock.mockClear();
    const set = getSetHandler();
    const result = await set({}, 'zh-Hans-CN');
    expect(result).toBe('zh-CN');
    const firstCall = writeFileMock.mock.calls.at(-1);
    const persisted = JSON.parse(String(firstCall?.[1] ?? '{}'));
    expect(persisted.locale).toBe('zh-CN');
    expect(persisted.schemaVersion).toBe(1);
  });

  it('rejects empty / non-string input', async () => {
    const set = getSetHandler();
    await expect(set({}, '')).rejects.toThrow();
    await expect(set({}, 123)).rejects.toThrow();
    await expect(set({}, null)).rejects.toThrow();
  });
});
