import {
  type AssistantMessage,
  getModel,
  type SimpleStreamOptions,
  streamSimple,
} from '@mariozechner/pi-ai';
import { afterEach, expect, it, vi } from 'vitest';
import { createNativeSearchStream } from './native-search';

afterEach(() => vi.unstubAllGlobals());

it('continues actual Claude SSE with intact server blocks and citations', async () => {
  const resultBlock = {
    type: 'web_search_tool_result',
    tool_use_id: 'srv_1',
    content: [
      {
        type: 'web_search_result',
        url: 'https://example.com/',
        title: 'Source',
        encrypted_content: 'opaque',
      },
    ],
  };
  const response = (paused: boolean) => [
    {
      type: 'message_start',
      message: {
        id: paused ? 'm1' : 'm2',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 3, output_tokens: 0 },
      },
    },
    ...(paused
      ? [
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: {} },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"query":"query"}' },
          },
          { type: 'content_block_stop', index: 0 },
          { type: 'content_block_start', index: 1, content_block: resultBlock },
          { type: 'content_block_stop', index: 1 },
        ]
      : [
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Answer' } },
          {
            type: 'content_block_delta',
            index: 0,
            delta: {
              type: 'citations_delta',
              citation: {
                type: 'web_search_result_location',
                url: 'https://example.com/',
                title: 'Source',
                cited_text: 'evidence',
                encrypted_index: 'opaque-index',
              },
            },
          },
          { type: 'content_block_stop', index: 0 },
        ]),
    {
      type: 'message_delta',
      delta: { stop_reason: paused ? 'pause_turn' : 'end_turn' },
      usage: { output_tokens: 2 },
    },
    { type: 'message_stop' },
  ];
  const requests: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, options: RequestInit) => {
      requests.push(JSON.parse(String(options.body)) as Record<string, unknown>);
      const events = response(requests.length === 1);
      return new Response(
        events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }),
  );
  const run = createNativeSearchStream({
    provider: 'anthropic',
    maxRequests: 2,
    authorize: async () => {},
    saveSources: async () => {},
  });
  const result = await run(
    getModel('anthropic', 'claude-sonnet-4-6'),
    { messages: [{ role: 'user', content: 'query', timestamp: 1 }] },
    { apiKey: 'synthetic-fixture' },
  ).result();
  expect(result.stopReason).toBe('stop');
  expect(requests).toHaveLength(2);
  expect(requests[1]?.['messages']).toMatchObject([
    { role: 'user' },
    {
      role: 'assistant',
      content: [{ type: 'server_tool_use', input: { query: 'query' } }, resultBlock],
    },
  ]);
  expect(result.content[0]).toMatchObject({ text: 'Answer[Source](https://example.com/)' });
  expect(result.usage.input).toBe(6);
});

it('pi exposes raw Responses search and citation events before consuming the body', async () => {
  const item = {
    type: 'message',
    id: 'msg_1',
    role: 'assistant',
    status: 'completed',
    content: [
      {
        type: 'output_text',
        text: 'Answer',
        annotations: [
          {
            type: 'url_citation',
            url: 'https://example.com',
            title: 'Source',
            start_index: 0,
            end_index: 6,
          },
        ],
      },
    ],
  };
  const events = [
    { type: 'response.created', response: { id: 'resp_1' } },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'web_search_call', id: 'ws_1', status: 'in_progress' },
    },
    {
      type: 'response.output_item.done',
      output_index: 0,
      item: {
        type: 'web_search_call',
        id: 'ws_1',
        status: 'completed',
        action: { type: 'search', query: 'test' },
      },
    },
    { type: 'response.output_item.added', output_index: 1, item: { ...item, content: [] } },
    {
      type: 'response.content_part.added',
      output_index: 1,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
    },
    { type: 'response.output_text.delta', output_index: 1, content_index: 0, delta: 'Answer' },
    { type: 'response.output_item.done', output_index: 1, item },
    {
      type: 'response.completed',
      response: {
        id: 'resp_1',
        status: 'completed',
        usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
        output: [item],
      },
    },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          events
            .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
            .join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    ),
  );
  const seen: unknown[] = [];
  const options: SimpleStreamOptions & {
    onNativeEvent: (event: unknown, output: AssistantMessage) => Promise<void>;
  } = {
    apiKey: 'synthetic-fixture',
    maxRetries: 0,
    onNativeEvent: async (event) => {
      seen.push(structuredClone(event));
    },
  };
  const model = getModel('openai', 'gpt-4.1');
  const result = await streamSimple(
    model,
    { messages: [{ role: 'user', content: 'test', timestamp: 1 }] },
    options,
  ).result();
  expect(result.stopReason).toBe('stop');
  expect(seen).toEqual(events);
});

