import type { AskCancelledV1 } from '@open-codesign/shared';
import { expect, it, vi } from 'vitest';
import type { CodesignApi } from './index';

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn<(name: string, api: CodesignApi) => void>(),
  on: vi.fn<
    (channel: string, listener: (event: unknown, payload: AskCancelledV1) => void) => void
  >(),
  removeListener: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: electron,
}));
import './index';

it('exposes a typed, unsubscribable host cancellation event without resolving the ask', () => {
  const api = electron.exposeInMainWorld.mock.calls[0]?.[1];
  if (!api) throw new Error('Missing exposed preload API');
  const callback = vi.fn();
  const off = api.ask.onCancelled(callback);
  const listener = electron.on.mock.calls[0]?.[1];
  if (!listener) throw new Error('Missing cancellation listener');
  expect(electron.on).toHaveBeenCalledWith('ask:cancelled', listener);
  const cancelled: AskCancelledV1 = {
    schemaVersion: 1,
    requestId: 'request-a',
    sessionId: 'session-a',
  };
  listener({}, cancelled);
  expect(callback).toHaveBeenCalledExactlyOnceWith(cancelled);
  off();
  expect(electron.removeListener).toHaveBeenCalledExactlyOnceWith('ask:cancelled', listener);
  expect(electron.invoke).not.toHaveBeenCalled();
});

it('forwards immutable comment expectations without changing the legacy mark-applied payload', async () => {
  const api = electron.exposeInMainWorld.mock.calls[0]?.[1];
  if (!api) throw new Error('Missing exposed API');
  const result = { schemaVersion: 1, applied: [], conflictedIds: ['edit'] };
  electron.invoke.mockResolvedValueOnce(result);
  expect(
    await api.comments.markAppliedIfUnchanged('design', ['edit'], 'after', { edit: 'original' }),
  ).toBe(result);
  expect(electron.invoke).toHaveBeenLastCalledWith('comments:v1:mark-applied', {
    schemaVersion: 1,
    designId: 'design',
    ids: ['edit'],
    snapshotId: 'after',
    expectedContent: { edit: 'original' },
  });
  await api.comments.markApplied('design', ['edit'], 'after');
  expect(electron.invoke).toHaveBeenLastCalledWith('comments:v1:mark-applied', {
    schemaVersion: 1,
    designId: 'design',
    ids: ['edit'],
    snapshotId: 'after',
  });
});
