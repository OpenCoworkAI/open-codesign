import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  getModel,
  type SimpleStreamOptions,
} from '@mariozechner/pi-ai';
import { describe, expect, it, vi } from 'vitest';
import {
  createNativeSearchStream,
  type NativeSearchOptions,
  type NativeSearchUpdate,
} from './native-search';

const message = (provider: 'openai' | 'anthropic'): AssistantMessage => ({
  role: 'assistant',
  content: [{ type: 'text', text: 'Answer' }],
  api: provider === 'openai' ? 'openai-responses' : 'anthropic-messages',
  provider,
  model: provider === 'openai' ? 'gpt-4.1' : 'claude-sonnet-4-6',
  timestamp: 1,
  stopReason: 'stop',
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
});

describe('native search pi adapter', () => {
  it('merges later citation ranges into previously saved search sources', async () => {
    const saveSources = vi.fn<NativeSearchOptions['saveSources']>(async () => {});
    const run = createNativeSearchStream(
      { provider: 'openai', maxRequests: 1, authorize: async () => {}, saveSources },
      (model, _context, options) => {
        const stream = createAssistantMessageEventStream();
        void (async () => {
          await options?.onPayload?.({}, model);
          const result = message('openai');
          await options?.onNativeEvent?.(
            {
              type: 'response.output_item.done',
              item: {
                type: 'web_search_call',
                id: 'search-1',
                action: {
                  type: 'search',
                  sources: [{ url: 'https://example.com/', title: 'Source' }],
                },
              },
            },
            result,
          );
          for (const end of [6, 10])
            await options?.onNativeEvent?.(
              {
                type: 'response.output_item.done',
                item: {
                  type: 'message',
                  content: [
                    {
                      type: 'output_text',
                      text: 'Answer',
                      annotations: [
                        {
                          type: 'url_citation',
                          url: 'https://example.com/',
                          start_index: 0,
                          end_index: end,
                        },
                      ],
                    },
                  ],
                },
              },
              result,
            );
          stream.push({ type: 'done', reason: 'stop', message: result });
          stream.end();
        })();
        return stream;
      },
    );
    await run(getModel('openai', 'gpt-4.1'), { messages: [] }).result();
    expect(saveSources.mock.calls.at(-1)?.[0]).toMatchObject([
      { callId: 'search-1', citations: [{ endIndex: 6 }, { endIndex: 10 }] },
    ]);
  });

  it('uses cumulative provider usage per request and keeps missing search usage unknown', async () => {
    const updates: NativeSearchUpdate[] = [];
    let attempt = 0;
    const run = createNativeSearchStream(
      {
        provider: 'anthropic',
        maxRequests: 3,
        authorize: async () => {},
        saveSources: async () => {},
        onUpdate: (update) => updates.push(update),
      },
      (model, _context, options) => {
        const stream = createAssistantMessageEventStream();
        void (async () => {
          await options?.onPayload?.({}, model);
          const result = message('anthropic');
          const current = ++attempt;
          await options?.onNativeEvent?.(
            {
              type: 'message_start',
              message: { usage: { server_tool_use: { web_search_requests: 0 } } },
            },
            result,
          );
          await options?.onNativeEvent?.(
            {
              type: 'content_block_start',
              index: 0,
              content_block: {
                type: 'server_tool_use',
                name: 'web_search',
                id: `search-${current}`,
              },
            },
            result,
          );
          if (current < 3) {
            await options?.onNativeEvent?.(
              {
                type: 'message_delta',
                delta: { stop_reason: 'end_turn' },
                usage: { server_tool_use: { web_search_requests: current === 1 ? 0 : 2 } },
              },
              result,
            );
          }
          if (current === 3)
            stream.push({
              type: 'error',
              reason: 'error',
              error: { ...result, stopReason: 'error', errorMessage: 'Connection error' },
            });
          else stream.push({ type: 'done', reason: 'stop', message: result });
          stream.end();
        })();
        return stream;
      },
    );
    for (const count of [0, 2, null]) {
      await run(getModel('anthropic', 'claude-sonnet-4-6'), { messages: [] }).result();
      expect(updates.at(-1)?.actualSearches).toBe(count);
      expect(updates.at(-1)?.searchCostUsd).toBeNull();
    }
  });

  it('retains a completed paused prefix when core retries a failed continuation', async () => {
    const contexts: unknown[] = [];
    let attempt = 0;
    const run = createNativeSearchStream(
      {
        provider: 'anthropic',
        maxRequests: 3,
        authorize: async () => {},
        saveSources: async () => {},
      },
      (model, context, options) => {
        contexts.push(structuredClone(context.messages));
        const stream = createAssistantMessageEventStream();
        void (async () => {
          await options?.onPayload?.({}, model);
          const current = ++attempt;
          const result = message('anthropic');
          if (current === 2) {
            stream.push({
              type: 'error',
              reason: 'error',
              error: { ...result, stopReason: 'error', errorMessage: 'Connection error' },
            });
          } else {
            await options?.onNativeEvent?.(
              {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: 'Answer' },
              },
              result,
            );
            await options?.onNativeEvent?.(
              {
                type: 'message_delta',
                delta: { stop_reason: current === 1 ? 'pause_turn' : 'end_turn' },
              },
              result,
            );
            stream.push({ type: 'done', reason: 'stop', message: result });
          }
          stream.end();
        })();
        return stream;
      },
    );
    const model = getModel('anthropic', 'claude-sonnet-4-6');
    const context = { messages: [] };
    expect((await run(model, context).result()).stopReason).toBe('error');
    const final = await run(model, structuredClone(context)).result();
    expect(contexts[2]).toEqual(contexts[1]);
    expect(final.usage.input).toBe(2);
    expect(final.nativeSearch?.output).toHaveLength(2);
  });

  it('continues from local materials after an explicit web permission denial', async () => {
    const authorize = vi.fn(async () => {
      throw new Error('Web research permission denied. Use local/saved materials only.');
    });
    const payloads: Array<Record<string, unknown>> = [];
    const run = createNativeSearchStream(
      { provider: 'openai', maxRequests: 1, authorize, saveSources: async () => {} },
      (model, _context, options) => {
        const output = createAssistantMessageEventStream();
        void (async () => {
          payloads.push(
            (await options?.onPayload?.({ tools: [] }, model)) as Record<string, unknown>,
          );
          output.push({ type: 'done', reason: 'stop', message: message('openai') });
          output.end();
        })();
        return output;
      },
    );
    expect(
      (await run(getModel('openai', 'gpt-4.1'), { messages: [] }, {}).result()).stopReason,
    ).toBe('stop');
    await run(getModel('openai', 'gpt-4.1'), { messages: [] }, {}).result();
    expect(authorize).toHaveBeenCalledOnce();
    expect(payloads[0]?.['tools']).toEqual([]);
    expect(payloads[0]?.['instructions']).toContain('Web access was denied');
  });
  it('authorizes before enabling tools, saves citations and removes search after request budget', async () => {
    const order: string[] = [];
    const requests: Record<string, unknown>[] = [];
    const run = createNativeSearchStream(
      {
        provider: 'openai',
        maxRequests: 1,
        authorize: async () => {
          order.push('authorize');
        },
        saveSources: async (sources) => {
          expect(sources[0]?.url).toBe('https://example.com/');
          order.push('save');
        },
      },
      (_model, _context, options) => {
        const stream = createAssistantMessageEventStream();
        void (async () => {
          const payload = (await options?.onPayload?.(
            { tools: [{ type: 'function', name: 'preview' }] },
            getModel('openai', 'gpt-4.1'),
          )) as Record<string, unknown>;
          requests.push(payload);
          order.push('request');
          const result = message('openai');
          await options?.onNativeEvent?.(
            {
              type: 'response.output_item.done',
              item: {
                type: 'message',
                id: 'msg',
                role: 'assistant',
                content: [
                  {
                    type: 'output_text',
                    text: 'Answer',
                    annotations: [
                      {
                        type: 'url_citation',
                        url: 'https://example.com/',
                        title: 'Source',
                        start_index: 0,
                        end_index: 6,
                      },
                    ],
                  },
                ],
              },
            },
            result,
          );
          stream.push({ type: 'done', reason: 'stop', message: result });
          stream.end();
        })();
        return stream;
      },
    );
    const model = getModel('openai', 'gpt-4.1');
    const context = { messages: [] };
    const result = await run(model, context, {}).result();
    expect(order).toEqual(['authorize', 'request', 'save']);
    expect(requests[0]?.['tools']).toContainEqual({ type: 'web_search' });
    expect(requests[0]?.['max_tool_calls']).toBe(5);
    expect(result.content[0]).toMatchObject({ text: 'Answer[Source](https://example.com/)' });
    await run(model, context, {}).result();
    expect(requests[1]?.['tools']).not.toContainEqual({ type: 'web_search' });
  });
  it('continues Claude pause_turn with original server blocks and counts each enabled request', async () => {
    const contexts: unknown[] = [];
    let calls = 0;
    const persistMessage = vi.fn();
    const run = createNativeSearchStream(
      {
        provider: 'anthropic',
        maxRequests: 2,
        authorize: async () => {},
        saveSources: async () => {},
        persistMessage,
      },
      (model, context, options) => {
        contexts.push(structuredClone(context.messages));
        const stream = createAssistantMessageEventStream();
        const current = ++calls;
        void (async () => {
          await options?.onPayload?.({ tools: [] }, model);
          const result = message('anthropic');
          await options?.onNativeEvent?.(
            {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: 'Answer' },
            },
            result,
          );
          await options?.onNativeEvent?.(
            {
              type: 'message_delta',
              delta: { stop_reason: current === 1 ? 'pause_turn' : 'end_turn' },
            },
            result,
          );
          stream.push({ type: 'done', reason: 'stop', message: result });
          stream.end();
        })();
        return stream;
      },
    );
    const result = await run(
      getModel('anthropic', 'claude-sonnet-4-6'),
      { messages: [] },
      {},
    ).result();
    expect(calls).toBe(2);
    expect(contexts[1]).toMatchObject([
      {
        role: 'assistant',
        nativeSearch: {
          provider: 'anthropic',
          output: [{ type: 'text', text: 'Answer' }],
          paused: true,
        },
      },
    ]);
    expect(result.nativeSearch?.paused).toBe(false);
    expect(persistMessage).toHaveBeenCalledTimes(2);
    expect(result.usage.input).toBe(2);
  });
  it('never sends a request when authorization is denied', async () => {
    const run = createNativeSearchStream(
      {
        provider: 'openai',
        maxRequests: 1,
        authorize: async () => {
          throw new Error('denied');
        },
        saveSources: async () => {},
      },
      (_model, _context, options) => {
        const stream = createAssistantMessageEventStream();
        void (async () => {
          try {
            await options?.onPayload?.({}, getModel('openai', 'gpt-4.1'));
          } catch {
            stream.push({
              type: 'error',
              reason: 'error',
              error: { ...message('openai'), stopReason: 'error', errorMessage: 'denied' },
            });
            stream.end();
          }
        })();
        return stream;
      },
    );
    expect(
      (
        await run(
          getModel('openai', 'gpt-4.1'),
          { messages: [] },
          {} as SimpleStreamOptions,
        ).result()
      ).errorMessage,
    ).toBe('denied');
  });
});
