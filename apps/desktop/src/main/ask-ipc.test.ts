import { EventEmitter } from 'node:events';
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

import {
  cancelPendingAskRequests,
  listPendingAskRequests,
  registerAskIpc,
  requestAsk,
} from './ask-ipc';

const sampleInput: AskInput = {
  questions: [{ id: 'q1', type: 'freeform', prompt: 'what style?' }],
};

function makeWindow(send = vi.fn()) {
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false),
    webContents: Object.assign(new EventEmitter(), { send, isDestroyed: vi.fn(() => false) }),
  });
  return window as unknown as Electron.BrowserWindow;
}

describe('ask-ipc', () => {
  it('resolves to cancelled when no main window is available', async () => {
    const result = await requestAsk('session-a', sampleInput, () => null);
    expect(result).toEqual({ status: 'cancelled', answers: [] });
  });

  it('sends ask:request and cancelPendingAskRequests resolves in-flight as cancelled', async () => {
    const send = vi.fn();
    const fakeWindow = makeWindow(send);
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
    const fakeWindow = makeWindow(send);
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
    const fakeWindow = makeWindow(send);
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
    const fakeWindow = makeWindow(send);
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
    const fakeWindow = makeWindow(send);
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

  it('aborts only the matching wait, removes listeners and emits its typed cancellation', async () => {
    const window = makeWindow();
    const controller = new AbortController();
    const first = requestAsk('same-run', sampleInput, () => window, controller.signal);
    const other = requestAsk('same-run', sampleInput, () => window);
    const [payload] = listPendingAskRequests();
    controller.abort();
    await expect(first).resolves.toEqual({ status: 'cancelled', answers: [] });
    expect(listPendingAskRequests()).toHaveLength(1);
    expect(window.webContents.send).toHaveBeenCalledWith('ask:cancelled', {
      schemaVersion: 1,
      requestId: payload?.requestId,
      sessionId: 'same-run',
    });
    expect(window.listenerCount('closed')).toBe(1);
    cancelPendingAskRequests('same-run');
    await other;
    expect(window.listenerCount('closed')).toBe(0);
    expect(window.webContents.listenerCount('destroyed')).toBe(0);
  });

  it('does not publish an already-aborted ask', async () => {
    const controller = new AbortController();
    controller.abort();
    const window = makeWindow();
    await expect(
      requestAsk('aborted', sampleInput, () => window, controller.signal),
    ).resolves.toEqual({ status: 'cancelled', answers: [] });
    expect(window.webContents.send).not.toHaveBeenCalled();
    expect(listPendingAskRequests()).toEqual([]);
  });

  it('still settles if the renderer disconnects while sending cancellation', async () => {
    const send = vi.fn((channel: string) => {
      if (channel === 'ask:cancelled') throw new Error('Renderer disconnected');
    });
    const window = makeWindow(send);
    const controller = new AbortController();
    const waiting = requestAsk('disconnect', sampleInput, () => window, controller.signal);
    controller.abort();
    await expect(waiting).resolves.toEqual({ status: 'cancelled', answers: [] });
    expect(listPendingAskRequests()).toEqual([]);
    expect(window.listenerCount('closed')).toBe(0);
  });

  it('detaches after an answer and never emits cancellation after it', async () => {
    registerAskIpc();
    const window = makeWindow();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const waiting = requestAsk('answered', sampleInput, () => window, controller.signal);
    const [payload] = listPendingAskRequests();
    handlers.get('ask:resolve')?.(null, {
      requestId: payload?.requestId,
      status: 'answered',
      answers: [{ questionId: 'q1', value: 'green' }],
    });
    await waiting;
    controller.abort();
    expect(window.webContents.send).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(window.listenerCount('closed')).toBe(0);
    expect(window.webContents.listenerCount('destroyed')).toBe(0);
  });

  it.each([
    'closed',
    'destroyed',
  ])('settles a %s window without orphaning its clarification', async (event) => {
    const window = makeWindow();
    const waiting = requestAsk('closed', sampleInput, () => window);
    if (event === 'closed') {
      vi.mocked(window.isDestroyed).mockReturnValue(true);
      window.emit('closed');
    } else {
      vi.mocked(window.webContents.isDestroyed).mockReturnValue(true);
      window.webContents.emit('destroyed');
    }
    await expect(waiting).resolves.toEqual({ status: 'cancelled', answers: [] });
    expect(listPendingAskRequests()).toEqual([]);
    expect(window.webContents.send).toHaveBeenCalledTimes(1);
  });
});
