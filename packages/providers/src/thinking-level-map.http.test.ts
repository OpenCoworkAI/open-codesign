import { createServer, type Server } from 'node:http';
import { getModel } from '@earendil-works/pi-ai';
import type { ReasoningLevel, ThinkingLevelMap } from '@open-codesign/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { complete } from './index';

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
});

async function request(
  reasoning: ReasoningLevel | undefined,
  thinkingLevelMap: ThinkingLevelMap | undefined,
  registered = false,
) {
  const payloads: Record<string, unknown>[] = [];
  server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    payloads.push(JSON.parse(body) as Record<string, unknown>);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(
      `data: ${JSON.stringify({
        id: 'local-test',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }],
      })}\n\n`,
    );
    res.end(
      `data: ${JSON.stringify({
        id: 'local-test',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })}\n\ndata: [DONE]\n\n`,
    );
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  const result = await complete(
    registered
      ? { provider: 'openai', modelId: 'gpt-4o' }
      : { provider: 'custom-ninfer', modelId: 'qwen-local' },
    [{ role: 'user', content: 'hello' }],
    {
      apiKey: 'synthetic-test-key',
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      wire: 'openai-chat',
      maxTokens: 20,
      timeoutMs: 2_000,
      ...(reasoning !== undefined ? { reasoning } : {}),
      ...(thinkingLevelMap !== undefined ? { thinkingLevelMap } : {}),
    },
  );
  expect(result.content).toBe('OK');
  expect(payloads).toHaveLength(1);
  return payloads[0];
}

describe('thinking level maps through the actual pi HTTP adapter', () => {
  const map = { off: 'none', low: 'low', medium: 'medium', xhigh: 'xhigh' };

  it.each([
    ['off', 'none'],
    ['low', 'low'],
    ['minimal', 'low'],
    ['high', 'xhigh'],
    ['xhigh', 'xhigh'],
    [undefined, 'none'],
  ] as const)('sends %s as %s for a local model with no inferred reasoning', async (level, wire) => {
    expect((await request(level, map))?.['reasoning_effort']).toBe(wire);
  });

  it('never escalates off when the whitelist omits it', async () => {
    expect(await request('off', { low: 'local-low' })).not.toHaveProperty('reasoning_effort');
  });

  it('disables an empty whitelist without sending an unsupported effort', async () => {
    expect(await request('high', {})).not.toHaveProperty('reasoning_effort');
  });

  it('leaves an unconfigured non-reasoning endpoint unchanged', async () => {
    expect(await request('high', undefined)).not.toHaveProperty('reasoning_effort');
  });

  it('overrides registry model capabilities at the configured endpoint without mutating its catalog', async () => {
    const original = getModel('openai', 'gpt-4o');
    const before = structuredClone(original);
    expect((await request('high', map, true))?.['reasoning_effort']).toBe('xhigh');
    expect(original).toEqual(before);
  });
});
