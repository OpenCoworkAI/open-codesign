import { CodesignError } from '@open-codesign/shared';
import { describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (event: unknown, raw: unknown) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, raw: unknown) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
  BrowserWindow: class {},
}));

vi.mock('./logger', () => ({
  getLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  cancelPendingPermissionRequests,
  registerPermissionIpc,
  requestPermission,
} from './permission-ipc';

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

  it('rejects malformed resolver payloads for a known request instead of leaving it pending', async () => {
    handlers.clear();
    registerPermissionIpc();
    const send = vi.fn();
    const fakeWindow = {
      isDestroyed: () => false,
      webContents: { send },
    } as unknown as Electron.BrowserWindow;
    const inFlight = requestPermission('session-c', 'pnpm test', () => fakeWindow);
    const payload = send.mock.calls[0]?.[1] as { requestId: string };
    const handler = handlers.get('permission:resolve');
    if (!handler) throw new Error('permission:resolve handler not registered');

    expect(() =>
      handler(null, { requestId: payload.requestId, scope: 'once', unexpected: true }),
    ).toThrow(CodesignError);
    await expect(inFlight).rejects.toMatchObject({ code: 'IPC_BAD_INPUT' });
  });

  it('rejects invalid resolver scope for a known request instead of leaving it pending', async () => {
    handlers.clear();
    registerPermissionIpc();
    const send = vi.fn();
    const fakeWindow = {
      isDestroyed: () => false,
      webContents: { send },
    } as unknown as Electron.BrowserWindow;
    const inFlight = requestPermission('session-d', 'pnpm test', () => fakeWindow);
    const payload = send.mock.calls[0]?.[1] as { requestId: string };
    const handler = handlers.get('permission:resolve');
    if (!handler) throw new Error('permission:resolve handler not registered');

    expect(() => handler(null, { requestId: payload.requestId, scope: 'maybe' })).toThrow(
      CodesignError,
    );
    await expect(inFlight).rejects.toMatchObject({ code: 'IPC_BAD_INPUT' });
  });
});
