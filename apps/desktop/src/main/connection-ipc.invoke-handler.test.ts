import { hydrateConfig, type ProviderEntry } from '@open-codesign/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

const oauth = vi.hoisted(() => ({ getValidAccessToken: vi.fn() }));
vi.mock('./electron-runtime', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('./codex-oauth-ipc', () => ({ getCodexTokenStore: () => oauth }));
vi.mock('./tls-override', () => ({
  withTlsBypass: async (_enabled: boolean, fn: () => Promise<unknown>) => fn(),
}));

import { handleConnectionV1TestProvider } from './connection-ipc';
import { setCachedConfig } from './onboarding/config-cache';

function seed(id: string, overrides: Partial<ProviderEntry> = {}) {
  setCachedConfig(
    hydrateConfig({
      version: 3,
      activeProvider: id,
      activeModel: 'configured-model',
      secrets: {},
      providers: {
        [id]: {
          id,
          name: 'Configured relay',
          builtin: false,
          wire: 'openai-chat',
          baseUrl: 'https://relay.example/v1',
          defaultModel: 'configured-model',
          requiresApiKey: false,
          ...overrides,
        },
      },
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('saved-provider connection invocation handler', () => {
  it('resolves keyless credentials and default discovery capabilities through the production path', async () => {
    seed('custom-relay', { capabilities: { modelDiscoveryMode: 'models' } });
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers['authorization']).toBeUndefined();
      if (url.endsWith('/models')) return Response.json({ data: [{ id: 'configured-model' }] });
      expect(url).toBe('https://relay.example/v1/chat/completions');
      // This is a route/auth probe; model availability is checked by generation.
      expect(JSON.parse(String(init?.body)).model).toBe('probe');
      return Response.json({ choices: [] });
    });
    vi.stubGlobal('fetch', fetch);
    expect(await handleConnectionV1TestProvider('custom-relay')).toMatchObject({
      ok: true,
      invokeParity: 'aligned',
      invokeContract: { authMode: 'keyless', modelsProbeRelation: 'optional-discovery' },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reports a working model list and failing invoke endpoint as divergent', async () => {
    seed('custom-relay');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/models')
          ? Response.json({ data: [] })
          : new Response('not found', { status: 404 }),
      ),
    );
    expect(await handleConnectionV1TestProvider('custom-relay')).toMatchObject({
      ok: false,
      code: 'INVOKE_DIVERGED',
      invokeParity: 'diverged',
      invokeContract: { invokeUrl: 'https://relay.example/v1/chat/completions' },
    });
  });

  it('refreshes Codex OAuth instead of asking for a stored API key or model list', async () => {
    seed('chatgpt-codex', {
      builtin: true,
      wire: 'openai-codex-responses',
      baseUrl: 'https://chatgpt.com/backend-api',
      requiresApiKey: true,
    });
    oauth.getValidAccessToken.mockResolvedValue('refreshed-token');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await handleConnectionV1TestProvider('chatgpt-codex')).toMatchObject({
      ok: true,
      invokeParity: 'aligned',
      invokeContract: { authMode: 'codex-oauth', modelsProbeRelation: 'unavailable' },
    });
    expect(oauth.getValidAccessToken).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not claim probe parity when OAuth resolution fails', async () => {
    seed('chatgpt-codex', { wire: 'openai-codex-responses', requiresApiKey: true });
    oauth.getValidAccessToken.mockRejectedValue(new Error('ChatGPT login expired'));
    const result = await handleConnectionV1TestProvider('chatgpt-codex');
    expect(result).toMatchObject({ ok: false, code: '401', reasonCategory: 'auth' });
    expect(result.invokeParity).toBeUndefined();
  });
});
