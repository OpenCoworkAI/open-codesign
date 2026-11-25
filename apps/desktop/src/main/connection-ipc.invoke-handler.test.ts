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
function chatResponse() {
  const chunk = (delta: object, finish_reason: string | null) => ({
    id: 'fixture',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'configured-model',
    choices: [{ index: 0, delta, finish_reason }],
  });
  return new Response(
    `${[chunk({ role: 'assistant', content: 'OK' }, null), chunk({}, 'stop')]
      .map((value) => `data: ${JSON.stringify(value)}\n\n`)
      .join('')}data: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
describe('saved-provider connection invocation handler', () => {
  it('applies the runtime default before deciding whether Anthropic inference can stay bounded', async () => {
    seed('anthropic', {
      wire: 'anthropic',
      defaultModel: 'claude-sonnet-4-6',
      baseUrl: 'https://api.anthropic.com',
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await handleConnectionV1TestProvider('anthropic')).toMatchObject({
      ok: false,
      code: 'INVOKE_UNVERIFIED',
      validationUnavailableReason: 'reasoning-budget-unsupported',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not let Anthropic reasoning expand the tiny probe into a large request', async () => {
    seed('custom-relay', { wire: 'anthropic', reasoningLevel: 'high' });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await handleConnectionV1TestProvider('custom-relay')).toMatchObject({
      ok: false,
      code: 'INVOKE_UNVERIFIED',
      invokeParity: 'unverified',
      validationUnavailableReason: 'reasoning-budget-unsupported',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('runs production pi with saved model, headers and reasoning instead of a probe model', async () => {
    seed('custom-relay', {
      capabilities: { modelDiscoveryMode: 'models' },
      reasoningLevel: 'off',
      httpHeaders: { 'x-fixture-auth': 'fixture-static-secret' },
    });
    const requests: Request[] = [];
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url.endsWith('/models'))
          return Response.json({ data: [{ id: 'configured-model' }] });
        bodies.push((await request.json()) as Record<string, unknown>);
        return chatResponse();
      }),
    );
    expect(await handleConnectionV1TestProvider('custom-relay')).toMatchObject({
      ok: true,
      invokeParity: 'aligned',
      invokeContract: { authMode: 'keyless', modelsProbeRelation: 'optional-discovery' },
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.url).toBe('https://relay.example/v1/chat/completions');
    expect(requests[1]?.headers.get('x-fixture-auth')).toBe('fixture-static-secret');
    expect(bodies[0]).toMatchObject({ model: 'configured-model', stream: true });
    expect(bodies[0]?.['max_tokens'] ?? bodies[0]?.['max_completion_tokens']).toBe(16);
    expect(bodies[0]?.['tools']).toBeUndefined();
    expect(bodies[0]?.['reasoning_effort']).toBeUndefined();
  });
  it.each([
    400, 402, 404, 422, 429,
  ])('does not turn HTTP %i into ready merely because models are reachable', async (status) => {
    seed('custom-relay');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        new Request(input, init).url.endsWith('/models')
          ? Response.json({ data: [] })
          : Response.json(
              {
                error: { message: `HTTP ${status}: model rejected`, type: 'invalid_request_error' },
              },
              { status },
            ),
      ),
    );
    expect(await handleConnectionV1TestProvider('custom-relay')).toMatchObject({
      ok: false,
      code: 'INVOKE_DIVERGED',
      invokeParity: 'diverged',
      reachableVia: 'models',
      attemptedUrl: 'https://relay.example/v1/chat/completions',
    });
  });
  it('accepts actual inference when discovery is missing', async () => {
    seed('custom-relay');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        new Request(input, init).url.endsWith('/models')
          ? new Response('', { status: 404 })
          : chatResponse(),
      ),
    );
    expect(await handleConnectionV1TestProvider('custom-relay')).toMatchObject({
      ok: true,
      compatibility: 'degraded',
      invokeParity: 'degraded-discovery',
    });
  });
  it('does not accept an empty model response as successful inference', async () => {
    seed('custom-relay', { capabilities: { modelDiscoveryMode: 'manual' } });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }),
      ),
    );
    expect(await handleConnectionV1TestProvider('custom-relay')).toMatchObject({ ok: false });
  });
  it('reports signed-out OAuth without claiming invocation parity', async () => {
    seed('chatgpt-codex', {
      wire: 'openai-codex-responses',
      baseUrl: 'https://chatgpt.com/backend-api',
      requiresApiKey: true,
    });
    oauth.getValidAccessToken.mockRejectedValue(new Error('ChatGPT login expired'));
    expect(await handleConnectionV1TestProvider('chatgpt-codex')).toMatchObject({
      ok: false,
      code: '401',
      reasonCategory: 'auth',
    });
  });
  it.each([
    { wire: 'openai-chat' as const },
    { baseUrl: 'https://untrusted.example/backend-api' },
    { baseUrl: 'http://chatgpt.com/backend-api' },
    { baseUrl: 'https://user:password@chatgpt.com/backend-api' },
    { baseUrl: 'https://chatgpt.com/backend-api?token=secret' },
    { baseUrl: 'https://chatgpt.com/other-path' },
    { tlsRejectUnauthorized: true },
    { queryParams: { token: 'secret' } },
  ])('rejects an untrusted reserved Codex contract before token access: %j', async (override) => {
    seed('chatgpt-codex', {
      wire: 'openai-codex-responses',
      baseUrl: 'https://chatgpt.com/backend-api',
      ...override,
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await handleConnectionV1TestProvider('chatgpt-codex')).toMatchObject({
      ok: false,
      code: 'IPC_BAD_INPUT',
    });
    expect(oauth.getValidAccessToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects unsupported queries rather than silently claiming parity', async () => {
    seed('custom-relay', { queryParams: { 'api-version': 'fixture-version' } });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await handleConnectionV1TestProvider('custom-relay')).toMatchObject({
      ok: false,
      code: 'IPC_BAD_INPUT',
      message: expect.stringContaining('query parameters'),
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
