import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock electron and logger before importing the module under test.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('electron-log/main', () => ({
  default: {
    scope: () => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    }),
    transports: {
      file: { resolvePathFn: null, maxSize: 0, format: '' },
      console: { level: 'info', format: '' },
    },
    errorHandler: { startCatching: vi.fn() },
    eventLogger: { startLogging: vi.fn() },
    info: vi.fn(),
  },
}));

const readFileMock = vi.fn<(...args: unknown[]) => Promise<string>>();
const writeFileMock = vi.fn<(path: string, text: string) => Promise<void>>(async () => {});

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
  writeFile: (path: string, text: string) => writeFileMock(path, text),
  mkdir: vi.fn(async () => {}),
}));

import { readPersisted, registerPreferencesIpc } from './preferences-ipc';

describe('readPersisted()', () => {
  beforeEach(() => {
    readFileMock.mockReset();
    writeFileMock.mockReset();
    writeFileMock.mockImplementation(async () => {});
  });

  it('returns defaults when the file does not exist (ENOENT)', async () => {
    const notFound = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    readFileMock.mockRejectedValueOnce(notFound);

    const result = await readPersisted();
    expect(result).toEqual({
      updateChannel: 'stable',
      generationTimeoutSec: 1200,
      checkForUpdatesOnStartup: true,
      dismissedUpdateVersion: '',
      diagnosticsLastReadTs: 0,
    });
  });

  it('honors XDG_CONFIG_HOME when computing the persisted file path', async () => {
    const prev = process.env['XDG_CONFIG_HOME'];
    const xdg = join(tmpdir(), 'xdg-test-home');
    process.env['XDG_CONFIG_HOME'] = xdg;
    const notFound = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    readFileMock.mockRejectedValueOnce(notFound);
    try {
      await readPersisted();
      expect(readFileMock).toHaveBeenLastCalledWith(
        join(xdg, 'open-codesign', 'preferences.json'),
        'utf8',
      );
    } finally {
      if (prev === undefined) process.env['XDG_CONFIG_HOME'] = undefined;
      else process.env['XDG_CONFIG_HOME'] = prev;
    }
  });

  it('throws CodesignError with PREFERENCES_READ_FAIL on a non-ENOENT error (e.g. EACCES)', async () => {
    const permissionDenied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    readFileMock.mockRejectedValueOnce(permissionDenied);

    await expect(readPersisted()).rejects.toBeInstanceOf(CodesignError);

    readFileMock.mockRejectedValueOnce(permissionDenied);
    const err = await readPersisted().catch((e: unknown) => e);
    expect((err as CodesignError).code).toBe(ERROR_CODES.PREFERENCES_READ_FAIL);
  });

  it('throws when persisted preferences are not valid JSON', async () => {
    readFileMock.mockResolvedValueOnce('{"generationTimeoutSec":');

    await expect(readPersisted()).rejects.toMatchObject({
      code: ERROR_CODES.PREFERENCES_READ_FAIL,
    });
  });

  it('throws when persisted preferences contain malformed present fields', async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({ schemaVersion: 5, generationTimeoutSec: '1200' }),
    );

    await expect(readPersisted()).rejects.toMatchObject({
      code: ERROR_CODES.PREFERENCES_READ_FAIL,
      message: expect.stringContaining('generationTimeoutSec'),
    });
  });

  it('throws when persisted preferences contain unknown fields', async () => {
    readFileMock.mockResolvedValueOnce(JSON.stringify({ schemaVersion: 5, accidental: true }));

    await expect(readPersisted()).rejects.toMatchObject({
      code: ERROR_CODES.PREFERENCES_READ_FAIL,
      message: expect.stringContaining('unsupported field'),
    });
  });

  it('migrates schemaVersion 1 with legacy 120s timeout to the 1200s default', async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({ schemaVersion: 1, updateChannel: 'stable', generationTimeoutSec: 120 }),
    );
    const result = await readPersisted();
    expect(result.generationTimeoutSec).toBe(1200);
  });

  it('preserves user-chosen non-legacy timeout across the v1 → v2 migration', async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({ schemaVersion: 1, updateChannel: 'stable', generationTimeoutSec: 300 }),
    );
    const result = await readPersisted();
    expect(result.generationTimeoutSec).toBe(300);
  });

  it('migrates schemaVersion 2 with the old 600s default to 1200s', async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({ schemaVersion: 2, updateChannel: 'stable', generationTimeoutSec: 600 }),
    );
    const result = await readPersisted();
    expect(result.generationTimeoutSec).toBe(1200);
  });

  it('respects an explicit 600s when schema is already v3 (user chose it post-migration)', async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({ schemaVersion: 3, updateChannel: 'stable', generationTimeoutSec: 600 }),
    );
    const result = await readPersisted();
    expect(result.generationTimeoutSec).toBe(600);
  });

  it('upgrading from schema 4 seeds diagnosticsLastReadTs to now, not 0', async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        schemaVersion: 4,
        updateChannel: 'stable',
        generationTimeoutSec: 1200,
        checkForUpdatesOnStartup: true,
        dismissedUpdateVersion: '',
      }),
    );
    const before = Date.now();
    const result = await readPersisted();
    const after = Date.now();
    expect(result.diagnosticsLastReadTs).toBeGreaterThanOrEqual(before);
    expect(result.diagnosticsLastReadTs).toBeLessThanOrEqual(after);
  });

  it('preserves an existing diagnosticsLastReadTs across a schema bump', async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        schemaVersion: 4,
        updateChannel: 'stable',
        generationTimeoutSec: 1200,
        checkForUpdatesOnStartup: true,
        dismissedUpdateVersion: '',
        diagnosticsLastReadTs: 12345,
      }),
    );
    const result = await readPersisted();
    expect(result.diagnosticsLastReadTs).toBe(12345);
  });

  it('fresh install (ENOENT) keeps diagnosticsLastReadTs at 0', async () => {
    const notFound = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    readFileMock.mockRejectedValueOnce(notFound);
    const result = await readPersisted();
    expect(result.diagnosticsLastReadTs).toBe(0);
  });

  it('schema migration persists the seed so subsequent reads return the same ts', async () => {
    // Simulate a tiny in-memory filesystem: the first read returns the
    // pre-migration blob, the migration writes back, and the second read sees
    // the written blob.
    let onDisk = JSON.stringify({
      schemaVersion: 4,
      updateChannel: 'stable',
      generationTimeoutSec: 1200,
      checkForUpdatesOnStartup: true,
      dismissedUpdateVersion: '',
    });
    readFileMock.mockImplementation(async () => onDisk);
    writeFileMock.mockImplementation(async (_path: string, text: string) => {
      onDisk = text;
    });
    const first = await readPersisted();
    expect(first.diagnosticsLastReadTs).toBeGreaterThan(0);
    const second = await readPersisted();
    expect(second.diagnosticsLastReadTs).toBe(first.diagnosticsLastReadTs);
  });

  it('schema migration writes the seeded preferences to disk', async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        schemaVersion: 4,
        updateChannel: 'stable',
        generationTimeoutSec: 1200,
        checkForUpdatesOnStartup: true,
        dismissedUpdateVersion: '',
      }),
    );
    writeFileMock.mockImplementationOnce(async () => {});
    const before = Date.now();
    const result = await readPersisted();
    const after = Date.now();
    const lastCall = writeFileMock.mock.calls.at(-1);
    if (!lastCall) throw new Error('writeFile was not called during migration');
    const written = JSON.parse(lastCall[1] as string) as {
      schemaVersion: number;
      diagnosticsLastReadTs: number;
    };
    expect(written.schemaVersion).toBe(5);
    expect(written.diagnosticsLastReadTs).toBe(result.diagnosticsLastReadTs);
    expect(written.diagnosticsLastReadTs).toBeGreaterThanOrEqual(before);
    expect(written.diagnosticsLastReadTs).toBeLessThanOrEqual(after);
  });
});

