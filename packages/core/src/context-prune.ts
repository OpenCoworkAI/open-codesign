/**
 * Per-message size-based context compaction for pi-agent-core's
 * `transformContext` hook. Runs before every LLM call.
 *
 * Philosophy: **history is intent tracking, not payload storage.** The model
 * needs the decision trail — which tools, in what order, with what shape —
 * not verbatim 9 MB artifact dumps or whole-file view returns from ten turns
 * ago. Current file state is always recoverable via ranged `view()`.
 *
 * Evolution:
 *   - v1 (window): kept last N turns verbatim, stubbed older. Missed the
 *     dominant failure mode — a 9 MB `<artifact>` text dump sat inside the
 *     keep-verbatim window and shipped 3.97 M tokens.
 *   - v2 (windowless): stubbed every block over its cap regardless of
 *     position. Safe, but over-aggressive after the prompt OVERRIDE block
 *     eliminated the text-dump vector — the model's own latest str_replace
 *     new_str got summarized, so picking the next old_str required guessing.
 *   - v3 (this file): split behavior by block type.
 *        · `assistant.content[*].text` is always capped (8 KB, all turns).
 *          This is the regression guard: the one class of block that must
 *          never be allowed to balloon, because a bad prompt interaction
 *          can resurrect the `<artifact>` dump.
 *        · `assistant.content[*].toolCall.input` and
 *          `toolResult.content[*].text` are capped only outside a small
 *          recent-turn window. Inside the window they stay verbatim so the
 *          model reads its own just-written section and the latest view()
 *          output in full fidelity. Outside the window, large payloads
 *          collapse to a one-line stub.
 *
 * Block-level caps:
 *   - TEXT_BLOCK_LIMIT     — assistant prose, ALL turns.
 *   - TOOL_INPUT_LIMIT     — assistant.toolCall.input, older turns only.
 *   - TOOL_RESULT_LIMIT    — toolResult.text, older turns only.
 *
 * Stub format carries bytes + a short preview so the model can tell what
 * got dropped, and (for tool calls) keeps tool NAME + id so pi-ai's shape
 * validation remains happy.
 *
 * Safety net: after per-block stubbing, if the grand total still exceeds
 * `HARD_CAP_BYTES`, we shrink caps further (including within the window)
 * and re-run. Catches pathological runs with many just-under-threshold
 * blocks.
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { type CoreLogger, NOOP_LOGGER } from './logger.js';

const TEXT_BLOCK_LIMIT = 8 * 1024;
const TOOL_INPUT_LIMIT = 24 * 1024;
const TOOL_RESULT_LIMIT = 8 * 1024;
const HARD_CAP_BYTES = 200_000;
const AGGRESSIVE_BLOCK_LIMIT = 2 * 1024;

/**
 * Number of most-recent non-user messages whose tool payloads (toolCall.input
 * and toolResult.text) stay verbatim. Assistant TEXT is still capped inside
 * this window — see TEXT_BLOCK_LIMIT rationale above.
 *
 * 3 covers "current turn is reading the previous turn's str_replace + its
 * toolResult" in the typical one-section-per-turn polish cadence.
 */
const RECENT_WINDOW = 3;

function estimateBytes(messages: AgentMessage[]): number {
  let total = 0;
  for (const m of messages) {
    try {
      total += JSON.stringify(m).length;
    } catch {
      /* circular or unserializable — ignore */
    }
  }
  return total;
}

function preview(text: string): string {
  const firstLine = text.split('\n')[0] ?? '';
  return firstLine.slice(0, 80);
}

function stubText(text: string, label: string): string {
  return `[${label} — ${text.length}B, head: "${preview(text)}"]`;
}

function compactAssistant(
  m: AgentMessage,
  textLimit: number,
  toolLimit: number | null,
): AgentMessage {
  const original = m as unknown as {
    role: 'assistant';
    content?: Array<Record<string, unknown>>;
  };
  if (!Array.isArray(original.content)) return m;
  let changed = false;
  const nextContent = original.content.map((block) => {
    const type = block?.['type'];
    if (type === 'text') {
      const text = typeof block['text'] === 'string' ? (block['text'] as string) : '';
      if (text.length <= textLimit) return block;
      changed = true;
      return { ...block, text: stubText(text, 'prior assistant output dropped') };
    }
    if (type === 'toolCall' && toolLimit !== null) {
      const input = block['input'];
      let origBytes = 0;
      let preview = '';
      try {
        const serialized = JSON.stringify(input ?? null);
        origBytes = serialized.length;
        preview = serialized.slice(0, 80);
      } catch {
        /* ignore */
      }
      if (origBytes <= toolLimit) return block;
      changed = true;
      return {
        ...block,
        input: { _summarized: true, _origBytes: origBytes, _preview: preview },
      };
    }
    return block;
  });
  if (!changed) return m;
  return { ...(original as object), content: nextContent } as unknown as AgentMessage;
}

