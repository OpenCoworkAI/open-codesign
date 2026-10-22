/**
 * set_todos — UI-only progress tool.
 *
 * The agent calls this to publish a running checklist: each call REPLACES
 * the previous list. The tool has no side effects on the file system or
 * artifact; it simply surfaces through `tool_execution_start` events so
 * the sidebar renders a ToolCard with `variant: 'todos'` and a checkbox
 * list. Pair with `str_replace_based_edit_tool` so the user can watch
 * the plan tick off as the agent edits files.
 *
 * Schema intentionally mirrors what the renderer's ChatMessageList
 * already consumes (`args.items: Array<{text, checked}>`).
 */

import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

const SetTodosParams = Type.Object({
  items: Type.Array(
    Type.Object({
      text: Type.String(),
      checked: Type.Boolean(),
    }),
  ),
});

export interface SetTodosDetails {
  items: Array<{ text: string; checked: boolean }>;
}

export function makeSetTodosTool(): AgentTool<typeof SetTodosParams, SetTodosDetails> {
  return {
    name: 'set_todos',
    label: 'Todos',
    description:
      'Publish or update a short checklist describing the plan for this turn. ' +
      'Each call REPLACES the previous list. Keep items under 8 words. ' +
      'Mark items checked as they complete. Use BEFORE making substantive edits ' +
      'so the user can see the plan, and again when steps finish.',
    parameters: SetTodosParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<SetTodosDetails>> {
      const items = params.items ?? [];
      const text =
        items.length === 0
          ? 'Todo list cleared.'
          : items.map((t) => `${t.checked ? '[x]' : '[ ]'} ${t.text}`).join('\n');
      return {
        content: [{ type: 'text', text }],
        details: { items },
      };
    },
  };
}
