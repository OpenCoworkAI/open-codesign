import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agent, AgentMessage, AgentOptions, StreamFn } from '@mariozechner/pi-agent-core';
import { type AssistantMessage, createAssistantMessageEventStream } from '@mariozechner/pi-ai';
import type { ActiveRunMessageV1 } from '@open-codesign/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveRunMessages } from './active-messages';
import { generateViaAgent } from './agent';
import type { GenerateInput } from './index';
import type { AskResult } from './tools/ask';
import type { DoneDetails } from './tools/done';
import type { RunPreviewFn } from './tools/preview';
import type { TextEditorFsCallbacks } from './tools/text-editor';

const native = vi.hoisted(() => ({ stream: vi.fn<StreamFn>(), agents: [] as Agent[] }));

// Substitute only pi's streaming boundary; Agent scheduling, tools and recovery are real.
vi.mock('@mariozechner/pi-agent-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mariozechner/pi-agent-core')>();
  return {
    ...actual,
    Agent: class extends actual.Agent {
      constructor(options: AgentOptions) {
        super({ ...options, streamFn: native.stream });
        native.agents.push(this);
      }
    },
  };
});

const DESIGN = `---
version: alpha
name: Test design
colors:
  primary: "#111111"
typography:
  body:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
rounded:
  sm: 4px
spacing:
  sm: 8px
---

## Overview

An isolated integration fixture.
`;
const SOURCE = `function App() { return <main><h1>First design</h1></main>; }
ReactDOM.createRoot(document.getElementById('root')).render(<App />);`;
const input: GenerateInput = {
  prompt: 'Build a design',
  history: [],
  model: { provider: 'openai', modelId: 'gpt-5' },
  apiKey: 'synthetic-only',
  systemPrompt: 'Use the design tools, then summarize.',
};
type Call = Extract<AssistantMessage['content'][number], { type: 'toolCall' }>;
const call = (name: string, args: Record<string, unknown>, id = name): Call => ({
  type: 'toolCall',
  name,
  arguments: args,
  id,
});
const todos = () => call('set_todos', { items: [{ text: 'Complete design', checked: false }] });
const create = (path: string, text: string) =>
  call(
    'str_replace_based_edit_tool',
    { command: 'create', path, file_text: text },
    `create-${path}`,
  );
const done = () => call('done', { path: 'App.jsx' });
const ask = () =>
  call('ask', { questions: [{ id: 'q', type: 'freeform', prompt: 'Required fact?' }] });

function response(
  model: Parameters<StreamFn>[0],
  content: AssistantMessage['content'],
  error?: string,
) {
  const message: AssistantMessage = {
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    content,
    timestamp: Date.now(),
    stopReason: error
      ? 'error'
      : content.some((part) => part.type === 'toolCall')
        ? 'toolUse'
        : 'stop',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    ...(error ? { errorMessage: error } : {}),
  };
  const stream = createAssistantMessageEventStream();
  if (message.stopReason === 'error' || message.stopReason === 'aborted')
    stream.push({ type: 'error', reason: message.stopReason, error: message });
  else stream.push({ type: 'done', reason: message.stopReason, message });
  return stream;
}

function script(batches: Array<Call[] | string>) {
  native.stream.mockImplementation((model) => {
    const batch = batches.shift();
    if (batch === undefined) throw new Error('Unexpected extra provider call');
    return response(model, typeof batch === 'string' ? [{ type: 'text', text: batch }] : batch);
  });
}

