import type { AgentEvent, AgentMessage, AgentOptions } from '@mariozechner/pi-agent-core';
import type { LoadedSkill, ModelRef } from '@open-codesign/shared';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadBuiltinSkillsMock = vi.fn(async (): Promise<LoadedSkill[]> => []);

/** Captured constructor options + prompt calls for the mocked Agent. */
interface AgentCall {
  options: AgentOptions;
  prompts: Array<{ message: unknown }>;
  listeners: Array<(e: AgentEvent) => void>;
  aborted: boolean;
}

const agentCalls: AgentCall[] = [];

/** Scripted per-test: what the Agent should emit via its subscribe listener
 *  and what assistant content should end up in state.messages after prompt(). */
interface AgentScript {
  events?: AgentEvent[];
  assistantText: string;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  };
  stopReason?: 'stop' | 'error' | 'aborted';
  errorMessage?: string;
  promptThrows?: Error;
  /**
   * When > 0, `promptThrows` is thrown only on the first N prompt() calls;
   * subsequent calls resolve normally. Lets tests script "transient failure
   * then success" sequences for first-turn retry coverage.
   */
  promptThrowsTimes?: number;
  /**
   * When true together with `promptThrows`, the mock pushes a partial
   * assistant message onto `agent.state.messages` BEFORE throwing on
   * each failing attempt. Simulates "model streamed tokens / tool call
   * then the connection dropped" — the real pi-agent-core path where a
   * retry at the outer send boundary would replay tool side effects.
   */
  promptPushesAssistantBeforeThrow?: boolean;
  /**
   * When set, the mock invokes `options.getApiKey` before emitting the
   * assistant response and — if it throws — converts the throw into an
   * 'error' AgentMessage (matching pi-agent-core's `handleRunFailure`
   * behavior that flattens getApiKey throws into `errorMessage: string`).
   */
  invokeGetApiKey?: boolean;
}

let scriptedAgent: AgentScript = { assistantText: '' };

