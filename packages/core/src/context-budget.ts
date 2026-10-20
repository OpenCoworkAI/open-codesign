import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { estimateTokens } from '@mariozechner/pi-coding-agent';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';

/** pi's estimate for one image (`estimateTokens` counts images in tool results as 1,200 tokens). */
const IMAGE_TOKENS = 1_200;

export interface ContextBudgetInput {
  contextWindow: number;
  /** The most output the run requests from the model. */
  maxOutputTokens: number;
  systemPrompt: string;
  tools: ReadonlyArray<{ name: string; description: string; parameters: unknown }>;
  /** The run's user message, which also carries the brief, memory and attachments as text. */
  prompt: string;
  promptImages: number;
  history: AgentMessage[];
}

export interface ContextBudget {
  contextWindow: number;
  outputReserve: number;
  systemTokens: number;
  toolTokens: number;
  promptTokens: number;
  historyTokens: number;
  history: AgentMessage[];
  droppedHistory: number;
}

/**
 * Fits a run into the model's context window, in tokens estimated the way pi
 * does (characters / 4). A quarter of the window, at most the requested
 * output, stays free for the reply. The system prompt, tool definitions and
 * prompt must fit, or the run fails before the request; history keeps its
 * newest messages that fit what remains, starting at a user message.
 */
export function planContextBudget(input: ContextBudgetInput): ContextBudget {
  const outputReserve = Math.min(input.maxOutputTokens, Math.floor(input.contextWindow / 4));
  const systemTokens = Math.ceil(input.systemPrompt.length / 4);
  const toolTokens = Math.ceil(
    JSON.stringify(
      input.tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
    ).length / 4,
  );
  const promptTokens =
    estimateTokens({ role: 'user', content: input.prompt, timestamp: 0 }) +
    input.promptImages * IMAGE_TOKENS;
  const fixedTokens = systemTokens + toolTokens + promptTokens;
  const available = input.contextWindow - outputReserve - fixedTokens;
  if (available < 0) {
    throw new CodesignError(
      `This run needs about ${fixedTokens} tokens before any chat history, plus ${outputReserve} for the reply, but the model's context window is ${input.contextWindow} tokens.`,
      ERROR_CODES.GENERATION_CONTEXT_EXCEEDED,
    );
  }

  let start = input.history.length;
  let historyTokens = 0;
  while (start > 0) {
    const tokens = estimateTokens(input.history[start - 1] as AgentMessage);
    if (historyTokens + tokens > available) break;
    historyTokens += tokens;
    start -= 1;
  }
  while (start < input.history.length && input.history[start]?.role !== 'user') {
    historyTokens -= estimateTokens(input.history[start] as AgentMessage);
    start += 1;
  }
  const history = input.history.slice(start);
  return {
    contextWindow: input.contextWindow,
    outputReserve,
    systemTokens,
    toolTokens,
    promptTokens,
    historyTokens,
    history,
    droppedHistory: start,
  };
}
