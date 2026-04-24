import type { ChatMessage, ModelRef } from '@open-codesign/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getModelMock = vi.fn();
const completeSimpleMock = vi.fn();

vi.mock('@mariozechner/pi-ai', () => ({
  getModel: (...args: unknown[]) => getModelMock(...args),
  completeSimple: (...args: unknown[]) => completeSimpleMock(...args),
}));

import { complete, inferReasoning } from './index';

const MODEL: ModelRef = { provider: 'openai', modelId: 'gpt-4o' };

afterEach(() => {
  getModelMock.mockReset();
  completeSimpleMock.mockReset();
});

describe('complete', () => {
  it('adapts shared chat history into pi-ai context for follow-up turns', async () => {
    getModelMock.mockReturnValue({
      id: 'gpt-4o',
      api: 'openai-completions',
      provider: 'openai',
    });
    completeSimpleMock.mockImplementationOnce(async (_model, context) => {
      expect(context.systemPrompt).toBe('You are open-codesign.');
      expect(context.messages).toEqual([
        {
          role: 'user',
          content: '介绍一下你自己',
          timestamp: 2,
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '我是一个设计助手。' }],
          api: 'openai-completions',
          provider: 'openai',
          model: 'gpt-4o',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: 'stop',
          timestamp: 3,
        },
        {
          role: 'user',
          content: '你可以干什么',
          timestamp: 4,
        },
      ]);

      return {
        role: 'assistant',
        content: [{ type: 'text', text: '我可以帮你生成设计稿。' }],
        api: 'openai-completions',
        provider: 'openai',
        model: 'gpt-4o',
        usage: {
          input: 12,
          output: 34,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 46,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0.01,
          },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      };
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are open-codesign.' },
      { role: 'user', content: '介绍一下你自己' },
      { role: 'assistant', content: '我是一个设计助手。' },
      { role: 'user', content: '你可以干什么' },
    ];

    const result = await complete(MODEL, messages, { apiKey: 'sk-test' });

    expect(result).toEqual({
      content: '我可以帮你生成设计稿。',
      inputTokens: 12,
      outputTokens: 34,
      costUsd: 0.01,
    });
  });

  it('synthesizes a pass-through Model when openrouter id is missing from registry', async () => {
    getModelMock.mockReturnValue(undefined);
    completeSimpleMock.mockImplementationOnce(async (model, _context) => {
      expect(model).toEqual({
        id: 'xiaomi/mimo-v2-flash:free',
        name: 'xiaomi/mimo-v2-flash:free',
        api: 'openai-completions',
        provider: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 131072,
        maxTokens: 131072,
      });
      return {
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        api: 'openai-completions',
        provider: 'openrouter',
        model: 'xiaomi/mimo-v2-flash:free',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      };
    });

    const result = await complete(
      { provider: 'openrouter', modelId: 'xiaomi/mimo-v2-flash:free' },
      [{ role: 'user', content: 'hi' }],
      { apiKey: 'sk-or-test' },
    );

    expect(result.content).toBe('ok');
  });

  it('throws PROVIDER_MODEL_UNKNOWN for non-openrouter providers when registry misses', async () => {
    getModelMock.mockReturnValue(undefined);

    await expect(
      complete({ provider: 'openai', modelId: 'gpt-future' }, [{ role: 'user', content: 'hi' }], {
        apiKey: 'sk-test',
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_MODEL_UNKNOWN' });
    expect(completeSimpleMock).not.toHaveBeenCalled();
  });

  it('allows keyless custom gateways by passing a local placeholder key and extra headers', async () => {
    getModelMock.mockReturnValue(undefined);
    completeSimpleMock.mockImplementationOnce(async (_model, _context, opts) => {
      expect(opts.apiKey).toBe('open-codesign-keyless');
      expect(opts.headers).toEqual({ 'x-proxy-auth': 'local' });
      return {
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        api: 'openai-completions',
        provider: 'codex-proxy',
        model: 'gpt-5.3-codex',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      };
    });

    const result = await complete(
      { provider: 'codex-proxy', modelId: 'gpt-5.3-codex' },
      [{ role: 'user', content: 'hi' }],
      {
        apiKey: '',
        allowKeyless: true,
        wire: 'openai-chat',
        baseUrl: 'https://proxy.example.test/v1',
        httpHeaders: { 'x-proxy-auth': 'local' },
      },
    );

    expect(result.content).toBe('ok');
  });

  it('overrides registry reasoning for builtin OpenAI rows repointed to a proxy', async () => {
    getModelMock.mockReturnValue({
      id: 'gpt-5.4',
      api: 'openai-completions',
      provider: 'openai',
      reasoning: true,
    });
    completeSimpleMock.mockImplementationOnce(async (piModel) => {
      expect(piModel.reasoning).toBe(false);
      return {
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        api: 'openai-completions',
        provider: 'openai',
        model: 'gpt-5.4',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      };
    });

    await complete({ provider: 'openai', modelId: 'gpt-5.4' }, [{ role: 'user', content: 'hi' }], {
      apiKey: 'sk-test',
      wire: 'openai-chat',
      baseUrl: 'https://api.duckcoding.ai/v1',
      capabilities: { supportsReasoning: false },
    });
  });

  it('preserves official OpenAI reasoning heuristics even when registry metadata says otherwise', async () => {
    getModelMock.mockReturnValue({
      id: 'gpt-5.4',
      api: 'openai-completions',
      provider: 'openai',
      reasoning: false,
    });
    completeSimpleMock.mockImplementationOnce(async (piModel) => {
      expect(piModel.reasoning).toBe(true);
      return {
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        api: 'openai-completions',
        provider: 'openai',
        model: 'gpt-5.4',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      };
    });

    await complete({ provider: 'openai', modelId: 'gpt-5.4' }, [{ role: 'user', content: 'hi' }], {
      apiKey: 'sk-test',
      wire: 'openai-chat',
      baseUrl: 'https://api.openai.com/v1',
      capabilities: { supportsReasoning: false },
    });
  });

  it('uses registry baseUrl when preserving official OpenAI heuristics for registered models', async () => {
    getModelMock.mockReturnValue({
      id: 'gpt-5.4',
      api: 'openai-completions',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      reasoning: false,
    });
    completeSimpleMock.mockImplementationOnce(async (piModel) => {
      expect(piModel.reasoning).toBe(true);
      return {
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        api: 'openai-completions',
        provider: 'openai',
        model: 'gpt-5.4',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      };
    });

    await complete({ provider: 'openai', modelId: 'gpt-5.4' }, [{ role: 'user', content: 'hi' }], {
      apiKey: 'sk-test',
      wire: 'openai-chat',
      capabilities: { supportsReasoning: false },
    });
  });

  it('appends image inputs to the final user turn for openai-codex-responses', async () => {
    getModelMock.mockReturnValue({
      id: 'gpt-5.4',
      api: 'openai-codex-responses',
      provider: 'openai-codex',
      input: ['text', 'image'],
    });
    completeSimpleMock.mockImplementationOnce(async (_model, context) => {
      expect(context.messages).toEqual([
        {
          role: 'user',
          content: 'earlier turn',
          timestamp: 1,
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'tell me more' }],
          api: 'openai-codex-responses',
          provider: 'openai-codex',
          model: 'gpt-5.4',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: 'stop',
          timestamp: 2,
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'use this screenshot' },
            { type: 'image', data: 'AAAA', mimeType: 'image/png' },
          ],
          timestamp: 3,
        },
      ]);
      return {
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        api: 'openai-codex-responses',
        provider: 'openai-codex',
        model: 'gpt-5.4',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      };
    });

    const result = await complete(
      { provider: 'chatgpt-codex', modelId: 'gpt-5.4' },
      [
        { role: 'user', content: 'earlier turn' },
        { role: 'assistant', content: 'tell me more' },
        { role: 'user', content: 'use this screenshot' },
      ],
      {
        apiKey: 'token',
        wire: 'openai-codex-responses',
        userImages: [{ data: 'AAAA', mimeType: 'image/png' }],
      },
    );

    expect(result.content).toBe('ok');
  });

  it('synthesizes openai-chat PiModel with reasoning=false for Qwen DashScope (#183)', async () => {
    getModelMock.mockReturnValue(undefined);
    completeSimpleMock.mockImplementationOnce(async (model) => {
      expect(model.reasoning).toBe(false);
      expect(model.api).toBe('openai-completions');
      expect(model.baseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
      return {
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        api: 'openai-completions',
        provider: 'custom-qwen',
        model: 'qwen3.6-plus',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      };
    });

    await complete(
      { provider: 'custom-qwen', modelId: 'qwen3.6-plus' },
      [{ role: 'user', content: 'hi' }],
      {
        apiKey: 'sk-test',
        wire: 'openai-chat',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      },
    );
  });

  it('rejects oversized combined image inputs for openai-codex-responses', async () => {
    getModelMock.mockReturnValue({
      id: 'gpt-5.4',
      api: 'openai-codex-responses',
      provider: 'openai-codex',
      input: ['text', 'image'],
    });

    await expect(
      complete(
        { provider: 'chatgpt-codex', modelId: 'gpt-5.4' },
        [{ role: 'user', content: 'use these screenshots' }],
        {
          apiKey: 'token',
          wire: 'openai-codex-responses',
          userImages: [
            { data: 'A'.repeat(2_700_000), mimeType: 'image/png' },
            { data: 'A'.repeat(2_700_000), mimeType: 'image/png' },
          ],
        },
      ),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_TOO_LARGE' });
  });

  it('strips models/ prefix from modelId when routing through Gemini OpenAI-compat endpoint', async () => {
    getModelMock.mockReturnValue(undefined);
    completeSimpleMock.mockImplementationOnce(async (piModel) => {
      expect(piModel.id).toBe('gemini-2-pro');
      return {
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
        api: 'openai-completions',
        provider: 'custom-gemini',
        model: 'gemini-2-pro',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      };
    });

    await complete(
      { provider: 'custom-gemini', modelId: 'models/gemini-2-pro' },
      [{ role: 'user', content: 'hello' }],
      {
        apiKey: 'token',
        wire: 'openai-chat',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      },
    );

    expect(getModelMock).toHaveBeenCalledWith('custom-gemini', 'gemini-2-pro');
  });
});

