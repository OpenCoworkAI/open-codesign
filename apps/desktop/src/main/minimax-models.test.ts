import { BUILTIN_PROVIDERS } from '@open-codesign/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, raw: unknown) => Promise<unknown>>(),
  getCachedConfig: vi.fn(),
}));
vi.mock('./electron-runtime', () => ({
  ipcMain: {
    handle: (name: string, handler: (_event: unknown, raw: unknown) => Promise<unknown>) =>
      mocks.handlers.set(name, handler),
  },
}));
vi.mock('./codex-oauth-ipc', () => ({ getCodexTokenStore: vi.fn() }));
vi.mock('./keychain', () => ({ maskSecret: vi.fn() }));
vi.mock('./onboarding-ipc', () => ({
  getCachedConfig: mocks.getCachedConfig,
  getApiKeyForProvider: () => 'offline-fixture',
  hasApiKeyForProvider: () => true,
}));
vi.mock('./tls-override', () => ({
  withTlsBypass: async (_enabled: boolean, fn: () => Promise<unknown>) => fn(),
}));

import { _clearModelsCache, registerConnectionIpc } from './connection-ipc';

beforeEach(() => {
  _clearModelsCache();
  registerConnectionIpc();
});
afterEach(() => vi.unstubAllGlobals());

it('returns Flash-first choices through stored-provider IPC without resetting legacy selection', async () => {
  const config = {
    activeProvider: 'minimax',
    activeModel: 'MiniMax-M2.7',
    providers: {
      minimax: {
        ...BUILTIN_PROVIDERS.minimax,
        defaultModel: 'MiniMax-M2.7',
        modelsHint: ['MiniMax-M2.7'],
      },
    },
  };
  mocks.getCachedConfig.mockReturnValue(config);
  const before = structuredClone(config);
  expect(await mocks.handlers.get('models:v1:list-for-provider')?.(null, 'minimax')).toEqual({
    ok: true,
    models: ['MiniMax-M3.1-Flash', 'MiniMax-M3'],
  });
  expect(config).toEqual(before);
});

it('filters both fetched and cached gateway catalogs through real IPC', async () => {
  mocks.getCachedConfig.mockReturnValue({
    providers: { openrouter: BUILTIN_PROVIDERS.openrouter },
  });
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: 'minimax/minimax-m2.7' },
            { id: 'other/model' },
            { id: 'minimax/minimax-m3' },
            { id: 'minimax/minimax-m3.1-flash:free' },
          ],
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  for (let i = 0; i < 2; i++) {
    expect(await mocks.handlers.get('models:v1:list-for-provider')?.(null, 'openrouter')).toEqual({
      ok: true,
      models: ['minimax/minimax-m3.1-flash:free', 'minimax/minimax-m3', 'other/model'],
    });
  }
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
