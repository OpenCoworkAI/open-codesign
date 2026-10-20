import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';

import {
  type InspectWorkspaceFn,
  summarizeWorkspaceInspection,
  type WorkspaceInspection,
} from '../workspace-inspection';

export * from '../workspace-inspection';

const InspectWorkspaceParams = Type.Object({});

export function makeInspectWorkspaceTool(
  inspectWorkspace: InspectWorkspaceFn,
): AgentTool<typeof InspectWorkspaceParams, WorkspaceInspection> {
  return {
    name: 'inspect_workspace',
    label: 'Inspect workspace',
    description:
      'Inspect the current design workspace and return a bounded inventory: entry candidates, source files, style files, DESIGN.md/AGENTS.md docs, reference docs, assets, total file count, and truncation status. Call before editing when the workspace already contains files or reference materials.',
    parameters: InspectWorkspaceParams,
    async execute(_toolCallId): Promise<AgentToolResult<WorkspaceInspection>> {
      const result = await inspectWorkspace();
      return {
        content: [
          {
            type: 'text',
            text: summarizeWorkspaceInspection(result),
          },
        ],
        details: result,
      };
    },
  };
}
