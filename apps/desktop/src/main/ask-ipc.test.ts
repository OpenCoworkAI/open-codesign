import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AskInput } from '@open-codesign/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebResearchAuthorization } from './web-research';

const { handlers, windows, userData } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, raw?: unknown) => unknown>(),
  windows: [] as Electron.BrowserWindow[],
  userData: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { getPath: userData },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, raw?: unknown) => unknown) =>
      handlers.set(channel, handler),
    ),
  },
  BrowserWindow: { getAllWindows: () => windows },
}));
vi.mock('./logger', () => ({
  getLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

import {
  cancelPendingAskRequests,
  listPendingAskRequests,
  registerAskIpc,
  requestAsk,
} from './ask-ipc';
import { type AskRequestPayload, AskStore } from './ask-store';

const sampleInput: AskInput = {
  questions: [{ id: 'q1', type: 'freeform', prompt: 'what style?' }],
};
const answer = { status: 'answered', answers: [{ questionId: 'q1', value: 'quiet' }] };
let directory: string;
let path: string;
function invoke(channel: string, raw?: unknown): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`Missing handler: ${channel}`);
  return Promise.resolve(handler(null, raw));
}
function makeWindow(send = vi.fn()): Electron.BrowserWindow {
  const win = Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false),
    webContents: Object.assign(new EventEmitter(), { send, isDestroyed: vi.fn(() => false) }),
  }) as unknown as Electron.BrowserWindow;
  windows.push(win);
  return win;
}
async function firstPending(): Promise<AskRequestPayload> {
  const entry = (await listPendingAskRequests())[0];
  if (!entry) throw new Error('Missing pending question');
  return entry;
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ask-ipc-'));
  path = join(directory, 'questions.jsonl');
  handlers.clear();
  windows.length = 0;
  registerAskIpc(path);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const request of await listPendingAskRequests())
    await cancelPendingAskRequests(request.sessionId);
  await rm(directory, { recursive: true, force: true });
});