function compactToolResult(m: AgentMessage, limit: number | null): AgentMessage {
  if (limit === null) return m;
  const original = m as unknown as {
    role: 'toolResult';
    content?: Array<{ type: string; text?: string }>;
  };
  if (!Array.isArray(original.content)) return m;
  let changed = false;
  const nextContent = original.content.map((block) => {
    if (block?.type !== 'text') return block;
    const text = typeof block.text === 'string' ? block.text : '';
    if (text.length <= limit) return block;
    changed = true;
    return { ...block, text: stubText(text, 'tool result dropped — use view() for current state') };
  });
  if (!changed) return m;
  return { ...(original as object), content: nextContent } as unknown as AgentMessage;
}

/**
 * Index threshold (inclusive) — messages at or after this index are "recent"
 * and their tool payloads stay verbatim. Counts assistant + toolResult roles
 * from the tail; user messages are never a prune target but also don't
 * consume window slots.
 */
function computeWindowStart(messages: AgentMessage[], windowTurns: number): number {
  if (windowTurns <= 0) return messages.length;
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const role = messages[i]?.role;
    if (role === 'assistant' || role === 'toolResult') {
      seen += 1;
      if (seen >= windowTurns) return i;
    }
  }
  return 0;
}

interface CapConfig {
  textLimit: number;
  toolInputLimitOld: number;
  toolResultLimitOld: number;
  toolInputLimitRecent: number | null;
  toolResultLimitRecent: number | null;
  windowTurns: number;
}

function applyCaps(messages: AgentMessage[], cfg: CapConfig): AgentMessage[] {
  const windowStart = computeWindowStart(messages, cfg.windowTurns);
  return messages.map((m, idx) => {
    const isRecent = idx >= windowStart;
    if (m.role === 'assistant') {
      return compactAssistant(
        m,
        cfg.textLimit,
        isRecent ? cfg.toolInputLimitRecent : cfg.toolInputLimitOld,
      );
    }
    if (m.role === 'toolResult') {
      return compactToolResult(m, isRecent ? cfg.toolResultLimitRecent : cfg.toolResultLimitOld);
    }
    return m;
  });
}

export function buildTransformContext(
  log: CoreLogger = NOOP_LOGGER,
): (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]> {
  return async (messages) => {
    if (messages.length === 0) return messages;

    const before = estimateBytes(messages);
    const first = applyCaps(messages, {
      textLimit: TEXT_BLOCK_LIMIT,
      toolInputLimitOld: TOOL_INPUT_LIMIT,
      toolResultLimitOld: TOOL_RESULT_LIMIT,
      toolInputLimitRecent: null,
      toolResultLimitRecent: null,
      windowTurns: RECENT_WINDOW,
    });
    const firstSize = estimateBytes(first);

    log.info('[context-prune] step=caps', {
      messages: messages.length,
      before,
      after: firstSize,
      textLimit: TEXT_BLOCK_LIMIT,
      toolInputLimit: TOOL_INPUT_LIMIT,
      toolResultLimit: TOOL_RESULT_LIMIT,
      window: RECENT_WINDOW,
    });

    if (firstSize <= HARD_CAP_BYTES) return first;

    const aggressive = applyCaps(messages, {
      textLimit: AGGRESSIVE_BLOCK_LIMIT,
      toolInputLimitOld: AGGRESSIVE_BLOCK_LIMIT,
      toolResultLimitOld: AGGRESSIVE_BLOCK_LIMIT,
      toolInputLimitRecent: AGGRESSIVE_BLOCK_LIMIT,
      toolResultLimitRecent: AGGRESSIVE_BLOCK_LIMIT,
      windowTurns: 0,
    });
    const aggressiveSize = estimateBytes(aggressive);
    log.info('[context-prune] step=aggressive', {
      messages: messages.length,
      before,
      first: firstSize,
      after: aggressiveSize,
      blockLimit: AGGRESSIVE_BLOCK_LIMIT,
    });
    return aggressive;
  };
}
