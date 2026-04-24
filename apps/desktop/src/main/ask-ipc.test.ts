import type { AskInput } from '@open-codesign/core';
import { describe, expect, it, vi } from 'vitest';
import { cancelPendingAskRequests, requestAsk } from './ask-ipc';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: class {},
}));

vi.mock('./logger', () => ({
  getLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

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
});
