import type { ChatMessage, ModelRef } from '@open-codesign/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getModelMock = vi.fn();
const completeSimpleMock = vi.fn();

vi.mock('@mariozechner/pi-ai', () => ({
  getModel: (...args: unknown[]) => getModelMock(...args),
  completeSimple: (...args: unknown[]) => completeSimpleMock(...args),
}));

import { complete } from './index';

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

  it('adds Bearer auth for remote Anthropic-compatible gateways', async () => {
    getModelMock.mockReturnValue(undefined);
    completeSimpleMock.mockImplementationOnce(async (_model, _context, opts) => {
      expect(opts.apiKey).toBe('sk-ant-test');
      expect(opts.headers).toEqual({ authorization: 'Bearer sk-ant-test' });
      return {
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        api: 'anthropic-messages',
        provider: 'claude-code-imported',
        model: 'claude-opus-4-6',
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
      { provider: 'claude-code-imported', modelId: 'claude-opus-4-6' },
      [{ role: 'user', content: 'hi' }],
      {
        apiKey: 'sk-ant-test',
        wire: 'anthropic',
        baseUrl: 'https://api.nagara.top',
      },
    );

    expect(result.content).toBe('ok');
  });

  it('does not add Bearer auth for localhost Anthropic proxies', async () => {
    getModelMock.mockReturnValue(undefined);
    completeSimpleMock.mockImplementationOnce(async (_model, _context, opts) => {
      expect(opts.headers).toBeUndefined();
      return {
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        api: 'anthropic-messages',
        provider: 'claude-local',
        model: 'claude-sonnet-4-6',
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
      { provider: 'claude-local', modelId: 'claude-sonnet-4-6' },
      [{ role: 'user', content: 'hi' }],
      {
        apiKey: 'sk-ant-test',
        wire: 'anthropic',
        baseUrl: 'http://localhost:4000',
      },
    );
  });
});
