import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agent, AgentMessage, AgentOptions, StreamFn } from '@mariozechner/pi-agent-core';
import { type AssistantMessage, createAssistantMessageEventStream } from '@mariozechner/pi-ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateViaAgent } from './agent';
import type { GenerateInput } from './index';
import type { DoneDetails, DoneRuntimeResult, DoneRuntimeVerifier } from './tools/done';
import type { LayoutIssue, PreviewResult, RunPreviewFn } from './tools/preview';
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
const BROKEN = `function App() { return <main><h1>{price}</h1></main>; }
ReactDOM.createRoot(document.getElementById('root')).render(<App />);`;
const FIXED = BROKEN.replace('{price}', 'Pricing');
const input: GenerateInput = {
  prompt: 'Build a pricing page',
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
const preview = (id = 'preview') => call('preview', { path: 'App.jsx' }, id);
const done = (id = 'done') => call('done', { path: 'App.jsx' }, id);
const fix = (oldStr: string, newStr: string, id = 'fix') =>
  call(
    'str_replace_based_edit_tool',
    { command: 'str_replace', path: 'App.jsx', old_str: oldStr, new_str: newStr },
    id,
  );

function response(model: Parameters<StreamFn>[0], content: AssistantMessage['content']) {
  const stopReason: 'toolUse' | 'stop' = content.some((part) => part.type === 'toolCall')
    ? 'toolUse'
    : 'stop';
  const message: AssistantMessage = {
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    content,
    timestamp: Date.now(),
    stopReason,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
  const stream = createAssistantMessageEventStream();
  stream.push({ type: 'done', reason: stopReason, message });
  return stream;
}

/** What the model was shown before each of its turns, so a test can read the tool results it saw. */
let requests: AgentMessage[][];
function script(batches: Array<Call[] | string>) {
  requests = [];
  native.stream.mockImplementation((model, context) => {
    requests.push([...context.messages]);
    const batch = batches.shift();
    if (batch === undefined) throw new Error('Unexpected extra provider call');
    return response(model, typeof batch === 'string' ? [{ type: 'text', text: batch }] : batch);
  });
}

/** The text of the tool results with this id that the model had seen by its n-th turn (0-based). */
function toolResultText(turn: number, toolCallId: string): string {
  const message = requests[turn]?.find(
    (item) => item.role === 'toolResult' && item.toolCallId === toolCallId,
  );
  if (message?.role !== 'toolResult') throw new Error(`No ${toolCallId} result at turn ${turn}`);
  return message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

const overflow: LayoutIssue = {
  check: 'horizontal-overflow',
  viewportWidth: 390,
  selector: 'table#prices',
  message:
    'table#prices reaches 800 px, past the 390 px viewport edge, so the page scrolls sideways.',
  measured: 800,
  limit: 390,
};
const layoutWarning = { source: 'layout', message: overflow.message };
const runtimeError = {
  source: 'console.error',
  message: 'ReferenceError: price is not defined',
  lineno: 1,
};
const clean: DoneRuntimeResult = { errors: [], warnings: [] };

function previewResult(overrides: Partial<PreviewResult> = {}): PreviewResult {
  return {
    ok: true,
    consoleErrors: [],
    assetErrors: [],
    metrics: { nodes: 4, width: 1280, height: 800, loadMs: 1 },
    ...overrides,
  };
}

let root: string;
let fs: TextEditorFsCallbacks;
let writes: string[];
beforeEach(() => {
  native.stream.mockReset();
  native.agents.length = 0;
  root = mkdtempSync(join(tmpdir(), 'codesign-design-loop-'));
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

/** Runs the production agent with stubbed browser executors, recording every `done` result. */
function run(options: { verify: DoneRuntimeVerifier; runPreview?: RunPreviewFn }) {
  const checks: DoneDetails[] = [];
  const result = generateViaAgent(
    { ...input, runPreview: options.runPreview ?? (async () => previewResult()) },
    {
      fs,
      runtimeVerify: options.verify,
      onEvent: (event) => {
        if (event.type === 'tool_execution_end' && event.toolName === 'done') {
          checks.push(event.result.details as DoneDetails);
        }
      },
    },
  );
  return { result, checks };
}

describe('the design loop with the production agent and a scripted model', () => {
  it('writes, previews, hears a runtime error from done, fixes it and finishes', async () => {
    const verify = vi
      .fn<DoneRuntimeVerifier>()
      .mockResolvedValueOnce({ errors: [runtimeError], warnings: [] })
      .mockResolvedValueOnce(clean);
    script([
      [todos()],
      [create('DESIGN.md', DESIGN), create('App.jsx', BROKEN)],
      [preview()],
      [done('done-1')],
      [fix('{price}', 'Pricing')],
      [preview('preview-2')],
      [done('done-2')],
      'Fixed the heading.',
    ]);

    const { result, checks } = run({ verify });
    const finished = await result;

    expect(checks.map((check) => check.status)).toEqual(['has_errors', 'ok']);
    expect(verify.mock.calls.map(([source]) => source.includes('Pricing'))).toEqual([false, true]);
    expect(toolResultText(4, 'done-1')).toMatch(
      /^has_errors\n- console\.error: ReferenceError: price is not defined \(line 1\)/,
    );
    expect(readFileSync(join(root, 'App.jsx'), 'utf8')).toBe(FIXED);
    expect(finished.resourceState?.lastDone?.status).toBe('ok');
    expect(finished.artifacts).toHaveLength(1);
  });

  describe('layout and accessibility advice', () => {
    it('lists a layout warning without failing done, and tells the agent it may fix one without calling done again', async () => {
      const verify = vi
        .fn<DoneRuntimeVerifier>()
        .mockResolvedValue({ errors: [], warnings: [layoutWarning] });
      script([
        [todos()],
        [create('DESIGN.md', DESIGN), create('App.jsx', FIXED)],
        [preview()],
        [done()],
        'Done, with one layout note.',
      ]);

      const { result, checks } = run({ verify });
      const finished = await result;

      expect(checks).toHaveLength(1);
      expect(checks[0]).toMatchObject({ status: 'ok', errors: [], warnings: [layoutWarning] });
      const text = toolResultText(4, 'done');
      expect(text).toContain('Non-blocking warnings:');
      expect(text).toContain(`- layout: ${layoutWarning.message}`);
      expect(text).toContain('advice, not errors');
      expect(text).not.toContain('STOP.');
      expect(finished.resourceState?.lastDone?.status).toBe('ok');
    });

    it('lets the agent fix the warning and check it with preview, then stop without a second done', async () => {
      const verify = vi
        .fn<DoneRuntimeVerifier>()
        .mockResolvedValue({ errors: [], warnings: [layoutWarning] });
      const runPreview = vi
        .fn<RunPreviewFn>()
        .mockResolvedValueOnce(previewResult({ layoutIssues: [overflow] }))
        .mockResolvedValueOnce(previewResult());
      script([
        [todos()],
        [create('DESIGN.md', DESIGN), create('App.jsx', FIXED)],
        [preview('preview-1')],
        [done()],
        [fix('Pricing', 'Plans')],
        [preview('preview-2')],
        'Fixed the layout note.',
      ]);

      const { result, checks } = run({ verify, runPreview });
      await result;

      expect(checks).toHaveLength(1);
      expect(verify).toHaveBeenCalledTimes(1);
      expect(runPreview).toHaveBeenCalledTimes(2);
      expect(readFileSync(join(root, 'App.jsx'), 'utf8')).toContain('Plans');
    });

    it('shows the model the layout issues of a preview, which stays ok', async () => {
      const runPreview = vi
        .fn<RunPreviewFn>()
        .mockResolvedValue(previewResult({ layoutIssues: [overflow] }));
      script([
        [todos()],
        [create('DESIGN.md', DESIGN), create('App.jsx', FIXED)],
        [preview()],
        [done()],
        'Done.',
      ]);

      const { result } = run({ verify: async () => clean, runPreview });
      await result;

      const text = toolResultText(3, 'preview');
      expect(text).toContain(
        'preview ok: 4 nodes, 0 console errors, 0 asset errors, 1 layout issue',
      );
      expect(text).toContain('"layoutIssues"');
      expect(text).toContain('table#prices');
    });

    it('reports layout warnings next to the runtime errors that fail done', async () => {
      const verify = vi
        .fn<DoneRuntimeVerifier>()
        .mockResolvedValueOnce({ errors: [runtimeError], warnings: [layoutWarning] })
        .mockResolvedValueOnce(clean);
      script([
        [todos()],
        [create('DESIGN.md', DESIGN), create('App.jsx', BROKEN)],
        [preview()],
        [done('done-1')],
        [fix('{price}', 'Pricing')],
        [done('done-2')],
        'Fixed.',
      ]);

      const { result, checks } = run({ verify });
      await result;

      expect(checks.map((check) => check.status)).toEqual(['has_errors', 'ok']);
      expect(checks[0]?.warnings).toEqual([layoutWarning]);
      const text = toolResultText(4, 'done-1');
      expect(text.startsWith('has_errors')).toBe(true);
      expect(text).toContain('Non-blocking warnings:');
    });

    it('does not count warnings as repair rounds, however often done is called', async () => {
      const verify = vi
        .fn<DoneRuntimeVerifier>()
        .mockResolvedValue({ errors: [], warnings: [layoutWarning] });
      script([
        [todos()],
        [create('DESIGN.md', DESIGN), create('App.jsx', FIXED)],
        [preview()],
        [done('done-1')],
        [done('done-2')],
        [done('done-3')],
        [done('done-4')],
        [done('done-5')],
        'Done.',
      ]);

      const { result, checks } = run({ verify });
      const finished = await result;

      expect(checks.map((check) => check.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
      expect(finished.resourceState?.lastDone?.status).toBe('ok');
    });

    it('still stops after three done error rounds, whatever the warnings say', async () => {
      const verify = vi
        .fn<DoneRuntimeVerifier>()
        .mockResolvedValue({ errors: [runtimeError], warnings: [layoutWarning] });
      script([
        [todos()],
        [create('DESIGN.md', DESIGN), create('App.jsx', BROKEN)],
        [preview()],
        [done('done-1')],
        [done('done-2')],
        [done('done-3')],
      ]);

      const { result, checks } = run({ verify });

      await expect(result).rejects.toMatchObject({ code: 'GENERATION_INCOMPLETE' });
      expect(checks.map((check) => check.status)).toEqual([
        'has_errors',
        'has_errors',
        'has_errors',
      ]);
      expect(readFileSync(join(root, 'App.jsx'), 'utf8')).toBe(BROKEN);
    });

    it('treats a layout measurement that did not run as a warning, not a failure', async () => {
      const notRun = {
        source: 'layout',
        message: 'Layout checks did not run: Execution context was destroyed',
      };
      const verify = vi
        .fn<DoneRuntimeVerifier>()
        .mockResolvedValue({ errors: [], warnings: [notRun] });
      script([
        [todos()],
        [create('DESIGN.md', DESIGN), create('App.jsx', FIXED)],
        [preview()],
        [done()],
        'Done.',
      ]);

      const { result, checks } = run({ verify });
      const finished = await result;

      expect(checks[0]?.status).toBe('ok');
      expect(toolResultText(4, 'done')).toContain(`- layout: ${notRun.message}`);
      expect(finished.resourceState?.lastDone?.status).toBe('ok');
    });
  });
});
