import { createServer, type ServerResponse } from 'node:http';
import { getModel } from '@earendil-works/pi-ai';
import type { WireApi } from '@open-codesign/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { complete } from './index';

afterEach(() => vi.unstubAllGlobals());

function sendResponse(res: ServerResponse) {
  const item = {
    id: 'msg-local',
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: 'OK', annotations: [] }],
  };
  const events = [
    { type: 'response.created', response: { id: 'response-local', status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
    {
      type: 'response.content_part.added',
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
    },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'OK' },
    { type: 'response.output_item.done', output_index: 0, item },
    {
      type: 'response.completed',
      response: {
        id: 'response-local',
        status: 'completed',
        output: [item],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    },
  ];
  res.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''));
}

function sendChatCompletion(res: ServerResponse) {
  const frames = [
    {
      id: 'chat-local',
      choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }],
    },
    {
      id: 'chat-local',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ];
  res.end(
    `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`,
  );
}

async function invoke(provider: string, modelId: string, wire: WireApi) {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const expectedPath = wire === 'openai-responses' ? '/v1/responses' : '/v1/chat/completions';
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url ?? '', body: JSON.parse(body) as Record<string, unknown> });
    if (req.url !== expectedPath) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (wire === 'openai-responses') sendResponse(res);
    else sendChatCompletion(res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test listener');
    const origin = `http://127.0.0.1:${address.port}`;
    const actualFetch = globalThis.fetch.bind(globalThis);
    vi.stubGlobal('fetch', ((input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== origin) throw new Error('Test blocked a non-loopback SDK request');
      return actualFetch(input, init);
    }) satisfies typeof fetch);
    const result = await complete(
      { provider, modelId },
      [
        { role: 'system', content: 'Check the configured route.' },
        { role: 'user', content: 'ping' },
      ],
      {
        apiKey: 'synthetic-test-key',
        baseUrl: `${origin}/v1`,
        wire,
        maxTokens: 20,
        reasoning: 'off',
        timeoutMs: 2_000,
      },
    );
    expect(result.content).toBe('OK');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(expectedPath);
    expect(requests[0]?.body['model']).toBe(modelId);
    expect(requests[0]?.body['stream']).toBe(true);
    return requests[0]?.body;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe('configured invoke routing through the actual pi HTTP adapters', () => {
  it('sends a registered GPT-4o model to the configured local Responses endpoint', async () => {
    const catalog = getModel('openai', 'gpt-4o');
    expect(catalog).toBeDefined();
    const before = structuredClone(catalog);
    const body = await invoke('openai', 'gpt-4o', 'openai-responses');
    expect(body?.['input']).toBeInstanceOf(Array);
    expect(body?.['instructions']).toBe('Check the configured route.');
    expect(catalog).toEqual(before);
  });

  it('routes a registered GPT-5.1 model through Chat Completions with endpoint-specific compatibility', async () => {
    const catalog = getModel('openai', 'gpt-5.1');
    expect(catalog).toBeDefined();
    const before = structuredClone(catalog);
    const body = await invoke('openai', 'gpt-5.1', 'openai-chat');
    // A custom OpenAI-compatible endpoint must not inherit the catalog's
    // developer-role assumptions when the configured host requires system.
    expect(body?.['messages']).toMatchObject([{ role: 'system' }, { role: 'user' }]);
    expect(catalog).toEqual(before);
  });

  it('routes a registered OpenRouter DeepSeek model to the configured Chat Completions endpoint', async () => {
    const catalog = getModel('openrouter', 'deepseek/deepseek-chat');
    const before = structuredClone(catalog);
    expect(catalog).toBeDefined();
    const body = await invoke('openrouter', 'deepseek/deepseek-chat', 'openai-chat');
    expect(body?.['messages']).toMatchObject([{ role: 'system' }, { role: 'user' }]);
    expect(catalog).toEqual(before);
  });
});