let root: string;
let fs: TextEditorFsCallbacks;
let writes: string[];
beforeEach(() => {
  native.stream.mockReset();
  native.agents.length = 0;
  root = mkdtempSync(join(tmpdir(), 'codesign-native-lifecycle-'));
  writes = [];
  fs = {
    view(path) {
      if (!readdirSync(root).includes(path)) return null;
      const content = readFileSync(join(root, path), 'utf8');
      return { content, numLines: content.split('\n').length };
    },
    listDir: () => readdirSync(root),
    create(path, content) {
      writeFileSync(join(root, path), content);
      writes.push(path);
      return { path };
    },
    strReplace(path, oldStr, newStr) {
      const current = readFileSync(join(root, path), 'utf8');
      if (!current.includes(oldStr)) throw new Error('Missing exact edit target');
      writeFileSync(join(root, path), current.replace(oldStr, newStr));
      writes.push(path);
      return { path };
    },
    insert() {
      throw new Error('Unexpected insert');
    },
  };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function seed() {
  writeFileSync(join(root, 'App.jsx'), SOURCE);
  writeFileSync(join(root, 'DESIGN.md'), DESIGN);
}

describe('production generateViaAgent with installed pi', () => {
  it('does not enter the model when cancellation arrives during async key resolution', async () => {
    const controller = new AbortController();
    let releaseKey!: (key: string) => void;
    const getApiKey = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          releaseKey = resolve;
        }),
    );
    const running = generateViaAgent({ ...input, signal: controller.signal, getApiKey }, { fs });
    const rejected = expect(running).rejects.toMatchObject({ code: 'PROVIDER_ABORTED' });
    await vi.waitFor(() => expect(getApiKey).toHaveBeenCalledOnce());
    controller.abort();
    releaseKey('synthetic-only');
    await rejected;
    expect(native.stream).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('writes -> previews -> verifies, then revises the same workspace with history exactly once after transport recovery', async () => {
    // Browser executor substitution only: production preview/done validate and pass real source.
    const preview = vi.fn<RunPreviewFn>(async (options) => {
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(options.signal?.aborted).toBe(false);
      expect(readFileSync(join(root, options.path), 'utf8')).toContain('function App()');
      return {
        ok: true,
        consoleErrors: [],
        assetErrors: [],
        metrics: { nodes: 3, width: 1280, height: 800, loadMs: 1 },
      };
    });
    const verify = vi.fn(
      async (source: string, context?: { path: string; signal?: AbortSignal }) => {
        expect(context?.signal).toBeInstanceOf(AbortSignal);
        expect(source).toBe(readFileSync(join(root, 'App.jsx'), 'utf8'));
        return [];
      },
    );
    const checks: DoneDetails[] = [];
    const onEvent: NonNullable<Parameters<typeof generateViaAgent>[1]>['onEvent'] = (event) => {
      if (event.type === 'tool_execution_end') {
        expect(event.isError).toBe(false);
        if (event.toolName === 'done') checks.push(event.result.details as DoneDetails);
      }
    };
    script([
      [todos()],
      [create('DESIGN.md', DESIGN), create('App.jsx', SOURCE)],
      [call('preview', { path: 'App.jsx' })],
      [done()],
      'First completed',
    ]);
    const first = await generateViaAgent(
      { ...input, runPreview: preview },
      { fs, runtimeVerify: verify, onEvent },
    );
    expect(first.artifacts).toHaveLength(1);
    expect(first.resourceState?.lastDone?.status).toBe('ok');
    const contexts: AgentMessage[][] = [];
    let index = 0;
    native.stream.mockImplementation((model, context) => {
      contexts.push([...context.messages]);
      const batches = [
        [todos()],
        [call('str_replace_based_edit_tool', { command: 'view', path: 'App.jsx' })],
        [
          call('str_replace_based_edit_tool', {
            command: 'str_replace',
            path: 'App.jsx',
            old_str: 'First design',
            new_str: 'Revised design',
          }),
        ],
        [],
        [call('preview', { path: 'App.jsx' })],
        [done()],
      ];
      const n = index++;
      return response(
        model,
        n >= batches.length ? [{ type: 'text', text: 'Revision completed' }] : (batches[n] ?? []),
        n === 3 ? 'fetch failed: terminated' : undefined,
      );
    });
    const second = await generateViaAgent(
      {
        ...input,
        prompt: 'Revise the heading',
        runPreview: preview,
        history: [
          { role: 'user', content: input.prompt },
          { role: 'assistant', content: first.message },
        ],
        initialResourceState: first.resourceState,
      },
      { fs, runtimeVerify: verify, onEvent },
    );
    expect(readFileSync(join(root, 'App.jsx'), 'utf8')).toContain('Revised design');
    expect(second.resourceState?.lastDone?.status).toBe('ok');
    expect(second.resourceState?.lastDone?.mutationSeq).toBe(second.resourceState?.mutationSeq);
    expect(checks.map((check) => check.status)).toEqual(['ok', 'ok']);
    expect(preview).toHaveBeenCalledTimes(2);
    expect(verify).toHaveBeenCalledTimes(2);
    expect(writes).toEqual(['DESIGN.md', 'App.jsx', 'App.jsx']);
    expect(native.agents).toHaveLength(3);
    expect(contexts[4]?.filter((m) => m.role === 'toolResult')).toHaveLength(3);
    expect(contexts[4]?.filter((m) => m.role === 'user')).toHaveLength(2);
  });

  it.each([
    false,
    true,
  ])('rejects aborted prompt admission (history=%s) without model calls or writes', async (history) => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      generateViaAgent(
        {
          ...input,
          signal: controller.signal,
          history: history ? [{ role: 'user', content: 'Prior turn' }] : [],
        },
        { fs },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_ABORTED' });
    expect(native.stream).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it.each([
    'fetch failed: terminated',
    'reasoning_content is missing',
  ])('rejects recovery admission cancelled from onRetry: %s', async (error) => {
    native.stream.mockImplementation((model) => response(model, [], error));
    const controller = new AbortController();
    await expect(
      generateViaAgent(
        {
          ...input,
          signal: controller.signal,
          reasoningLevel: 'low',
          history: [{ role: 'user', content: 'Prior turn' }],
        },
        { fs, onRetry: () => controller.abort() },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_ABORTED' });
    expect(native.stream).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([]);
  });

  it('makes production ask a native sequential barrier for sibling editor and done calls', async () => {
    seed();
    let answer!: (value: AskResult) => void;
    const bridge = vi.fn((_input, signal?: AbortSignal) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      return new Promise<AskResult>((resolve) => {
        answer = resolve;
      });
    });
    script([[todos()], [ask(), create('approved.txt', 'User supplied fact'), done()], 'Completed']);
    const running = generateViaAgent({ ...input, askBridge: bridge }, { fs });
    await vi.waitFor(() => expect(bridge).toHaveBeenCalledOnce());
    expect(writes).toEqual([]);
    expect(native.stream).toHaveBeenCalledTimes(2);
    answer({ status: 'answered', answers: [{ questionId: 'q', value: 'User supplied fact' }] });
    await running;
    expect(writes).toEqual(['approved.txt']);
  });

  it.each([
    'follow-up',
    'steer',
  ] as const)('cancels unresolved ask without stale sibling writes or auto-replaying %s', async (mode) => {
    seed();
    const controller = new AbortController();
    const receipts: ActiveRunMessageV1[] = [];
    const active = new ActiveRunMessages(
      'design',
      'run',
      (row) => receipts.push(row),
      controller.signal,
    );
    let answer!: (value: AskResult) => void;
    const bridge = vi.fn(
      () =>
        new Promise<AskResult>((resolve) => {
          answer = resolve;
        }),
    );
    script([[todos()], [ask(), create('after-stop.txt', 'must not write'), done()]]);
    const running = generateViaAgent(
      { ...input, signal: controller.signal, askBridge: bridge },
      { fs, activeMessages: active },
    );
    const rejected = expect(running).rejects.toMatchObject({ code: 'PROVIDER_ABORTED' });
    await vi.waitFor(() => expect(bridge).toHaveBeenCalledOnce());
    active.submit({
      schemaVersion: 1,
      designId: 'design',
      generationId: 'run',
      messageId: 'queued',
      mode,
      text: 'Preserve me for explicit recovery',
    });
    controller.abort();
    await rejected;
    answer({ status: 'cancelled', answers: [] });
    await Promise.resolve();
    expect(writes).toEqual([]);
    expect(native.stream).toHaveBeenCalledTimes(2);
    expect(receipts.map((row) => row.status)).toEqual(['pending', 'not-delivered']);
    expect(native.agents[0]?.hasQueuedMessages()).toBe(false);
  });

  it.each([
    'preview',
    'done',
  ] as const)('forwards the live pi signal through wrappers to %s and cancels siblings', async (tool) => {
    seed();
    const controller = new AbortController();
    let observed: AbortSignal | undefined;
    const wait = (signal?: AbortSignal): Promise<never> => {
      observed = signal;
      return new Promise((_resolve, reject) =>
        signal?.addEventListener('abort', () => reject(new Error('Cancelled executor')), {
          once: true,
        }),
      );
    };
    script([
      [todos()],
      [call(tool, { path: 'App.jsx' }), create('after-stop.txt', 'must not write'), done()],
    ]);
    const running = generateViaAgent(
      { ...input, signal: controller.signal, runPreview: (options) => wait(options.signal) },
      { fs, runtimeVerify: (_source, context) => wait(context?.signal) },
    );
    const rejected = expect(running).rejects.toMatchObject({ code: 'PROVIDER_ABORTED' });
    await vi.waitFor(() => expect(observed).toBeInstanceOf(AbortSignal));
    controller.abort();
    await rejected;
    expect(observed?.aborted).toBe(true);
    expect(writes).toEqual([]);
    expect(native.stream).toHaveBeenCalledTimes(2);
  });

  it('stops a mixed done/write batch at the third failed verification without a fourth provider/verifier attempt', async () => {
    seed();
    const controller = new AbortController();
    const active = new ActiveRunMessages('design', 'run', () => {}, controller.signal);
    const ended: AgentMessage[][] = [];
    const verify = vi.fn(async () => [{ message: 'Broken runtime', source: 'runtime' }]);
    script([
      [todos()],
      ...Array.from({ length: 5 }, (_, n) => [
        done(),
        create(`round${n + 1}.txt`, 'must stop at cap'),
      ]),
      'Must not complete',
    ]);
    const running = generateViaAgent(
      { ...input, signal: controller.signal },
      {
        fs,
        activeMessages: active,
        runtimeVerify: verify,
        onEvent: (event) => {
          if (event.type === 'agent_end') ended.push(event.messages);
          if (
            event.type === 'tool_execution_end' &&
            event.toolName === 'done' &&
            verify.mock.calls.length === 3
          ) {
            active.submit({
              schemaVersion: 1,
              designId: 'design',
              generationId: 'run',
              messageId: 'queued',
              mode: 'steer',
              text: 'Must not reset repair state',
            });
          }
        },
      },
    );
    await expect(running).rejects.toMatchObject({
      code: 'GENERATION_INCOMPLETE',
      message: expect.stringContaining('3 done() error rounds'),
    });
    await expect(running).rejects.toThrow('Broken runtime');
    expect(readFileSync(join(root, 'App.jsx'), 'utf8')).toBe(SOURCE);
    expect(controller.signal.aborted).toBe(false);
    expect(verify).toHaveBeenCalledTimes(3);
    expect(native.stream).toHaveBeenCalledTimes(4);
    expect(writes).toEqual(['round1.txt', 'round2.txt']);
    expect(native.agents[0]?.hasQueuedMessages()).toBe(false);
    expect(ended).toHaveLength(1);
    expect(
      native.agents[0]?.state.messages.filter((message) => message.role === 'user'),
    ).toHaveLength(1);
  });
});
