import { setTimeout as delay } from 'node:timers/promises';
import {
  type Api,
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  getApiProviders,
  type Model,
  registerApiProvider,
  type SimpleStreamOptions,
  type StreamFunction,
} from '@mariozechner/pi-ai';
import type { DebugModelEvidence } from './contract';

const DESIGN = `---
version: alpha
name: Background verification
colors:
  primary: "#111111"
typography:
  body:
    fontFamily: Arial
    fontSize: 16px
    fontWeight: 400
rounded:
  sm: 4px
spacing:
  sm: 8px
---

## Overview
A synthetic background verification design.
`;
export const FIXTURE_SOURCE = `function App() { return <main style={{padding: 48, fontFamily: 'Arial'}}><h1>Background model verified</h1><p>Created by the real design runtime.</p><button onClick={e => e.currentTarget.textContent = 'Clicked'}>Try it</button></main>; }
ReactDOM.createRoot(document.getElementById('root')).render(<App />);`;

function message(model: Model<Api>, content: AssistantMessage['content'] = []): AssistantMessage {
  return {
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    timestamp: Date.now(),
    content,
    stopReason: content.some((part) => part.type === 'toolCall') ? 'toolUse' : 'stop',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

function textOf(content: Context['messages'][number]['content']): string {
  return typeof content === 'string'
    ? content
    : content.map((part) => ('text' in part ? part.text : '')).join('\n');
}

export const fixtureStream: StreamFunction<Api, SimpleStreamOptions> = (
  model,
  context,
  options,
) => {
  const stream = createAssistantMessageEventStream();
  void (async () => {
    try {
      await delay(100, undefined, options?.signal ? { signal: options.signal } : {});
      if (!context.tools?.length) {
        const text = context.systemPrompt?.includes('route Open CoDesign')
          ? JSON.stringify({
              preferences: { tweaks: 'no', bitmapAssets: 'no', reusableSystem: 'no' },
            })
          : 'Background verification';
        const result = message(model, [{ type: 'text', text }]);
        stream.push({ type: 'done', reason: 'stop', message: result });
        return;
      }
      const turnStart = context.messages.findLastIndex(
        (entry) => entry.role === 'user' && textOf(entry.content).includes('User request:'),
      );
      const turn = context.messages.slice(Math.max(0, turnStart));
      const prompt = turn.find((entry) => entry.role === 'user');
      const request = prompt ? (textOf(prompt.content).split('User request:').at(-1) ?? '') : '';
      if (request.trimStart().startsWith('[fixture:error]'))
        throw new Error('Controlled model failure');
      if (request.trimStart().startsWith('[fixture:wait]'))
        await delay(120_000, undefined, options?.signal ? { signal: options.signal } : {});
      const calls = turn.flatMap((entry) =>
        entry.role === 'assistant' ? entry.content.filter((part) => part.type === 'toolCall') : [],
      );
      const plan: { name: string; args: Record<string, unknown> }[] = [
        {
          name: 'set_todos',
          args: { items: [{ text: 'Create and verify design', checked: false }] },
        },
        ...(request.trimStart().startsWith('[fixture:ask]')
          ? [
              {
                name: 'ask',
                args: {
                  questions: [
                    { id: 'fact', type: 'freeform', prompt: 'What should the test record?' },
                  ],
                },
              },
            ]
          : []),
        {
          name: 'str_replace_based_edit_tool',
          args: { command: 'create', path: 'DESIGN.md', file_text: DESIGN },
        },
        {
          name: 'str_replace_based_edit_tool',
          args: { command: 'create', path: 'App.jsx', file_text: FIXTURE_SOURCE },
        },
        { name: 'preview', args: { path: 'App.jsx' } },
        { name: 'done', args: { path: 'App.jsx' } },
      ];
      const step = plan[calls.length];
      const content: AssistantMessage['content'] = step
        ? [
            {
              type: 'toolCall',
              id: `background-fixture-${calls.length}-${context.messages.length}`,
              name: step.name,
              arguments: step.args,
            },
          ]
        : [{ type: 'text', text: 'Background model verification complete.' }];
      const result = message(model, content);
      if (!step) {
        const partial = message(model, [
          { type: 'text', text: 'Background model verification complete.' },
        ]);
        stream.push({ type: 'start', partial });
        stream.push({ type: 'text_start', contentIndex: 0, partial });
        stream.push({
          type: 'text_delta',
          contentIndex: 0,
          delta: 'Background model verification complete.',
          partial,
        });
        stream.push({
          type: 'text_end',
          contentIndex: 0,
          content: 'Background model verification complete.',
          partial,
        });
      }
      stream.push({ type: 'done', reason: step ? 'toolUse' : 'stop', message: result });
    } catch (error) {
      const result = message(model);
      result.stopReason = options?.signal?.aborted ? 'aborted' : 'error';
      result.errorMessage = options?.signal?.aborted
        ? 'Controlled model cancelled'
        : error instanceof Error
          ? error.message
          : 'Controlled model failed';
      stream.push({ type: 'error', reason: result.stopReason, error: result });
    }
  })();
  return stream;
};

/** Installed only in the disposable host. All pi callers (including title/router) share limits. */
export function installDebugModelBoundary(options: {
  mode: 'fixture' | 'live';
  provider: string;
  model: string;
  secrets: string[];
  record: (evidence: DebugModelEvidence) => void;
  timeoutMs?: number;
  maxCalls?: number;
}) {
  const lifetime = new AbortController();
  const pending = new Set<Promise<void>>();
  const evidence: DebugModelEvidence = {
    mode: options.mode,
    calls: 0,
    active: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    maxCalls: options.maxCalls ?? 24,
    maxOutputTokens: 4096,
    events: [],
  };
  const redact = <T>(value: T): T =>
    JSON.parse(
      JSON.stringify(value, (_key, data: unknown) => {
        if (typeof data !== 'string') return data;
        for (const secret of options.secrets)
          if (secret) data = (data as string).split(secret).join('[REDACTED]');
        return data;
      }),
    ) as T;
  const original = getApiProviders();
  for (const provider of original) {
    const wrap =
      (inner: StreamFunction<Api, SimpleStreamOptions>): StreamFunction<Api, SimpleStreamOptions> =>
      (model, context, input = {}) => {
        if (lifetime.signal.aborted) throw new Error('BACKGROUND_MODEL_CLOSED');
        if (model.provider !== options.provider || model.id !== options.model)
          throw new Error('BACKGROUND_MODEL_SELECTION_DENIED');
        if (evidence.calls >= evidence.maxCalls) throw new Error('BACKGROUND_MODEL_CALL_LIMIT');
        const call = ++evidence.calls;
        const event = {
          call,
          status: 'running',
          historyMessages: context.messages.length,
          tools: Boolean(context.tools?.length),
        };
        evidence.events.push(event);
        evidence.active++;
        options.record(evidence);
        const stream = createAssistantMessageEventStream();
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(new Error('BACKGROUND_MODEL_TIMEOUT')),
          options.timeoutMs ?? 60_000,
        );
        const signal = AbortSignal.any([
          lifetime.signal,
          controller.signal,
          ...(input.signal ? [input.signal] : []),
        ]);
        let rejectAbort: (reason?: unknown) => void = () => {};
        const aborted = new Promise<never>((_resolve, reject) => {
          rejectAbort = reject;
        });
        const onAbort = () => rejectAbort(new Error('BACKGROUND_MODEL_CANCELLED'));
        signal.addEventListener('abort', onAbort, { once: true });
        const work = (async () => {
          try {
            signal.throwIfAborted();
            const source = (options.mode === 'fixture' ? fixtureStream : inner)(model, context, {
              ...input,
              signal,
              maxTokens: Math.min(input.maxTokens ?? 4096, 4096),
            });
            const iterator = source[Symbol.asyncIterator]();
            for (;;) {
              const item = await Promise.race([iterator.next(), aborted]);
              if (item.done) break;
              const clean = redact(item.value);
              if (clean.type === 'done') event.status = 'completed';
              if (clean.type === 'error')
                event.status = clean.reason === 'aborted' ? 'cancelled' : 'failed';
              stream.push(clean);
            }
            if (event.status === 'running')
              throw new Error('Background model stream ended without a terminal event');
          } catch (error) {
            const result = message(model);
            result.stopReason = signal.aborted ? 'aborted' : 'error';
            result.errorMessage = redact(
              signal.aborted
                ? 'Background model call cancelled or timed out'
                : error instanceof Error
                  ? error.message
                  : 'Background model call failed',
            );
            event.status = signal.aborted ? 'cancelled' : 'failed';
            stream.push({ type: 'error', reason: result.stopReason, error: result });
          } finally {
            signal.removeEventListener('abort', onAbort);
            clearTimeout(timer);
            evidence.active--;
            if (event.status === 'completed') evidence.completed++;
            else if (event.status === 'cancelled') evidence.cancelled++;
            else evidence.failed++;
            options.record(evidence);
          }
        })();
        pending.add(work);
        void work.finally(() => pending.delete(work));
        return stream;
      };
    registerApiProvider({
      api: provider.api,
      stream: wrap(provider.stream),
      streamSimple: wrap(provider.streamSimple),
    });
  }
  options.record(evidence);
  return {
    evidence,
    async stop() {
      lifetime.abort();
      await Promise.allSettled([...pending]);
    },
    restore() {
      for (const provider of original) registerApiProvider(provider);
    },
  };
}
