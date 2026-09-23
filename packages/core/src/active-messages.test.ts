import { Agent, type AgentMessage } from '@mariozechner/pi-agent-core';
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  getModel,
} from '@mariozechner/pi-ai';
import type { ActiveRunMessageInputV1, ActiveRunMessageV1 } from '@open-codesign/shared';
import { Type } from '@sinclair/typebox';
import { describe, expect, it, vi } from 'vitest';
import { ActiveRunMessages } from './active-messages';

const model = getModel('openai', 'gpt-4o-mini');
const input = (
  messageId: string,
  mode: 'follow-up' | 'steer' = 'follow-up',
): ActiveRunMessageInputV1 => ({
  schemaVersion: 1,
  designId: 'design',
  generationId: 'run',
  messageId,
  mode,
  text: messageId,
});
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function response(content: AssistantMessage['content'], stopReason: 'stop' | 'toolUse' = 'stop') {
  const stream = createAssistantMessageEventStream();
  stream.push({
    type: 'done',
    reason: stopReason,
    message: {
      role: 'assistant',
      content,
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason,
      timestamp: Date.now(),
    },
  });
  return stream;
}
const userTexts = (messages: AgentMessage[]) =>
  messages
    .filter((m) => m.role === 'user')
    .map((m) =>
      m.role === 'user' && typeof m.content !== 'string'
        ? m.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('')
        : m.content,
    );

describe('native pi active message delivery', () => {
  it.each([
    'write',
    'ask',
    'permission',
  ])('steers only after the full %s tool batch and follows up after the agent would stop', async (toolName) => {
    const changes: ActiveRunMessageV1[] = [];
    const receipts = new ActiveRunMessages('design', 'run', (row) => changes.push(row));
    const entered = deferred(),
      release = deferred();
    const order: string[] = [];
    const contexts: unknown[][] = [];
    let calls = 0;
    const agent = new Agent({
      initialState: {
        model,
        tools: [
          {
            name: toolName,
            label: 'Gated tool',
            description: 'Gated deterministic tool',
            parameters: Type.Object({}),
            execute: async (id) => {
              order.push(id);
              if (id === 'one') {
                entered.resolve();
                await release.promise;
              }
              return { content: [{ type: 'text', text: 'written' }], details: {} };
            },
          },
        ],
      },
      streamFn: async (_model, context) => {
        contexts.push(userTexts(context.messages));
        calls += 1;
        if (calls === 1)
          return response(
            [
              { type: 'toolCall', id: 'one', name: toolName, arguments: {} },
              { type: 'toolCall', id: 'two', name: toolName, arguments: {} },
            ],
            'toolUse',
          );
        return response([{ type: 'text', text: 'finished' }]);
      },
    });
    receipts.bind(agent);
    agent.subscribe((e) =>
      receipts.handleEvent(e, () => {
        order.push('delivered');
      }),
    );
    const running = agent.prompt('initial');
    await entered.promise;
    receipts.submit(input('later'));
    receipts.submit(input('redirect', 'steer'));
    receipts.submit(input('last'));
    expect(changes.map((r) => r.status)).toEqual(['pending', 'pending', 'pending']);
    expect(order).toEqual(['one', 'two']);
    release.resolve();
    await running;
    expect(order).toEqual(['one', 'two', 'delivered', 'delivered', 'delivered']);
    expect(contexts).toEqual([
      ['initial'],
      ['initial', 'redirect'],
      ['initial', 'redirect', 'later'],
      ['initial', 'redirect', 'later', 'last'],
    ]);
    expect(changes.filter((r) => r.status === 'delivered').map((r) => r.messageId)).toEqual([
      'redirect',
      'later',
      'last',
    ]);
    expect(() => receipts.submit(input('late'))).toThrow(/not accepting/);
  });

  it('deduplicates admissions, isolates runs and preserves undelivered text on cancellation', async () => {
    const controller = new AbortController();
    const change = vi.fn();
    const receipts = new ActiveRunMessages('design', 'run', change, controller.signal);
    expect(() => receipts.submit(input('not-ready'))).toThrow(/not accepting/);
    const agent = new Agent({ initialState: { model } });
    receipts.bind(agent);
    expect(receipts.submit(input('one')).status).toBe('pending');
    expect(receipts.submit(input('one')).status).toBe('pending');
    expect(change).toHaveBeenCalledTimes(1);
    expect(() => receipts.submit({ ...input('one'), text: 'different' })).toThrow(
      /different content/,
    );
    expect(() => receipts.submit({ ...input('two'), designId: 'other' })).toThrow(/changed/);
    controller.abort();
    expect(() => receipts.submit(input('two'))).toThrow(/not accepting/);
    receipts.close();
    expect(agent.hasQueuedMessages()).toBe(false);
    expect(change.mock.calls.at(-1)?.[0]).toMatchObject({
      messageId: 'one',
      status: 'not-delivered',
      text: 'one',
    });
  });

  it('rebinds pending native queues across fallback without replaying delivered messages', async () => {
    const change = vi.fn();
    const receipts = new ActiveRunMessages('design', 'run', change);
    const first = new Agent({ initialState: { model } });
    receipts.bind(first);
    receipts.submit(input('delivered'));
    const previouslyDelivered = {
      role: 'user' as const,
      content: 'delivered',
      timestamp: Date.now(),
      codesignMessageId: 'delivered',
    };
    receipts.handleEvent({ type: 'message_start', message: previouslyDelivered }, () => {});
    receipts.submit(input('pending'));
    receipts.handleEvent({ type: 'agent_end', messages: [] }, () => {});
    const second = new Agent({
      initialState: { model },
      streamFn: () => response([{ type: 'text', text: 'ok' }]),
    });
    receipts.bind(second);
    const delivered = vi.fn();
    second.subscribe((e) => receipts.handleEvent(e, delivered));
    await second.prompt('initial');
    expect(first.hasQueuedMessages()).toBe(false);
    expect(delivered).toHaveBeenCalledTimes(1);
    expect(change.mock.calls.map((c) => c[0].status)).toEqual([
      'pending',
      'delivered',
      'pending',
      'delivered',
    ]);
    expect(userTexts(second.state.messages)).toEqual(['initial', 'pending']);
    receipts.close();
  });

  it('does not acknowledge or enqueue when durable acceptance fails', () => {
    const receipts = new ActiveRunMessages('design', 'run', () => {
      throw new Error('disk full');
    });
    const agent = new Agent({ initialState: { model } });
    receipts.bind(agent);
    expect(() => receipts.submit(input('one'))).toThrow('disk full');
    expect(agent.hasQueuedMessages()).toBe(false);
  });
});