describe('durable ask IPC', () => {
  it('retains questions without a window and exposes design/run scope for recovery', async () => {
    const result = requestAsk('run-a', sampleInput, () => null, { designId: 'design-a' });
    const entry = await firstPending();
    expect(entry).toMatchObject({
      sessionId: 'run-a',
      runId: 'run-a',
      designId: 'design-a',
      input: sampleInput,
    });
    expect(await invoke('ask:list-pending')).toEqual([entry]);
    await invoke('ask:resolve', { requestId: entry.requestId, ...answer });
    await expect(result).resolves.toEqual(answer);
  });

  it('appends before live delivery and before resolving the runtime; broadcasts to every window', async () => {
    let deliveredJournal: Promise<string> | undefined;
    const send = vi.fn((channel: string) => {
      if (channel === 'ask:request') deliveredJournal = readFile(path, 'utf8');
    });
    const win = makeWindow(send);
    const otherSend = vi.fn();
    makeWindow(otherSend);
    const result = requestAsk('run-order', sampleInput, () => win);
    const entry = await firstPending();
    expect(send).toHaveBeenCalledWith('ask:request', entry);
    expect(await deliveredJournal).toContain('"status":"pending"');
    const runtimeJournal = result.then(() => readFile(path, 'utf8'));
    await invoke('ask:resolve', { requestId: entry.requestId, ...answer });
    expect(await runtimeJournal).toContain('"status":"answered"');
    expect(otherSend).toHaveBeenCalledWith(
      'ask:resolved',
      expect.objectContaining({ requestId: entry.requestId, status: 'answered' }),
    );
    expect(await listPendingAskRequests()).toEqual([]);
  });

  it('keeps requests recoverable when delivery throws or the window closes', async () => {
    const win = makeWindow(
      vi.fn(() => {
        throw new Error('Window closed');
      }),
    );
    const result = requestAsk('run-closed', sampleInput, () => win);
    const entry = await firstPending();
    expect(await invoke('ask:list-pending')).toHaveLength(1);
    await invoke('ask:resolve', { requestId: entry.requestId, ...answer });
    await expect(result).resolves.toEqual(answer);
  });

  it.each([
    { unexpected: true, answers: [] },
    { answers: [{ questionId: 'q1', value: { bad: true } }] },
    { answers: [{ questionId: 'q1', value: Number.NaN }] },
    { answers: [{ questionId: 'wrong', value: 'quiet' }] },
    { answers: [{ questionId: 'q1', value: 1 }] },
    { answers: [] },
  ])('rejects invalid submissions without rejecting or removing the original ask: %j', async (invalid) => {
    const result = requestAsk('run-invalid', sampleInput, () => null);
    const entry = await firstPending();
    await expect(
      invoke('ask:resolve', { requestId: entry.requestId, status: 'answered', ...invalid }),
    ).rejects.toMatchObject({ code: 'IPC_BAD_INPUT' });
    expect(await listPendingAskRequests()).toEqual([entry]);
    await invoke('ask:resolve', { requestId: entry.requestId, ...answer });
    await expect(result).resolves.toEqual(answer);
  });

  it('serializes duplicate answer retries and rejects conflicts without overwriting the answer', async () => {
    const result = requestAsk('run-retry', sampleInput, () => null);
    const entry = await firstPending();
    await Promise.all([
      invoke('ask:resolve', { requestId: entry.requestId, ...answer }),
      invoke('ask:resolve', { requestId: entry.requestId, ...answer }),
    ]);
    await expect(
      invoke('ask:resolve', { requestId: entry.requestId, status: 'cancelled', answers: [] }),
    ).rejects.toMatchObject({ code: 'IPC_BAD_INPUT' });
    await expect(result).resolves.toEqual(answer);
    expect((await readFile(path, 'utf8')).trim().split('\n')).toHaveLength(2);
    expect(await invoke('ask:history', { runId: 'run-retry' })).toEqual([
      expect.objectContaining({ status: 'answered', result: answer }),
    ]);
  });

  it('preserves a pending question on persistence failure and allows a retry', async () => {
    const result = requestAsk('run-write-failed', sampleInput, () => null);
    const entry = await firstPending();
    vi.spyOn(AskStore.prototype, 'settle').mockRejectedValueOnce(new Error('Disk unavailable'));
    await expect(invoke('ask:resolve', { requestId: entry.requestId, ...answer })).rejects.toThrow(
      'Disk unavailable',
    );
    expect(await listPendingAskRequests()).toEqual([entry]);
    await invoke('ask:resolve', { requestId: entry.requestId, ...answer });
    await expect(result).resolves.toEqual(answer);
  });

  it('cancels every question in only the requested run, including before append completes', async () => {
    const first = requestAsk('run-cancel', sampleInput, () => null);
    const second = requestAsk('run-cancel', sampleInput, () => null);
    const other = requestAsk('run-other', sampleInput, () => null);
    await cancelPendingAskRequests('run-cancel');
    await expect(first).resolves.toEqual({ status: 'cancelled', answers: [] });
    await expect(second).resolves.toEqual({ status: 'cancelled', answers: [] });
    expect(await listPendingAskRequests()).toEqual([
      expect.objectContaining({ sessionId: 'run-other' }),
    ]);
    await cancelPendingAskRequests('run-other');
    await other;
    expect(await invoke('ask:history', { runId: 'run-cancel' })).toEqual([
      expect.objectContaining({ status: 'cancelled' }),
      expect.objectContaining({ status: 'cancelled' }),
    ]);
  });

  it.each([
    false,
    true,
  ])('aborts durably and removes signal listeners (already aborted: %s)', async (early) => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    if (early) controller.abort();
    const result = requestAsk('run-abort', sampleInput, () => null, { signal: controller.signal });
    if (!early) {
      await firstPending();
      controller.abort();
    }
    await expect(result).resolves.toEqual({ status: 'cancelled', answers: [] });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(await listPendingAskRequests()).toEqual([]);
    expect(await invoke('ask:history')).toEqual([expect.objectContaining({ status: 'cancelled' })]);
  });

  it('rejects the runtime and removes listeners if the initial append fails', async () => {
    vi.spyOn(AskStore.prototype, 'create').mockRejectedValueOnce(new Error('Disk full'));
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    await expect(
      requestAsk('run-fail', sampleInput, () => null, { signal: controller.signal }),
    ).rejects.toThrow('Disk full');
    expect(remove).toHaveBeenCalled();
    expect(await listPendingAskRequests()).toEqual([]);
  });

  it('aborts only the matching wait, removes listeners and emits its typed cancellation', async () => {
    const window = makeWindow();
    const controller = new AbortController();
    const first = requestAsk('same-run', sampleInput, () => window, controller.signal);
    const other = requestAsk('same-run', sampleInput, () => window);
    const [payload] = await listPendingAskRequests();
    controller.abort();
    await expect(first).resolves.toEqual({ status: 'cancelled', answers: [] });
    expect(await listPendingAskRequests()).toHaveLength(1);
    expect(window.webContents.send).toHaveBeenCalledWith('ask:cancelled', {
      schemaVersion: 1,
      requestId: payload?.requestId,
      sessionId: 'same-run',
    });
    expect(window.listenerCount('closed')).toBe(0);
    await cancelPendingAskRequests('same-run');
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
    expect(window.webContents.send).not.toHaveBeenCalledWith('ask:request', expect.anything());
    expect(await listPendingAskRequests()).toEqual([]);
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
    expect(await listPendingAskRequests()).toEqual([]);
    expect(window.listenerCount('closed')).toBe(0);
  });

  it('detaches after an answer and never emits cancellation after it', async () => {
    registerAskIpc();
    const window = makeWindow();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const waiting = requestAsk('answered', sampleInput, () => window, controller.signal);
    const [payload] = await listPendingAskRequests();
    await invoke('ask:resolve', {
      requestId: payload?.requestId,
      status: 'answered',
      answers: [{ questionId: 'q1', value: 'green' }],
    });
    await waiting;
    controller.abort();
    expect(window.webContents.send).toHaveBeenCalledTimes(2);
    expect(window.webContents.send).not.toHaveBeenCalledWith('ask:cancelled', expect.anything());
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(window.listenerCount('closed')).toBe(0);
    expect(window.webContents.listenerCount('destroyed')).toBe(0);
  });

  it.each([
    'closed',
    'destroyed',
  ])('retains a %s window clarification for recovery until explicit cancellation', async (event) => {
    const window = makeWindow();
    const waiting = requestAsk('closed', sampleInput, () => window);
    const payload = await firstPending();
    if (event === 'closed') {
      vi.mocked(window.isDestroyed).mockReturnValue(true);
      window.emit('closed');
    } else {
      vi.mocked(window.webContents.isDestroyed).mockReturnValue(true);
      window.webContents.emit('destroyed');
    }
    expect(await listPendingAskRequests()).toEqual([payload]);
    expect(window.webContents.send).toHaveBeenCalledTimes(1);
    await cancelPendingAskRequests('closed');
    await expect(waiting).resolves.toEqual({ status: 'cancelled', answers: [] });
    expect(await listPendingAskRequests()).toEqual([]);
  });
});

