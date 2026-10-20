import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodesignApi } from './index';

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn<(name: string, api: CodesignApi) => void>(),
  invoke: vi.fn(),
}));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: electron,
}));
import './index';

const api = electron.exposeInMainWorld.mock.calls[0]?.[1];
if (!api) throw new Error('Missing exposed API');

beforeEach(() => electron.invoke.mockReset());

describe('web search preload bridge', () => {
  it('reads only the saved enabled/configured state', async () => {
    const state = { enabled: false, hasKey: true };
    electron.invoke.mockResolvedValueOnce(state);
    expect(await api.webSearch.get()).toEqual(state);
    expect(electron.invoke).toHaveBeenCalledExactlyOnceWith('settings:v1:get-web-search');
  });

  it('forwards separate enable, replace and clear patches without filling in absent keys', async () => {
    for (const input of [{ enabled: false }, { apiKey: 'tvly-fixture' }, { clearKey: true }]) {
      await api.webSearch.save(input);
      expect(electron.invoke).toHaveBeenLastCalledWith('settings:v1:save-web-search', input);
    }
  });

  it('tests with no arguments, so unsaved keys and task authorization cannot be supplied', async () => {
    electron.invoke.mockResolvedValueOnce({ status: 'ok' });
    expect(await api.webSearch.test()).toEqual({ status: 'ok' });
    expect(electron.invoke).toHaveBeenCalledExactlyOnceWith('settings:v1:test-web-search');
  });
});