describe('preferences v4 schema fields', () => {
  // Capture ipcMain.handle calls so we can invoke registered handlers directly.
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  const handlers: Record<string, (...args: any[]) => unknown> = {};

  beforeEach(async () => {
    for (const key of Object.keys(handlers)) delete handlers[key];
    const { ipcMain } = await import('electron');
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });
    // Re-register so the new mockImplementation captures the handlers.
    registerPreferencesIpc();
  });

  it('reads checkForUpdatesOnStartup and dismissedUpdateVersion with v4 defaults when absent', async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({ schemaVersion: 3, updateChannel: 'stable', generationTimeoutSec: 1200 }),
    );
    const prefs = await readPersisted();
    expect(prefs.checkForUpdatesOnStartup).toBe(true);
    expect(prefs.dismissedUpdateVersion).toBe('');
  });

  it('does not register unversioned preferences channels', () => {
    expect(handlers['preferences:v1:get']).toBeDefined();
    expect(handlers['preferences:v1:update']).toBeDefined();
    expect(handlers['preferences:get']).toBeUndefined();
    expect(handlers['preferences:update']).toBeUndefined();
  });

  it('rejects unknown update fields instead of dropping them', async () => {
    const readCalls = readFileMock.mock.calls.length;
    const writeCalls = writeFileMock.mock.calls.length;
    await expect(
      (handlers['preferences:v1:update'] as (_e: null, raw: unknown) => Promise<unknown>)(null, {
        dismissedUpdateVersion: '0.2.1',
        accidentalField: true,
      }),
    ).rejects.toThrow(/unsupported field/);
    expect(readFileMock).toHaveBeenCalledTimes(readCalls);
    expect(writeFileMock).toHaveBeenCalledTimes(writeCalls);
  });

  it('round-trips dismissedUpdateVersion through preferences:v1:update', async () => {
    // First read (in the update handler) returns the current stored preferences.
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        schemaVersion: 4,
        updateChannel: 'stable',
        generationTimeoutSec: 1200,
        checkForUpdatesOnStartup: true,
        dismissedUpdateVersion: '',
      }),
    );
    const updated = await (
      handlers['preferences:v1:update'] as (_e: null, raw: unknown) => Promise<unknown>
    )(null, { dismissedUpdateVersion: '0.2.1' });
    expect((updated as { dismissedUpdateVersion: string }).dismissedUpdateVersion).toBe('0.2.1');

    // Verify writeFile was called with the updated value.
    const lastCall = writeFileMock.mock.calls.at(-1);
    if (!lastCall) throw new Error('writeFile was not called');
    const written = JSON.parse(lastCall[1] as string) as { dismissedUpdateVersion: string };
    expect(written.dismissedUpdateVersion).toBe('0.2.1');
  });
});
