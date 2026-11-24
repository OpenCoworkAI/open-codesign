import { getModel, streamSimple } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { complete } from './index';

const text = 'Synthetic response. 中文 response text stays intact.';
const item = {
  id: 'synthetic-message',
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text, annotations: [] }],
};
const prefix = [
  { type: 'response.created', response: { id: 'synthetic-response', status: 'in_progress' } },
  { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
  {
    type: 'response.content_part.added',
    output_index: 0,
    content_index: 0,
    part: { type: 'output_text', text: '', annotations: [] },
  },
  { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: text },
];
const doneItem = { type: 'response.output_item.done', output_index: 0, item };
const usage = { input_tokens: 1, output_tokens: 2, total_tokens: 3 };
const terminal = (type = 'response.completed', status: string | undefined = 'completed') => ({
  type,
  response: {
    id: 'synthetic-response',
    ...(status === undefined ? {} : { status }),
    output: [item],
    usage,
  },
});

function fixture(events: unknown[], suffix = '', fragmented = false) {
  const data = new TextEncoder().encode(
    events
      .map(
        (event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join('') + suffix,
  );
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== 'synthetic-relay.example') throw new Error('Refused non-fixture request');
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          if (fragmented) for (const byte of data) controller.enqueue(Uint8Array.of(byte));
          else controller.enqueue(data);
          controller.close();
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

async function stream(
  events: unknown[],
  options: { codex?: boolean; suffix?: string; fragmented?: boolean; signal?: AbortSignal } = {},
) {
  const fetch = fixture(events, options.suffix, options.fragmented);
  const catalog = getModel('openai', 'gpt-4.1');
  const model = {
    ...catalog,
    baseUrl: 'https://synthetic-relay.example/v1',
    ...(options.codex ? { api: 'openai-codex-responses' as const, provider: 'openai-codex' } : {}),
  };
  const token = options.codex
    ? `synthetic.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account' } })).toString('base64url')}.signature`
    : 'synthetic-test-key';
  const result = await streamSimple(
    model,
    { messages: [{ role: 'user', content: 'fixture', timestamp: 1 }] },
    {
      apiKey: token,
      maxRetries: 0,
      transport: 'sse',
      ...(options.signal ? { signal: options.signal } : {}),
    },
  ).result();
  expect(fetch.mock.calls.length).toBeLessThanOrEqual(1);
  return result;
}

afterEach(() => vi.unstubAllGlobals());

describe('actual pi Responses terminal handling', () => {
  it('accepts a completed stream with fragmented UTF-8 and response text', async () => {
    const result = await stream([...prefix, doneItem, terminal()], { fragmented: true });
    expect(result.stopReason).toBe('stop');
    expect(result.content).toMatchObject([{ type: 'text', text }]);
    expect(result.usage.totalTokens).toBe(3);
  });

  it.each([
    0, 1, 4, 5,
  ])('rejects EOF after %s events even when output text or item is present', async (count) => {
    const result = await stream([...prefix, doneItem].slice(0, count));
    expect(result.stopReason).toBe('error');
    expect(result.errorMessage).toContain('stream ended before a terminal completion event');
  });

  it('does not accept a bare DONE sentinel without a terminal Responses event', async () => {
    expect((await stream(prefix, { suffix: 'data: [DONE]\n\n' })).stopReason).toBe('error');
  });

  it.each([
    'in_progress',
    'queued',
    'unknown',
  ])('rejects a terminal frame whose response is still %s', async (status) => {
    const result = await stream([...prefix, terminal('response.completed', status)]);
    expect(result.stopReason).toBe('error');
    expect(result.errorMessage).toContain('invalid terminal status');
  });

  it('rejects missing terminal response metadata', async () => {
    expect((await stream([...prefix, { type: 'response.completed' }])).stopReason).toBe('error');
    expect(
      (
        await stream([
          ...prefix,
          { type: 'response.completed', response: { id: 'missing-status' } },
        ])
      ).stopReason,
    ).toBe('error');
  });

  it.each([
    terminal('response.completed', 'incomplete'),
    terminal('response.incomplete', 'incomplete'),
    {
      type: 'response.incomplete',
      response: {
        id: 'synthetic-response',
        incomplete_details: { reason: 'max_output_tokens' },
        usage,
      },
    },
  ])('keeps incomplete terminal outcomes as length', async (event) => {
    expect((await stream([...prefix, event])).stopReason).toBe('length');
  });

  it('keeps provider failure details and cancellation as unsuccessful outcomes', async () => {
    const failed = await stream([
      ...prefix,
      {
        type: 'response.failed',
        response: {
          status: 'failed',
          error: { code: 'synthetic_failure', message: 'Synthetic upstream failure' },
        },
      },
    ]);
    expect(failed.stopReason).toBe('error');
    expect(failed.errorMessage).toContain('Synthetic upstream failure');
    const controller = new AbortController();
    controller.abort();
    expect((await stream(prefix, { signal: controller.signal })).stopReason).toBe('aborted');
    expect(
      (await stream([...prefix, terminal('response.completed', 'cancelled')])).stopReason,
    ).toBe('error');
  });

  it('preserves a valid completed tool-only response without requiring assistant text', async () => {
    const tool = {
      type: 'function_call',
      id: 'fc_synthetic',
      call_id: 'call_synthetic',
      name: 'read',
      arguments: '{"path":"App.jsx"}',
    };
    const result = await stream([
      prefix[0],
      { type: 'response.output_item.added', output_index: 0, item: { ...tool, arguments: '' } },
      { type: 'response.output_item.done', output_index: 0, item: tool },
      { type: 'response.completed', response: { status: 'completed', output: [tool], usage } },
    ]);
    expect(result.stopReason).toBe('toolUse');
    expect(result.content).toMatchObject([
      { type: 'toolCall', name: 'read', arguments: { path: 'App.jsx' } },
    ]);
    expect(
      (
        await stream([
          prefix[0],
          { type: 'response.output_item.added', output_index: 0, item: { ...tool, arguments: '' } },
          { type: 'response.output_item.done', output_index: 0, item: tool },
        ])
      ).stopReason,
    ).toBe('error');
  });

  it('the app rejects partial output through its actual completion adapter without replay', async () => {
    const fetch = fixture(prefix);
    await expect(
      complete(
        { provider: 'synthetic-relay', modelId: 'synthetic-model' },
        [{ role: 'user', content: 'fixture' }],
        {
          apiKey: 'synthetic-test-key',
          baseUrl: 'https://synthetic-relay.example/v1',
          wire: 'openai-responses',
        },
      ),
    ).rejects.toThrow('stream ended before a terminal completion event');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    terminal('response.completed', 'completed'),
    terminal('response.done', 'completed'),
  ])('accepts normalized Codex completion frames', async (event) => {
    expect((await stream([...prefix, doneItem, event], { codex: true })).stopReason).toBe('stop');
  });

  it.each([
    terminal('response.incomplete', 'incomplete'),
    {
      type: 'response.incomplete',
      response: {
        id: 'synthetic-response',
        incomplete_details: { reason: 'max_output_tokens' },
        usage,
      },
    },
  ])('preserves incomplete Codex events through normalization', async (event) => {
    expect((await stream([...prefix, event], { codex: true })).stopReason).toBe('length');
  });

  it('rejects Codex EOF without any terminal completion event', async () => {
    expect((await stream([...prefix, doneItem], { codex: true })).stopReason).toBe('error');
  });
});