it.each([
  'pause_turn',
  'tool_use',
] as const)('stops a pending Claude search at the request budget after %s', async (stopReason) => {
  const requests: Array<Record<string, unknown>> = [];
  const persisted: AssistantMessage[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, options: RequestInit) => {
      requests.push(JSON.parse(String(options.body)) as Record<string, unknown>);
      const first = requests.length === 1;
      const events = [
        {
          type: 'message_start',
          message: {
            id: `msg_${requests.length}`,
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 3, output_tokens: 0 },
          },
        },
        ...(first
          ? [
              {
                type: 'content_block_start',
                index: 0,
                content_block: {
                  type: 'server_tool_use',
                  id: 'srvtoolu_pending',
                  name: 'web_search',
                  input: {},
                },
              },
              {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'input_json_delta', partial_json: '{"query":"test"}' },
              },
              { type: 'content_block_stop', index: 0 },
              ...(stopReason === 'tool_use'
                ? [
                    {
                      type: 'content_block_start',
                      index: 1,
                      content_block: {
                        type: 'tool_use',
                        id: 'local_1',
                        name: 'preview',
                        input: {},
                      },
                    },
                    { type: 'content_block_stop', index: 1 },
                  ]
                : []),
            ]
          : [
              { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
              {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: 'Ready' },
              },
              { type: 'content_block_stop', index: 0 },
            ]),
        {
          type: 'message_delta',
          delta: { stop_reason: first ? stopReason : 'end_turn' },
          usage: { output_tokens: 2 },
        },
        { type: 'message_stop' },
      ];
      return new Response(
        events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }),
  );
  const run = createNativeSearchStream({
    provider: 'anthropic',
    maxRequests: 1,
    authorize: async () => {},
    saveSources: async () => {},
    persistMessage: (message) => {
      persisted.push(structuredClone(message));
    },
  });
  const model = getModel('anthropic', 'claude-sonnet-4-6');
  const prompt = { role: 'user' as const, content: 'Search', timestamp: 1 };
  const first = await run(model, { messages: [prompt] }, { apiKey: 'synthetic-fixture' }).result();
  const final =
    stopReason === 'pause_turn'
      ? first
      : await run(
          model,
          {
            messages: [
              prompt,
              first,
              {
                role: 'toolResult',
                toolCallId: 'local_1',
                toolName: 'preview',
                content: [{ type: 'text', text: 'OK' }],
                isError: false,
                timestamp: 2,
              },
            ],
          },
          { apiKey: 'synthetic-fixture' },
        ).result();
  expect(requests).toHaveLength(1);
  expect(final.stopReason).toBe('error');
  expect(final.errorMessage).toMatch(/native search.*budget.*exhausted/i);
  expect(persisted[0]?.nativeSearch?.output).toContainEqual({
    type: 'server_tool_use',
    id: 'srvtoolu_pending',
    name: 'web_search',
    input: { query: 'test' },
  });
});

it('allows local inference after a pending Claude search is resolved in a later message', async () => {
  const requests: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, options: RequestInit) => {
      requests.push(JSON.parse(String(options.body)) as Record<string, unknown>);
      const request = requests.length;
      const blocks =
        request === 1
          ? [
              {
                type: 'server_tool_use',
                id: 'srvtoolu_deferred',
                name: 'web_search',
                input: { query: 'test' },
              },
              { type: 'tool_use', id: 'local_1', name: 'preview', input: {} },
            ]
          : request === 2
            ? [
                { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_deferred', content: [] },
                { type: 'text', text: '' },
              ]
            : [{ type: 'text', text: '' }];
      const events = [
        {
          type: 'message_start',
          message: {
            id: `msg_${request}`,
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 3, output_tokens: 0 },
          },
        },
        ...blocks.flatMap((block, index) => [
          { type: 'content_block_start', index, content_block: block },
          ...(block.type === 'text'
            ? [{ type: 'content_block_delta', index, delta: { type: 'text_delta', text: 'Ready' } }]
            : []),
          { type: 'content_block_stop', index },
        ]),
        {
          type: 'message_delta',
          delta: { stop_reason: request === 1 ? 'tool_use' : 'end_turn' },
          usage: { output_tokens: 2 },
        },
        { type: 'message_stop' },
      ];
      return new Response(
        events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }),
  );
  const run = createNativeSearchStream({
    provider: 'anthropic',
    maxRequests: 2,
    authorize: async () => {},
    saveSources: async () => {},
  });
  const model = getModel('anthropic', 'claude-sonnet-4-6');
  const prompt = { role: 'user' as const, content: 'Search', timestamp: 1 };
  const first = await run(model, { messages: [prompt] }, { apiKey: 'synthetic-fixture' }).result();
  const toolResult = {
    role: 'toolResult' as const,
    toolCallId: 'local_1',
    toolName: 'preview',
    content: [{ type: 'text' as const, text: 'OK' }],
    isError: false,
    timestamp: 2,
  };
  const second = await run(
    model,
    { messages: [prompt, first, toolResult] },
    { apiKey: 'synthetic-fixture' },
  ).result();
  expect(second.stopReason).toBe('stop');
  const final = await run(
    model,
    {
      messages: [
        prompt,
        first,
        toolResult,
        second,
        { role: 'user', content: 'Continue locally', timestamp: 3 },
      ],
    },
    { apiKey: 'synthetic-fixture' },
  ).result();
  expect(final.stopReason).toBe('stop');
  expect(requests).toHaveLength(3);
  expect(requests[2]?.['tools']).toEqual([]);
});