vi.mock('@mariozechner/pi-agent-core', () => {
  class MockAgent {
    readonly state: { messages: AgentMessage[] };
    private readonly call: AgentCall;
    constructor(options: AgentOptions) {
      this.call = { options, prompts: [], listeners: [], aborted: false };
      agentCalls.push(this.call);
      const seed = (options.initialState?.messages ?? []) as AgentMessage[];
      this.state = { messages: [...seed] };
    }
    subscribe(listener: (e: AgentEvent, signal?: AbortSignal) => void): () => void {
      this.call.listeners.push((e) => listener(e));
      return () => {};
    }
    async prompt(message: unknown): Promise<void> {
      this.call.prompts.push({ message });
      if (scriptedAgent.promptThrows) {
        const limit = scriptedAgent.promptThrowsTimes ?? Number.POSITIVE_INFINITY;
        if (this.call.prompts.length <= limit) {
          if (scriptedAgent.promptPushesAssistantBeforeThrow) {
            const partial: AgentMessage = {
              role: 'assistant',
              // biome-ignore lint/suspicious/noExplicitAny: same.
              api: 'anthropic-messages' as any,
              // biome-ignore lint/suspicious/noExplicitAny: same.
              provider: 'anthropic' as any,
              model: 'mock-model',
              content: [{ type: 'text', text: 'partial tokens before drop' }],
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              stopReason: 'error',
              timestamp: Date.now(),
            };
            this.state.messages.push(partial);
          }
          throw scriptedAgent.promptThrows;
        }
      }

      // Simulate pi-agent-core's per-turn getApiKey invocation. Real
      // runAgentLoop calls `await config.getApiKey(provider)` (line 156 of
      // agent-loop.js); if that rejects, `runWithLifecycle` catches it and
      // emits a failure AgentMessage with just `errorMessage: string` —
      // which is why our code captures the original throw in a closure.
      if (scriptedAgent.invokeGetApiKey && this.call.options.getApiKey) {
        try {
          await this.call.options.getApiKey('test-provider');
        } catch (err) {
          const failMsg: AgentMessage = {
            role: 'assistant',
            // biome-ignore lint/suspicious/noExplicitAny: mock literal union.
            api: 'anthropic-messages' as any,
            // biome-ignore lint/suspicious/noExplicitAny: same.
            provider: 'anthropic' as any,
            model: 'mock-model',
            content: [{ type: 'text', text: '' }],
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: 'error',
            errorMessage: err instanceof Error ? err.message : String(err),
            timestamp: Date.now(),
          };
          this.state.messages.push(failMsg);
          this.emit({ type: 'agent_end', messages: [failMsg] });
          return;
        }
      }

      this.emit({ type: 'agent_start' });
      this.emit({ type: 'turn_start' });
      const userMsg: AgentMessage = {
        role: 'user',
        content: typeof message === 'string' ? message : '',
        timestamp: Date.now(),
      };
      this.state.messages.push(userMsg);
      this.emit({ type: 'message_start', message: userMsg });
      this.emit({ type: 'message_end', message: userMsg });

      const assistantMsg: AgentMessage = {
        role: 'assistant',
        // biome-ignore lint/suspicious/noExplicitAny: matches pi-ai Api/Provider literal unions in mocks.
        api: 'anthropic-messages' as any,
        // biome-ignore lint/suspicious/noExplicitAny: same.
        provider: 'anthropic' as any,
        model: 'mock-model',
        content: [{ type: 'text', text: scriptedAgent.assistantText }],
        usage: scriptedAgent.usage ?? {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: scriptedAgent.stopReason ?? 'stop',
        ...(scriptedAgent.errorMessage ? { errorMessage: scriptedAgent.errorMessage } : {}),
        timestamp: Date.now(),
      };
      this.state.messages.push(assistantMsg);

      for (const e of scriptedAgent.events ?? []) this.emit(e);
      this.emit({
        type: 'message_update',
        message: assistantMsg,
        // biome-ignore lint/suspicious/noExplicitAny: AssistantMessageEvent shape not re-exported.
        assistantMessageEvent: { type: 'text_delta', delta: scriptedAgent.assistantText } as any,
      });
      this.emit({ type: 'message_end', message: assistantMsg });
      this.emit({ type: 'turn_end', message: assistantMsg, toolResults: [] });
      this.emit({ type: 'agent_end', messages: this.state.messages });
    }
    async waitForIdle(): Promise<void> {
      // no-op in mock
    }
    abort(): void {
      this.call.aborted = true;
    }
    private emit(e: AgentEvent): void {
      for (const l of this.call.listeners) l(e);
    }
  }
  return { Agent: MockAgent };
});

vi.mock('./skills/loader.js', async () => {
  const actual = await vi.importActual<typeof import('./skills/loader.js')>('./skills/loader.js');
  return {
    ...actual,
    loadBuiltinSkills: () => loadBuiltinSkillsMock(),
  };
});

vi.mock('@mariozechner/pi-ai', () => ({
  getModel: (provider: string, modelId: string) => ({
    id: modelId,
    name: modelId,
    api: provider === 'anthropic' ? 'anthropic-messages' : 'openai-completions',
    provider,
    baseUrl: provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1',
    reasoning: true,
    input: ['text'] as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 64000,
  }),
}));

import { generateViaAgent } from './agent.js';

const MODEL: ModelRef = { provider: 'anthropic', modelId: 'claude-sonnet-4-6' };

const SAMPLE_HTML = `<!doctype html><html lang="en"><body><h1>Hi</h1></body></html>`;
const RESPONSE_WITH_ARTIFACT = `Here is your design.

<artifact identifier="design-1" type="html" title="Hello world">
${SAMPLE_HTML}
</artifact>`;

/**
 * Minimal in-memory `TextEditorFsCallbacks` stub. The agent's parse step
 * pulls the artifact from `index.html` via the host fs — pre-populating
 * it here simulates a model that wrote through the text_editor tool.
 */
function makeStubFs(initialFiles: Record<string, string> = {}) {
  const files = new Map(Object.entries(initialFiles));
  return {
    view(path: string) {
      const content = files.get(path);
      if (content === undefined) return null;
      return { content, numLines: content.split('\n').length };
    },
    create: (path: string, content: string) => {
      files.set(path, content);
      return { path };
    },
    strReplace: (path: string) => ({ path }),
    insert: (path: string) => ({ path }),
    listDir: () => Array.from(files.keys()),
  };
}

beforeEach(() => {
  agentCalls.length = 0;
  scriptedAgent = { assistantText: '' };
  loadBuiltinSkillsMock.mockReset();
  loadBuiltinSkillsMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('generateViaAgent() — Phase 1 pass-through', () => {
  it('throws CodesignError on empty prompt (matches generate())', async () => {
    await expect(
      generateViaAgent({ prompt: '  ', history: [], model: MODEL, apiKey: 'sk-test' }),
    ).rejects.toBeInstanceOf(CodesignError);
    expect(agentCalls).toHaveLength(0);
  });

  it('throws INPUT_UNSUPPORTED_MODE when mode is not create (no systemPrompt)', async () => {
    await expect(
      generateViaAgent({
        prompt: 'tweak my design',
        history: [],
        model: MODEL,
        apiKey: 'sk-test',
        // Cast: type narrows to 'create' at compile time; runtime guard checks the
        // non-create branch explicitly.
        mode: 'tweak' as 'create',
      }),
    ).rejects.toMatchObject({ code: 'INPUT_UNSUPPORTED_MODE' });
  });

  it('constructs an Agent with empty tools, system prompt, and supplied history', async () => {
    scriptedAgent = { assistantText: RESPONSE_WITH_ARTIFACT };
    await generateViaAgent(
      {
        prompt: 'design a landing page',
        history: [{ role: 'user', content: 'prior turn' }],
        model: MODEL,
        apiKey: 'sk-test',
      },
      // Opt out of the default toolset so this test continues to pin the
      // Phase 1 zero-tool shape of the Agent init state.
      { tools: [] },
    );

    expect(agentCalls).toHaveLength(1);
    const call = agentCalls[0];
    if (!call) throw new Error('expected agent call');
    const init = call.options.initialState;
    expect(init?.tools).toEqual([]);
    expect(init?.systemPrompt).toContain('open-codesign');
    expect(init?.messages).toHaveLength(1);
    const seed = init?.messages?.[0];
    expect(seed?.role).toBe('user');
  });

  it('forwards apiKey through getApiKey callback', async () => {
    scriptedAgent = { assistantText: RESPONSE_WITH_ARTIFACT };
    await generateViaAgent({
      prompt: 'design a meditation app',
      history: [],
      model: MODEL,
      apiKey: 'sk-token-123',
    });

    const resolver = agentCalls[0]?.options.getApiKey;
    expect(resolver).toBeDefined();
    await expect(Promise.resolve(resolver?.('anthropic'))).resolves.toBe('sk-token-123');
  });

  it('prefers the dynamic input.getApiKey over the static apiKey when provided', async () => {
    scriptedAgent = { assistantText: RESPONSE_WITH_ARTIFACT };
    await generateViaAgent({
      prompt: 'long-running agent task',
      history: [],
      model: MODEL,
      apiKey: 'stale-static-token',
      getApiKey: async () => 'fresh-rotating-token',
    });

    const resolver = agentCalls[0]?.options.getApiKey;
    // Each agent turn re-invokes the getter, so a rotated OAuth token picked
    // up by the token store reaches the next LLM round-trip without
    // recomputing anything from the IPC layer.
    await expect(Promise.resolve(resolver?.('openai-codex'))).resolves.toBe('fresh-rotating-token');
  });

  it('falls back to static apiKey when input.getApiKey returns an empty string', async () => {
    scriptedAgent = { assistantText: RESPONSE_WITH_ARTIFACT };
    await generateViaAgent({
      prompt: 'fallback behavior',
      history: [],
      model: MODEL,
      apiKey: 'fallback-token',
      getApiKey: async () => '',
    });

    const resolver = agentCalls[0]?.options.getApiKey;
    await expect(Promise.resolve(resolver?.('openai-codex'))).resolves.toBe('fallback-token');
  });

  it('rethrows the original input.getApiKey error (preserves structured code)', async () => {
    // Simulates: user signs out of ChatGPT mid-agent-run. Token store throws
    // CodesignError(PROVIDER_AUTH_MISSING). Without the capture-and-rethrow
    // dance, pi-agent-core would flatten the throw into a plain errorMessage
    // string and our post-agent branch would re-wrap as PROVIDER_ERROR —
    // losing the code the renderer needs to show "sign in again".
    scriptedAgent = { assistantText: '', invokeGetApiKey: true };
    const authErr = new CodesignError('ChatGPT 订阅已失效', ERROR_CODES.PROVIDER_AUTH_MISSING);
    await expect(
      generateViaAgent({
        prompt: 'midrun logout scenario',
        history: [],
        model: MODEL,
        apiKey: 'already-expired',
        getApiKey: async () => {
          throw authErr;
        },
      }),
    ).rejects.toBe(authErr);
  });

  it('overrides pi-ai model baseUrl when input.baseUrl is provided', async () => {
    scriptedAgent = { assistantText: RESPONSE_WITH_ARTIFACT };
    await generateViaAgent({
      prompt: 'design a landing page',
      history: [],
      model: MODEL,
      apiKey: 'sk-test',
      baseUrl: 'https://proxy.example.com/v1',
    });
    const model = agentCalls[0]?.options.initialState?.model as unknown as {
      baseUrl?: string;
    };
    expect(model?.baseUrl).toBe('https://proxy.example.com/v1');
  });

  it('extracts artifact and returns usage mapped from pi-ai assistant usage', async () => {
    scriptedAgent = {
      assistantText: RESPONSE_WITH_ARTIFACT,
      usage: {
        input: 42,
        output: 84,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 126,
        cost: { input: 0.0002, output: 0.001, cacheRead: 0, cacheWrite: 0, total: 0.0012 },
      },
    };
    const result = await generateViaAgent(
      {
        prompt: 'design a meditation app',
        history: [],
        model: MODEL,
        apiKey: 'sk-test',
      },
      { fs: makeStubFs({ 'index.html': SAMPLE_HTML }) },
    );

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.id).toBe('design-1');
    expect(result.artifacts[0]?.content.trim()).toBe(SAMPLE_HTML);
    expect(result.message).toContain('Here is your design.');
    expect(result.inputTokens).toBe(42);
    expect(result.outputTokens).toBe(84);
    expect(result.costUsd).toBeCloseTo(0.0012);
  });

  it('emits agent lifecycle events through onEvent subscriber in order', async () => {
    scriptedAgent = { assistantText: RESPONSE_WITH_ARTIFACT };
    const seen: AgentEvent['type'][] = [];
    await generateViaAgent(
      {
        prompt: 'design a landing page',
        history: [],
        model: MODEL,
        apiKey: 'sk-test',
      },
      { onEvent: (e) => seen.push(e.type) },
    );

    // Must start with agent_start/turn_start and end with agent_end.
    expect(seen[0]).toBe('agent_start');
    expect(seen[1]).toBe('turn_start');
    expect(seen).toContain('message_update');
    expect(seen[seen.length - 1]).toBe('agent_end');
  });

  it('propagates stopReason=error as a PROVIDER_ERROR via remap', async () => {
    scriptedAgent = {
      assistantText: '',
      stopReason: 'error',
      errorMessage: 'upstream blew up',
    };
    await expect(
      generateViaAgent({
        prompt: 'design a dashboard',
        history: [],
        model: MODEL,
        apiKey: 'sk-test',
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('upstream blew up') });
  });

  it('abort signal cascades into agent.abort()', async () => {
    scriptedAgent = { assistantText: RESPONSE_WITH_ARTIFACT };
    const controller = new AbortController();
    const promise = generateViaAgent({
      prompt: 'design a dashboard',
      history: [],
      model: MODEL,
      apiKey: 'sk-test',
      signal: controller.signal,
    });
    controller.abort();
    // With first-turn withBackoff the pre-call signal check may short-circuit
    // the prompt entirely (throwing PROVIDER_ABORTED), or the prompt may have
    // already completed; either way the `signal → agent.abort()` listener
    // registered before sending should have fired.
    await promise.catch(() => {
      // Expected when abort arrives before the withBackoff loop enters its
      // first iteration.
    });
    expect(agentCalls[0]?.aborted).toBe(true);
  });

  it('reports skill-loader failure via warnings without blocking the artifact', async () => {
    scriptedAgent = { assistantText: RESPONSE_WITH_ARTIFACT };
    loadBuiltinSkillsMock.mockRejectedValue(new Error('disk read failed'));
    const warnLogs: Array<{ msg: string; meta?: unknown }> = [];
    const logger = {
      info: () => {},
      warn: (msg: string, meta?: unknown) => {
        warnLogs.push({ msg, meta });
      },
      error: () => {},
    };
    const result = await generateViaAgent(
      {
        prompt: 'make a dashboard',
        history: [],
        model: MODEL,
        apiKey: 'sk-test',
        logger,
      },
      { fs: makeStubFs({ 'index.html': SAMPLE_HTML }) },
    );
    expect(result.artifacts).toHaveLength(1);
    expect(result.warnings).toEqual([
      expect.stringContaining('Builtin skills unavailable: disk read failed'),
    ]);
    const warnEntry = warnLogs.find((entry) => entry.msg.includes('step=load_skills.fail'));
    expect(warnEntry).toBeDefined();
    expect(warnEntry?.meta).toMatchObject({
      errorClass: 'Error',
      message: 'disk read failed',
    });
  });

  it('returns no artifacts when prose contains a fenced ```html block but no <artifact> wrapper and no fs is provided', async () => {
    // Locks in the post-fallback contract: prose-only HTML is no longer
    // rescued. The host must rely on the text_editor + fs path.
    scriptedAgent = {
      assistantText: 'Here you go:\n\n```html\n<!doctype html><html><body>Hi</body></html>\n```',
    };
    const result = await generateViaAgent(
      {
        prompt: 'design a meditation app',
        history: [],
        model: MODEL,
        apiKey: 'sk-test',
      },
      { tools: [] },
    );
    expect(result.artifacts).toHaveLength(0);
  });

  it('augments the system prompt with the file-output policy when tools are active', async () => {
    scriptedAgent = { assistantText: RESPONSE_WITH_ARTIFACT };
    await generateViaAgent({
      prompt: 'design a landing page',
      history: [],
      model: MODEL,
      apiKey: 'sk-test',
    });
    const sys = agentCalls[0]?.options.initialState?.systemPrompt as string;
    expect(sys).toContain('str_replace_based_edit_tool');
    expect(sys).toContain('Do NOT emit `<artifact>`');
  });

  it('adds explicit bitmap trigger guidance when image asset tool is enabled', async () => {
    scriptedAgent = { assistantText: RESPONSE_WITH_ARTIFACT };
    await generateViaAgent(
      {
        prompt: 'design a landing page with a hand-painted background illustration',
        history: [],
        model: MODEL,
        apiKey: 'sk-test',
      },
      {
        generateImageAsset: async () => ({
          path: 'assets/hero.png',
          dataUrl: 'data:image/png;base64,aW1n',
          mimeType: 'image/png',
          model: 'gpt-image-2',
          provider: 'openai',
        }),
      },
    );
    const sys = agentCalls[0]?.options.initialState?.systemPrompt as string;
    expect(sys).toContain('MANDATORY asset inventory');
    expect(sys).toContain('One call per named asset');
    expect(sys).toContain("`purpose='logo'`");
  });
});

describe('generateViaAgent() — first-turn retry', () => {
  class HttpError extends Error {
    constructor(
      message: string,
      public readonly status: number,
    ) {
      super(message);
      this.name = 'HttpError';
    }
  }

  it('retries a transient 500 on the first turn and resolves on the second attempt', async () => {
    vi.useFakeTimers();
    try {
      scriptedAgent = {
        assistantText: RESPONSE_WITH_ARTIFACT,
        promptThrows: new HttpError('upstream 500', 500),
        promptThrowsTimes: 1,
      };
      const onRetry = vi.fn();
      const promise = generateViaAgent(
        {
          prompt: 'design a meditation app',
          history: [],
          model: MODEL,
          apiKey: 'sk-test',
        },
        { onRetry, fs: makeStubFs({ 'index.html': SAMPLE_HTML }) },
      );
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result.artifacts).toHaveLength(1);
      expect(agentCalls[0]?.prompts.length).toBe(2);
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry.mock.calls[0]?.[0].reason).toMatch(/server error/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws after three consecutive 500s on the first turn (retries exhausted)', async () => {
    vi.useFakeTimers();
    try {
      scriptedAgent = {
        assistantText: '',
        promptThrows: new HttpError('still down', 500),
      };
      const promise = generateViaAgent({
        prompt: 'design a dashboard',
        history: [],
        model: MODEL,
        apiKey: 'sk-test',
      });
      // Swallow the expected rejection while we drain timers so the test
      // does not surface it as an unhandled promise.
      const settled = promise.catch((err: unknown) => ({ rejected: err }));
      await vi.runAllTimersAsync();
      const outcome = (await settled) as { rejected?: unknown };
      expect(outcome.rejected).toBeDefined();
      expect(agentCalls[0]?.prompts.length).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry 4xx client errors (no 401 replay)', async () => {
    scriptedAgent = {
      assistantText: '',
      promptThrows: new HttpError('unauthorized', 401),
    };
    await expect(
      generateViaAgent({
        prompt: 'design a dashboard',
        history: [],
        model: MODEL,
        apiKey: 'sk-test',
      }),
    ).rejects.toBeTruthy();
    expect(agentCalls[0]?.prompts.length).toBe(1);
  });

  it('does not retry once the agent has produced an assistant message (side-effect guard)', async () => {
    // First-turn + transient 500, BUT the mock pushes a partial assistant
    // message before throwing, simulating "model already emitted tokens /
    // tool calls before the connection dropped". Replaying would re-run
    // any text_editor / set_todos side effects, so retry must be blocked
    // regardless of the HTTP status. A single attempt is the only safe move.
    scriptedAgent = {
      assistantText: '',
      promptThrows: new HttpError('upstream 500', 500),
      promptPushesAssistantBeforeThrow: true,
    };
    await expect(
      generateViaAgent({
        prompt: 'design a dashboard',
        history: [],
        model: MODEL,
        apiKey: 'sk-test',
      }),
    ).rejects.toBeTruthy();
    expect(agentCalls[0]?.prompts.length).toBe(1);
  });

  it('does not retry when history is non-empty (protects multi-turn agent state)', async () => {
    scriptedAgent = {
      assistantText: '',
      promptThrows: new HttpError('upstream 500', 500),
    };
    await expect(
      generateViaAgent({
        prompt: 'refine this',
        history: [
          { role: 'user', content: 'first request' },
          { role: 'assistant', content: 'first reply' },
        ],
        model: MODEL,
        apiKey: 'sk-test',
      }),
    ).rejects.toBeTruthy();
    // Single attempt: replaying a partial multi-turn session would corrupt
    // tool state, so the second+ turn must surface transient errors directly.
    expect(agentCalls[0]?.prompts.length).toBe(1);
  });
});

describe('loadFrameTemplates — device frame starter assets', () => {
  it('returns declared frame files in canonical order when a directory provides them', async () => {
    const { mkdirSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const { FRAME_FILES, loadFrameTemplates } = await import('./frames/index.js');
    const dir = path.join(tmpdir(), `codesign-frames-${process.pid}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      for (const name of FRAME_FILES) {
        writeFileSync(path.join(dir, name), `// ${name}\nplaceholder\n`, 'utf8');
      }
      const entries = await loadFrameTemplates(dir);
      expect(entries.map(([n]) => n)).toEqual([...FRAME_FILES]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('seeds an agent-host fsMap so the agent can `view` frames/<name>', async () => {
    const { mkdirSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const { FRAME_FILES, loadFrameTemplates } = await import('./frames/index.js');
    const dir = path.join(tmpdir(), `codesign-frames-seed-${process.pid}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      for (const name of FRAME_FILES) {
        writeFileSync(path.join(dir, name), `// ${name} body\nReactDOM.createRoot(...)\n`, 'utf8');
      }
      const entries = await loadFrameTemplates(dir);
      const fsMap = new Map<string, string>();
      for (const [name, content] of entries) {
        fsMap.set(`frames/${name}`, content);
      }
      expect(fsMap.get('frames/iphone.jsx')).toMatch(/iphone\.jsx body/);
      expect(fsMap.get('frames/ipad.jsx')).toMatch(/ReactDOM\.createRoot/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
