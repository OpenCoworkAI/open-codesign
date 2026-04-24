/**
 * set_title — write a short human-readable name for the current design.
 *
 * Agent calls this once after step 1 (Understand) so the sidebar /
 * history shows a meaningful title instead of "暂无设计". Each call
 * REPLACES the previous title. The tool itself has no direct side
 * effects on the session JSONL — it surfaces through the
 * `tool_execution_start` event so main-process listeners can persist
 * the title to wherever designs are indexed (SessionManager label,
 * designs table, renderer store).
 *
 * Schema: single `title` string, ≤ 60 chars, ≤ 8 words. Trailing
 * punctuation is stripped before the event fires.
 */

import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';

const SetTitleParams = Type.Object({
  title: Type.String({
    minLength: 1,
    maxLength: 60,
    description:
      'Short descriptive name for this design, max 8 words. Example: "Surf Retreat Landing Page".',
  }),
});

export interface SetTitleDetails {
  title: string;
}

export function normalizeTitle(raw: string): string {
  return raw.replace(/[\s.,;:!?—–\-]+$/u, '').trim();
}

export function makeSetTitleTool(): AgentTool<typeof SetTitleParams, SetTitleDetails> {
  return {
    name: 'set_title',
    label: 'Title',
    description:
      'Set a short human-readable title for this design. Call ONCE after ' +
      'the Understand step, with ≤ 8 words describing the deliverable ' +
      '("Surf Retreat Landing Page", not "a page"). Each call replaces the ' +
      'previous title. Do not call again unless the user pivots to a new ' +
      'artifact type.',
    parameters: SetTitleParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<SetTitleDetails>> {
      const title = normalizeTitle(params.title);
      return {
        content: [{ type: 'text', text: `Title set: ${title}` }],
        details: { title },
      };
    },
  };
}
