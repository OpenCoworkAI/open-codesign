/**
 * Sliding-window context compaction for pi-agent-core's `transformContext`
 * hook. Invoked before every LLM call to keep the message array from growing
 * unboundedly.
 *
 * Two bulk sources dominate context growth in a long tool-using run:
 *   - `toolResult.content` — view returns of the whole file (15-100 KB each),
 *     tool result payloads from read_url / done / etc.
 *   - `assistant.toolCall.input` — str_replace old_str / new_str for every
 *     section edit (2-5 KB each, 30+ edits per run = 100+ KB). The model's
 *     own output, carried forward across every subsequent LLM call.
 *
 * Conservative v1 only stubbed toolResult content (safer — keeps the model's
 * self-history intact) but the production 4M-token failure showed that is
 * not enough. v2 now compacts BOTH:
 *   - toolResult rows older than WINDOW_KEEP rounds → content replaced with
 *     a one-line stub that preserves toolCallId pairing.
 *   - assistant.toolCall.input older than WINDOW_KEEP rounds → args replaced
 *     with `{_summarized: true, _origBytes: N}`. The tool name + id stay
 *     intact so pi-ai's tool-use shape validation is happy; the large
 *     old_str/new_str payload is discarded.
 *
 * We keep the tool NAME on compacted toolCalls so the model can still see
 * "earlier in this run I did str_replace on index.html 10 times" when
 * reasoning about what's been done.
 *
 * User messages and assistant-text-only messages always pass through
 * unchanged (no loss of user intent or agent commentary).
 *
 * Safety net: if the total estimated size still exceeds `HARD_CAP_BYTES`
 * after the conservative pass, tighten to WINDOW_KEEP_AGGRESSIVE rounds.
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core';

const WINDOW_KEEP = 6;
const WINDOW_KEEP_AGGRESSIVE = 3;
const HARD_CAP_BYTES = 200_000;

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

function isToolResult(m: AgentMessage): boolean {
  return m.role === 'toolResult';
}

function isAssistantWithToolCall(m: AgentMessage): boolean {
  if (m.role !== 'assistant') return false;
  const content = (m as { content?: Array<{ type?: string }> }).content;
  if (!Array.isArray(content)) return false;
  return content.some((c) => c?.type === 'toolCall');
}

/**
 * Count tool-use rounds (each round = one assistant message containing
 * ≥1 toolCall block). Returns the indices of each round's assistant message
 * in arrival order.
 */
function findToolUseRoundIndices(messages: AgentMessage[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (m && isAssistantWithToolCall(m)) out.push(i);
  }
  return out;
}

function stubToolResult(m: AgentMessage): AgentMessage {
  // Preserve the shape pi-agent-core / pi-ai need: role, matched toolCallId,
  // and a content array with at least one text block. Drop the bulky payload.
  const original = m as unknown as {
    role: 'toolResult';
    toolCallId?: string;
    content?: Array<{ type: string; text?: string }>;
  };
  const originalText = Array.isArray(original.content)
    ? (original.content.find((c) => c?.type === 'text')?.text ?? '')
    : '';
  const bytes = originalText.length;
  const firstLine = originalText.split('\n')[0]?.slice(0, 80) ?? '';
  const stub =
    bytes > 0 ? `[dropped — was ${bytes} bytes, first line: "${firstLine}"]` : '[dropped]';
  return {
    ...(original as object),
    role: 'toolResult',
    content: [{ type: 'text', text: stub }],
  } as unknown as AgentMessage;
}

/**
 * Shrink every `toolCall` block inside an assistant message. Name + id
 * stay so pi-ai's shape check (toolResult must match a prior toolCall id)
 * still passes; the `input` args get replaced with a tiny summary.
 */
function stubAssistantToolCalls(m: AgentMessage): AgentMessage {
  const original = m as unknown as {
    role: 'assistant';
    content?: Array<Record<string, unknown>>;
  };
  if (!Array.isArray(original.content)) return m;
  let changed = false;
  const nextContent = original.content.map((block) => {
    if (block?.['type'] !== 'toolCall') return block;
    const input = block['input'];
    let origBytes = 0;
    try {
      origBytes = JSON.stringify(input ?? null).length;
    } catch {
      /* ignore */
    }
    if (origBytes === 0) return block;
    changed = true;
    return {
      ...block,
      input: { _summarized: true, _origBytes: origBytes },
    };
  });
  if (!changed) return m;
  return { ...(original as object), content: nextContent } as unknown as AgentMessage;
}

function applyWindow(messages: AgentMessage[], keep: number): AgentMessage[] {
  const roundIdxs = findToolUseRoundIndices(messages);
  const firstKeptRoundIdx =
    roundIdxs.length > keep ? (roundIdxs[roundIdxs.length - keep] ?? 0) : 0;
  return messages.map((m, i) => {
    if (i >= firstKeptRoundIdx) return m; // inside the window — keep verbatim
    if (isToolResult(m)) return stubToolResult(m);
    if (isAssistantWithToolCall(m)) return stubAssistantToolCalls(m);
    return m; // user messages + assistant-text-only stay intact
  });
}

export function buildTransformContext(): (
  messages: AgentMessage[],
  signal?: AbortSignal,
) => Promise<AgentMessage[]> {
  return async (messages) => {
    if (messages.length === 0) return messages;

    const conservative = applyWindow(messages, WINDOW_KEEP);
    const conservativeSize = estimateBytes(conservative);

    // Telemetry — surfaces in the Electron main log so we can tell whether
    // the hook is actually firing and what size we are landing at per turn.
    if (typeof console !== 'undefined' && typeof console.log === 'function') {
      try {
        console.log(
          `[context-prune] messages=${messages.length} before=${estimateBytes(messages)}B ` +
            `after=${conservativeSize}B keep=${WINDOW_KEEP}`,
        );
      } catch {
        /* noop */
      }
    }

    if (conservativeSize <= HARD_CAP_BYTES) return conservative;

    const aggressive = applyWindow(messages, WINDOW_KEEP_AGGRESSIVE);
    if (typeof console !== 'undefined' && typeof console.log === 'function') {
      try {
        console.log(
          `[context-prune] aggressive fallback: size=${estimateBytes(aggressive)}B ` +
            `keep=${WINDOW_KEEP_AGGRESSIVE}`,
        );
      } catch {
        /* noop */
      }
    }
    return aggressive;
  };
}
