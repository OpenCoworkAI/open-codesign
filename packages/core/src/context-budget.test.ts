import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { describe, expect, it } from 'vitest';
import { planContextBudget } from './context-budget.js';

const user = (chars: number): AgentMessage => ({
  role: 'user',
  content: 'u'.repeat(chars),
  timestamp: 0,
});
const assistant = (chars: number): AgentMessage =>
  ({
    role: 'assistant',
    content: [{ type: 'text', text: 'a'.repeat(chars) }],
    timestamp: 0,
  }) as unknown as AgentMessage;

const base = {
  systemPrompt: 's'.repeat(4_000),
  tools: [],
  prompt: 'p'.repeat(400),
  promptImages: 0,
};

describe('planContextBudget', () => {
  it("keeps all history and reserves pi's compaction reserve in a large window", () => {
    const history = [user(400), assistant(400)];
    const budget = planContextBudget({ ...base, contextWindow: 200_000, history });

    expect(budget.outputReserve).toBe(16_384);
    expect(budget.systemTokens).toBe(1_000);
    expect(budget.promptTokens).toBe(100);
    expect(budget.history).toEqual(history);
    expect(budget.droppedHistory).toBe(0);
  });

  it('reserves a quarter of a small window for the reply', () => {
    expect(planContextBudget({ ...base, contextWindow: 8_192, history: [] }).outputReserve).toBe(
      2_048,
    );
  });

  it('drops the oldest history that does not fit and starts at a user message', () => {
    // 8,192 - 2,048 reserve - 1,101 fixed (system, empty tool list, prompt) leaves 5,043 tokens.
    const history = [user(8_000), assistant(8_000), user(8_000), assistant(8_000)];
    const budget = planContextBudget({ ...base, contextWindow: 8_192, history });

    expect(budget.history).toEqual(history.slice(2));
    expect(budget.historyTokens).toBe(4_000);
    expect(budget.droppedHistory).toBe(2);
  });

  it('drops a leading assistant message left by the cut', () => {
    // 3,000 tokens of history fit: the last assistant and user messages plus
    // the assistant before them, which cannot open the history.
    const history = [user(4_000), assistant(4_000), user(4_000), assistant(4_000)];
    const budget = planContextBudget({ ...base, contextWindow: 5_600, history });

    expect(budget.history).toEqual(history.slice(2));
    expect(budget.droppedHistory).toBe(2);
  });

  it('counts prompt images and fails before the request when the fixed parts do not fit', () => {
    expect(() =>
      planContextBudget({ ...base, contextWindow: 4_096, promptImages: 2, history: [] }),
    ).toThrow(
      expect.objectContaining({
        code: 'GENERATION_CONTEXT_EXCEEDED',
        message:
          "This run needs about 3501 tokens before any chat history, plus 1024 for the reply, but the model's context window is 4096 tokens.",
      }),
    );
  });
});
