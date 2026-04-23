import { describe, expect, it, vi } from 'vitest';
import { cancelPendingPermissionRequests, requestPermission } from './permission-ipc';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: class {},
}));

vi.mock('./logger', () => ({
  getLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe('permission-ipc', () => {
  it('resolves to deny when no main window is available', async () => {
    const decision = await requestPermission('session-a', 'pnpm install', () => null);
    expect(decision).toEqual({ scope: 'deny' });
  });

  it('cancelPendingPermissionRequests denies in-flight requests for that session', async () => {
    const send = vi.fn();
    const fakeWindow = {
      isDestroyed: () => false,
      webContents: { send },
    } as unknown as Electron.BrowserWindow;
    const inFlight = requestPermission('session-b', 'pnpm test', () => fakeWindow);
    expect(send).toHaveBeenCalledWith(
      'permission:request',
      expect.objectContaining({ sessionId: 'session-b', command: 'pnpm test' }),
    );
    cancelPendingPermissionRequests('session-b');
    await expect(inFlight).resolves.toEqual({ scope: 'deny' });
  });
});
