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
});
