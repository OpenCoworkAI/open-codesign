import { BUILTIN_PROVIDERS, type ReasoningLevel, type WireApi } from '@open-codesign/shared';
import { afterEach, expect, it, vi } from 'vitest';
import { complete } from './index';

// Exercise the real pinned pi adapter and SDK; intercept only serialized HTTP.
afterEach(() => vi.unstubAllGlobals());

const cases = (['api.minimax.io', 'api.minimaxi.com'] as const).flatMap((host) =>
  (['openai-chat', 'anthropic'] as const).flatMap((wire) =>
    ([undefined, 'off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const).map((reasoning) => ({
      host,
      wire,
      reasoning,
    })),
  ),
);

async function capture(modelId: string, host: string, wire: WireApi, reasoning?: ReasoningLevel) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      // A non-retryable response ends the test without paid inference.
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
    complete(
      { provider: 'minimax', modelId },
      [
        { role: 'system', content: 'Design helper' },
        { role: 'user', content: 'Describe this' },
      ],
      {
        apiKey: 'offline-fixture',
        wire,
        baseUrl: `https://${host}/${wire === 'anthropic' ? 'anthropic' : 'v1'}`,
        maxTokens: 1024,
        ...(reasoning === undefined ? {} : { reasoning }),
        userImages: [{ data: 'aGVsbG8=', mimeType: 'image/png' }],
      },
    ),
  ).rejects.toThrow('offline fixture');
  expect(calls).toHaveLength(1);
  const call = calls[0];
  if (!call) throw new Error('Expected an HTTP request');
  return call;
}

it.each(cases)('serializes the Flash default for $host/$wire/$reasoning', async ({
  host,
  wire,
  reasoning,
}) => {
  const { url, body } = await capture(
    BUILTIN_PROVIDERS.minimax.defaultModel ?? '',
    host,
    wire,
    reasoning,
  );
  expect(url).toContain(wire === 'anthropic' ? '/anthropic/v1/messages' : '/v1/chat/completions');
  expect(body['model']).toBe('MiniMax-M3.1-Flash');
  expect(body['thinking']).toEqual({ type: 'adaptive' });
  const effort =
    reasoning === 'minimal' ? 'low' : reasoning === 'off' ? 'max' : (reasoning ?? 'max');
  expect(wire === 'anthropic' ? body['output_config'] : body['reasoning_effort']).toEqual(
    wire === 'anthropic' ? { effort } : effort,
  );
  expect(body).not.toHaveProperty('service_tier');
  expect(body).not.toHaveProperty('reasoning_split');
  expect(JSON.stringify(body['messages'])).toContain('aGVsbG8=');
});

it.each([
  'openai-chat',
  'anthropic',
] as const)('preserves M3 defaults and saved legacy IDs on %s', async (wire) => {
  const { body } = await capture('MiniMax-M3', 'api.minimax.io', wire);
  expect(body['thinking']).toEqual({ type: wire === 'anthropic' ? 'disabled' : 'adaptive' });
  expect(body).not.toHaveProperty('reasoning_effort');
  expect(body).not.toHaveProperty('output_config');
  const legacy = await capture('MiniMax-M2.7', 'api.minimax.io', wire);
  expect(legacy.body['model']).toBe('MiniMax-M2.7');
});

it('leaves custom gateway payloads alone', async () => {
  const { body } = await capture('MiniMax-M3.1-Flash', 'custom.example', 'openai-chat');
  expect(body).not.toHaveProperty('thinking');
  expect(body).not.toHaveProperty('reasoning_effort');
});

it('supports stateless native Responses without disabling Flash thinking', async () => {
  const { url, body } = await capture(
    'MiniMax-M3.1-Flash',
    'api.minimax.io',
    'openai-responses',
    'off',
  );
  expect(url).toContain('/v1/responses');
  expect(body['reasoning']).toEqual({ effort: 'max' });
  expect(body).not.toHaveProperty('store');
  expect(body).not.toHaveProperty('previous_response_id');
  expect(JSON.stringify(body['input'])).toContain('aGVsbG8=');
});