describe('web research consent through the live ask IPC bridge', () => {
  it.each([
    'Allow this run',
    'Deny',
  ])('requires explicit %s and reuses the decision only within the run', async (choice) => {
    registerAskIpc();
    const send = vi.fn();
    const window = makeWindow(send);
    const network = vi.fn(async () => []);
    const authorize = createWebResearchAuthorization(
      { enabled: true, maxCalls: 7 },
      (input, signal) =>
        requestAsk('web-research-run', input, () => window, {
          designId: 'research-design',
          ...(signal ? { signal } : {}),
        }),
    );
    const first = authorize().then(network);
    expect(network).not.toHaveBeenCalled();
    const payload = await firstPending();
    expect(send.mock.calls[0]?.[0]).toBe('ask:request');
    expect(payload).toMatchObject({
      sessionId: 'web-research-run',
      runId: 'web-research-run',
      designId: 'research-design',
    });
    expect(payload.input.questions[0]).toMatchObject({
      id: 'web-research-permission',
      prompt: expect.stringContaining('7'),
      options: ['Allow this run', 'Deny'],
    });
    const resolve = handlers.get('ask:resolve');
    if (!resolve) throw new Error('ask:resolve handler missing');
    await resolve(null, {
      requestId: payload.requestId,
      status: 'answered',
      answers: [{ questionId: 'web-research-permission', value: choice }],
    });
    if (choice === 'Allow this run') {
      await expect(first).resolves.toEqual([]);
      await authorize().then(network);
      expect(network).toHaveBeenCalledTimes(2);
    } else {
      await expect(first).rejects.toThrow(/permission denied/);
      await expect(authorize()).rejects.toThrow(/permission denied/);
      expect(network).not.toHaveBeenCalled();
    }
    expect(send.mock.calls.filter(([channel]) => channel === 'ask:request')).toHaveLength(1);
    expect(await listPendingAskRequests()).toEqual([]);
  });

  it('cancels a pending consent request without ever making a network call', async () => {
    const send = vi.fn();
    const window = makeWindow(send);
    const controller = new AbortController();
    const network = vi.fn();
    const authorize = createWebResearchAuthorization(
      { enabled: true, maxCalls: 7 },
      (input, signal) => requestAsk('web-research-abort', input, () => window, signal),
    );
    const pending = authorize(controller.signal).then(network);
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
    expect(await listPendingAskRequests()).toEqual([]);
    expect(send).toHaveBeenCalledWith(
      'ask:cancelled',
      expect.objectContaining({ sessionId: 'web-research-abort' }),
    );
  });

  it('does not ask for consent when the feature is disabled; the service reports the configuration error', async () => {
    const request = vi.fn();
    await createWebResearchAuthorization({ enabled: false, maxCalls: 7 }, request)();
    expect(request).not.toHaveBeenCalled();
  });
});
