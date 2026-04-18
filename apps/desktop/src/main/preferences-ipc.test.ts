import { CodesignError } from '@open-codesign/shared';
import { describe, expect, it, vi } from 'vitest';

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

const readFileMock = vi.fn();

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
  writeFile: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
}));

import { readPersisted } from './preferences-ipc';

describe('readPersisted()', () => {
  it('returns defaults when the file does not exist (ENOENT)', async () => {
    const notFound = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    readFileMock.mockRejectedValueOnce(notFound);

    const result = await readPersisted();
    expect(result).toEqual({ updateChannel: 'stable', generationTimeoutSec: 120 });
  });

  it('throws CodesignError with PREFERENCES_READ_FAILED on a non-ENOENT error (e.g. EACCES)', async () => {
    const permissionDenied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    readFileMock.mockRejectedValueOnce(permissionDenied);

    await expect(readPersisted()).rejects.toBeInstanceOf(CodesignError);

    readFileMock.mockRejectedValueOnce(permissionDenied);
    const err = await readPersisted().catch((e: unknown) => e);
    expect((err as CodesignError).code).toBe('PREFERENCES_READ_FAILED');
  });
});
