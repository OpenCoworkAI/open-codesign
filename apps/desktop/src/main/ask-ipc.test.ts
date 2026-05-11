import type { AskInput } from '@open-codesign/core';
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

import { cancelPendingAskRequests, registerAskIpc, requestAsk } from './ask-ipc';

const sampleInput: AskInput = {
  questions: [{ id: 'q1', type: 'freeform', prompt: 'what style?' }],
};

describe('ask-ipc', () => {
  it('resolves to cancelled when no main window is available', async () => {
    const result = await requestAsk('session-a', sampleInput, () => null);
    expect(result).toEqual({ status: 'cancelled', answers: [] });
  });

  it('sends ask:request and cancelPendingAskRequests resolves in-flight as cancelled', async () => {
    const send = vi.fn();
    const fakeWindow = {
      isDestroyed: () => false,
      webContents: { send },
    } as unknown as Electron.BrowserWindow;
    const inFlight = requestAsk('session-b', sampleInput, () => fakeWindow);
    expect(send).toHaveBeenCalledWith(
      'ask:request',
      expect.objectContaining({ sessionId: 'session-b', input: sampleInput }),
    );
    cancelPendingAskRequests('session-b');
    await expect(inFlight).resolves.toEqual({ status: 'cancelled', answers: [] });
  });

  it('cancels every pending ask request for the same session', async () => {
    const send = vi.fn();
    const fakeWindow = {
      isDestroyed: () => false,
      webContents: { send },
    } as unknown as Electron.BrowserWindow;
    const first = requestAsk('session-many', sampleInput, () => fakeWindow);
    const second = requestAsk('session-many', sampleInput, () => fakeWindow);

    cancelPendingAskRequests('session-many');

    await expect(first).resolves.toEqual({ status: 'cancelled', answers: [] });
    await expect(second).resolves.toEqual({ status: 'cancelled', answers: [] });
  });

  it('lists pending ask requests so the renderer can recover a missed event', async () => {
    handlers.clear();
    registerAskIpc();
    const send = vi.fn();
    const fakeWindow = {
      isDestroyed: () => false,
      webContents: { send },
    } as unknown as Electron.BrowserWindow;
    const inFlight = requestAsk('session-recover', sampleInput, () => fakeWindow);
    const listPending = handlers.get('ask:list-pending');
    if (!listPending) throw new Error('ask:list-pending handler not registered');

    const result = listPending(null, undefined);

    expect(result).toEqual([
      expect.objectContaining({ sessionId: 'session-recover', input: sampleInput }),
    ]);
    cancelPendingAskRequests('session-recover');
    await expect(inFlight).resolves.toEqual({ status: 'cancelled', answers: [] });
  });

  it('rejects malformed answers for a known request instead of leaving it pending', async () => {
    handlers.clear();
    registerAskIpc();
    const send = vi.fn();
    const fakeWindow = {
      isDestroyed: () => false,
      webContents: { send },
    } as unknown as Electron.BrowserWindow;
    const inFlight = requestAsk('session-c', sampleInput, () => fakeWindow);
    const payload = send.mock.calls[0]?.[1] as { requestId: string };
    const handler = handlers.get('ask:resolve');
    if (!handler) throw new Error('ask:resolve handler not registered');

    expect(() =>
      handler(null, {
        requestId: payload.requestId,
        status: 'answered',
        unexpected: true,
        answers: [],
      }),
    ).toThrow(CodesignError);
    await expect(inFlight).rejects.toMatchObject({ code: 'IPC_BAD_INPUT' });
  });

  it('rejects malformed answer fields for a known request instead of leaving it pending', async () => {
    handlers.clear();
    registerAskIpc();
    const send = vi.fn();
    const fakeWindow = {
      isDestroyed: () => false,
      webContents: { send },
    } as unknown as Electron.BrowserWindow;
    const inFlight = requestAsk('session-d', sampleInput, () => fakeWindow);
    const payload = send.mock.calls[0]?.[1] as { requestId: string };
    const handler = handlers.get('ask:resolve');
    if (!handler) throw new Error('ask:resolve handler not registered');

    expect(() =>
      handler(null, {
        requestId: payload.requestId,
        status: 'answered',
        answers: [{ questionId: 'q1', value: { bad: true } }],
      }),
    ).toThrow(CodesignError);
    await expect(inFlight).rejects.toMatchObject({ code: 'IPC_BAD_INPUT' });
  });
});