describe('complete — openai-responses strict instructions', () => {
  it('injects top-level instructions and strips system/developer input items via onPayload', async () => {
    getModelMock.mockReturnValue({
      id: 'gpt-5.1',
      api: 'openai-responses',
      provider: 'openai',
    });

    let capturedOnPayload:
      | ((payload: unknown) => unknown | Promise<unknown | undefined>)
      | undefined;

    completeSimpleMock.mockImplementationOnce(async (_model, _context, opts) => {
      capturedOnPayload = opts.onPayload;
      return {
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        api: 'openai-responses',
        provider: 'openai',
        model: 'gpt-5.1',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      };
    });

    await complete(
      { provider: 'openai', modelId: 'gpt-5.1' },
      [
        { role: 'system', content: 'You are open-codesign.' },
        { role: 'user', content: 'hi' },
      ],
      { apiKey: 'sk-test' },
    );

    expect(capturedOnPayload).toBeDefined();

    const params = {
      input: [
        { role: 'system', content: 'ignored' },
        { role: 'developer', content: 'ignored' },
        { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      ],
    };
    const mutated = (await capturedOnPayload?.(params)) as {
      instructions?: string;
      input: Array<{ role: string }>;
    };

    expect(mutated.instructions).toBe('You are open-codesign.');
    expect(mutated.input.map((entry) => entry.role)).toEqual(['user']);
  });

  it('does not attach onPayload when systemPrompt is empty', async () => {
    getModelMock.mockReturnValue({
      id: 'gpt-5.1',
      api: 'openai-responses',
      provider: 'openai',
    });

    completeSimpleMock.mockImplementationOnce(async (_model, _context, opts) => {
      expect(opts.onPayload).toBeUndefined();
      return {
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        api: 'openai-responses',
        provider: 'openai',
        model: 'gpt-5.1',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      };
    });

    await complete({ provider: 'openai', modelId: 'gpt-5.1' }, [{ role: 'user', content: 'hi' }], {
      apiKey: 'sk-test',
    });
  });

  it('does not attach onPayload for anthropic-messages wire even with systemPrompt', async () => {
    getModelMock.mockReturnValue({
      id: 'claude-4.7-sonnet',
      api: 'anthropic-messages',
      provider: 'anthropic',
    });

    completeSimpleMock.mockImplementationOnce(async (_model, _context, opts) => {
      expect(opts.onPayload).toBeUndefined();
      return {
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        api: 'anthropic-messages',
        provider: 'anthropic',
        model: 'claude-4.7-sonnet',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      };
    });

    await complete(
      { provider: 'anthropic', modelId: 'claude-4.7-sonnet' },
      [
        { role: 'system', content: 'You are open-codesign.' },
        { role: 'user', content: 'hi' },
      ],
      { apiKey: 'sk-ant-test' },
    );
  });
});

describe('inferReasoning', () => {
  it('returns false for Qwen DashScope via openai-chat (#183)', () => {
    expect(
      inferReasoning(
        'openai-chat',
        'qwen3.6-plus',
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
      ),
    ).toBe(false);
  });

  it('returns false for DeepSeek via openai-chat', () => {
    expect(inferReasoning('openai-chat', 'deepseek-chat', 'https://api.deepseek.com/v1')).toBe(
      false,
    );
  });

  it('returns false for GLM (BigModel) via openai-chat', () => {
    expect(inferReasoning('openai-chat', 'glm-4.6v', 'https://open.bigmodel.cn/api/paas/v4')).toBe(
      false,
    );
  });

  it('returns false for OpenAI official non-reasoning model (gpt-4o)', () => {
    expect(inferReasoning('openai-chat', 'gpt-4o', 'https://api.openai.com/v1')).toBe(false);
  });

  it('returns true for OpenAI official gpt-5 family via openai-chat', () => {
    expect(inferReasoning('openai-chat', 'gpt-5-turbo', 'https://api.openai.com/v1')).toBe(true);
  });

  it('returns true for OpenAI official o3 family via openai-chat', () => {
    expect(inferReasoning('openai-chat', 'o3-mini', 'https://api.openai.com/v1')).toBe(true);
  });

  it('returns true for openai-responses regardless of model id (preserves #134 fix)', () => {
    expect(inferReasoning('openai-responses', 'gpt-5.4', 'https://proxy.example/v1')).toBe(true);
  });

  it('returns true for anthropic wire', () => {
    expect(inferReasoning('anthropic', 'claude-opus-4-5', 'https://api.anthropic.com')).toBe(true);
  });

  it('returns false when wire is undefined', () => {
    expect(inferReasoning(undefined, 'gpt-4o', 'https://api.openai.com/v1')).toBe(false);
  });

  it('prefers explicit capability profile over heuristic reasoning inference on custom gateways', () => {
    expect(
      inferReasoning('openai-chat', 'gpt-5.4', 'https://proxy.example/v1', {
        supportsReasoning: false,
      }),
    ).toBe(false);
    expect(
      inferReasoning('openai-chat', 'gpt-4o', 'https://proxy.example/v1', {
        supportsReasoning: true,
      }),
    ).toBe(true);
  });

  it('preserves official openai-chat heuristics when resolved capabilities default to supportsReasoning:false', () => {
    expect(
      inferReasoning(
        'openai-chat',
        'gpt-5.4',
        'https://api.openai.com/v1',
        {
          supportsReasoning: false,
        },
        'openai',
      ),
    ).toBe(true);
    expect(
      inferReasoning(
        'openai-chat',
        'openai/o3-mini',
        'https://openrouter.ai/api/v1',
        {
          supportsReasoning: false,
        },
        'openrouter',
      ),
    ).toBe(true);
  });

  it('respects explicit reasoning opt-out for imported providers even on official base URLs', () => {
    expect(
      inferReasoning(
        'openai-chat',
        'gpt-5.4',
        'https://api.openai.com/v1',
        {
          supportsReasoning: false,
        },
        'custom-openai',
      ),
    ).toBe(false);
    expect(
      inferReasoning(
        'openai-chat',
        'openai/o3-mini',
        'https://openrouter.ai/api/v1',
        {
          supportsReasoning: false,
        },
        'custom-openrouter',
      ),
    ).toBe(false);
  });

  it('does not preserve builtin openai/openrouter heuristics after repointing baseUrl to a proxy', () => {
    expect(
      inferReasoning(
        'openai-chat',
        'gpt-5.4',
        'https://api.duckcoding.ai/v1',
        {
          supportsReasoning: false,
        },
        'openai',
      ),
    ).toBe(false);
    expect(
      inferReasoning(
        'openai-chat',
        'openai/o3-mini',
        'https://my-openrouter-proxy.example/v1',
        {
          supportsReasoning: false,
        },
        'openrouter',
      ),
    ).toBe(false);
  });

  it('returns true for third-party openai-chat with reasoning model ID (issue #188)', () => {
    // univibe/custom proxy with Claude 4 model
    expect(inferReasoning('openai-chat', 'claude-opus-4-6', 'https://api.univibe.cc/openai')).toBe(
      true,
    );
    expect(
      inferReasoning('openai-chat', 'claude-sonnet-4-6', 'https://api.univibe.cc/openai'),
    ).toBe(true);
    // OpenRouter-style paths on custom proxy
    expect(
      inferReasoning('openai-chat', 'anthropic/claude-opus-4-6', 'https://my-proxy.example/v1'),
    ).toBe(true);
    // OpenAI-style namespaced paths on custom proxy
    expect(inferReasoning('openai-chat', 'openai/o3-mini', 'https://my-proxy.example/v1')).toBe(
      true,
    );
    expect(inferReasoning('openai-chat', 'openai/gpt-5.1', 'https://my-proxy.example/v1')).toBe(
      true,
    );
    // o1 on custom proxy
    expect(inferReasoning('openai-chat', 'o1-mini', 'https://my-proxy.example/v1')).toBe(true);
    // qwen/qwq on custom proxy
    expect(
      inferReasoning('openai-chat', 'qwen/qwq-32b-preview', 'https://my-proxy.example/v1'),
    ).toBe(true);
  });

  it('returns false for third-party openai-chat with non-reasoning model ID', () => {
    expect(
      inferReasoning(
        'openai-chat',
        'qwen3.6-plus',
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
      ),
    ).toBe(false);
    expect(inferReasoning('openai-chat', 'deepseek-chat', 'https://api.deepseek.com/v1')).toBe(
      false,
    );
    expect(inferReasoning('openai-chat', 'glm-4.6v', 'https://open.bigmodel.cn/api/paas/v4')).toBe(
      false,
    );
  });
});
