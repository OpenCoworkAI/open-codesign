import { beforeEach, describe, expect, it, vi } from 'vitest';

const updaterHandlers = new Map<string, (arg: Error) => void>();
const ipcHandleMock = vi.hoisted(() => vi.fn());
const updaterOnMock = vi.hoisted(() =>
  vi.fn((event: string, cb: (arg: Error) => void) => {
    updaterHandlers.set(event, cb);
  }),
);
const warnMock = vi.hoisted(() => vi.fn());
const errorMock = vi.hoisted(() => vi.fn());

vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: true,
    on: updaterOnMock,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
  },
}));

vi.mock('../electron-runtime', () => ({
  app: { isPackaged: true },
  ipcMain: { handle: ipcHandleMock },
}));

vi.mock('../logger', () => ({
  getLogger: () => ({ warn: warnMock, error: errorMock }),
}));

import { setupAutoUpdater } from './update';

describe('setupAutoUpdater', () => {
  beforeEach(() => {
    updaterHandlers.clear();
    ipcHandleMock.mockClear();
    updaterOnMock.mockClear();
    warnMock.mockClear();
    errorMock.mockClear();
  });

  it('logs missing updater metadata as a warning instead of an error', () => {
    setupAutoUpdater(() => null);

    updaterHandlers.get('error')?.(
      new Error('Cannot find latest-linux.yml in the latest release artifacts (HttpError: 404)'),
    );

    expect(warnMock).toHaveBeenCalledWith('autoUpdater.missingChannel', {
      message: expect.stringContaining('latest-linux.yml'),
    });
    expect(errorMock).not.toHaveBeenCalled();
  });

  it('keeps unexpected updater errors at error level', () => {
    setupAutoUpdater(() => null);

    updaterHandlers.get('error')?.(new Error('update server returned 500'));

    expect(errorMock).toHaveBeenCalledWith('autoUpdater.error', {
      message: 'update server returned 500',
      stack: expect.any(String),
    });
  });
});
