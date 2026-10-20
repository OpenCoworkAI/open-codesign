import { BUILTIN_PROVIDERS } from '@open-codesign/shared';
import { afterEach, expect, it, vi } from 'vitest';

// Session storage is not used by generateViaAgent; keep the real agent and pi transport.
vi.mock('./agent-session.js', () => ({
  AuthStorage: {},
  createCodesignSession: vi.fn(),
  ModelRegistry: {},
  SessionManager: {},
}));

import { generateViaAgent } from './agent';

afterEach(() => vi.unstubAllGlobals());

it.each([
  'openai-chat',
  'anthropic',
  'openai-responses',
] as const)('serializes the Flash default through the live agent %s path', async (wire) => {
  const calls: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ error: { message: 'offline fixture', type: 'invalid_request_error' } }),
        {
          status: 400,
          headers: { 'content-type': 'application/json' },
        },
      );
    }),
  );
  await expect(
    generateViaAgent({
      prompt: 'Create a small design',
      history: [],
      apiKey: 'offline-fixture',
      model: { provider: 'minimax', modelId: BUILTIN_PROVIDERS.minimax.defaultModel ?? '' },
      wire,
      baseUrl: `https://api.minimax.io/${wire === 'anthropic' ? 'anthropic' : 'v1'}`,
    }),
  ).rejects.toThrow();
  expect(calls).toHaveLength(1);
  const body = calls[0];
  if (!body) throw new Error('Expected an HTTP request');
  expect(body['model']).toBe('MiniMax-M3.1-Flash');
  expect(body).not.toHaveProperty('service_tier');
  if (wire === 'openai-responses') {
    expect(body['reasoning']).toEqual({ effort: 'max' });
    expect(body).not.toHaveProperty('store');
  } else {
    expect(body['thinking']).toEqual({ type: 'adaptive' });
    expect(wire === 'anthropic' ? body['output_config'] : body['reasoning_effort']).toEqual(
      wire === 'anthropic' ? { effort: 'max' } : 'max',
    );
  }
});
