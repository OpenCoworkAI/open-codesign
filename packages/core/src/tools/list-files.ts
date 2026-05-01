/**
 * list_files -- show the agent the contents of its virtual FS so it can
 * decide what to view/edit next without guessing at filenames.
 */

import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import type { TextEditorFsCallbacks } from './text-editor.js';

const ListFilesParams = Type.Object({
  dir: Type.Optional(Type.String()),
});

export interface ListFilesDetails {
  dir: string;
  entries: string[];
}

export function makeListFilesTool(
  fs: TextEditorFsCallbacks,
): AgentTool<typeof ListFilesParams, ListFilesDetails> {
  return {
    name: 'list_files',
    label: 'List files',
    description:
      'List files in the design virtual filesystem, recursively. Pass an ' +
      'optional `dir` (defaults to the design root). Returns every file path ' +
      'under that directory, one per line, sorted -- not just the first level. ' +
      'Call this once at the start of a turn to see the whole project tree ' +
      'instead of recursing one directory at a time.',
    parameters: ListFilesParams,
    async execute(_id, params): Promise<AgentToolResult<ListFilesDetails>> {
      const dir = (params.dir ?? '').replace(/^\/+|\/+$/g, '');
      const entries = fs.listDir(dir);
      const text = entries.length === 0 ? '(empty)' : entries.join('\n');
      return { content: [{ type: 'text', text }], details: { dir, entries } };
    },
  };
}
