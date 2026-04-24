/**
 * Phase 2 — text_editor tool wired to the design_files virtual FS.
 *
 * Mirrors Anthropic's native `str_replace_based_edit_tool` shape so Claude
 * models recognize it without extra schema training. Other models that
 * support the OpenAI tool-call format see it as a regular custom tool.
 *
 * Tool implementation lives in `apps/desktop/src/main` (this file imports
 * the virtual-FS callbacks indirectly via dependency injection — the core
 * package must NOT depend on apps/desktop).
 */

import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';

export interface TextEditorFsCallbacks {
  view(path: string): { content: string; numLines: number } | null;
  create(path: string, content: string): Promise<{ path: string }> | { path: string };
  strReplace(
    path: string,
    oldStr: string,
    newStr: string,
  ): Promise<{ path: string }> | { path: string };
  insert(path: string, line: number, text: string): Promise<{ path: string }> | { path: string };
  /** Optional: list files for `view` on a directory. Returns sorted paths. */
  listDir(dir: string): string[];
}

const TextEditorParams = Type.Object({
  command: Type.Union([
    Type.Literal('view'),
    Type.Literal('create'),
    Type.Literal('str_replace'),
    Type.Literal('insert'),
  ]),
  path: Type.String(),
  file_text: Type.Optional(Type.String()),
  old_str: Type.Optional(Type.String()),
  new_str: Type.Optional(Type.String()),
  insert_line: Type.Optional(Type.Number()),
  /** Optional `[startLine, endLine]` (1-indexed, inclusive) to narrow a view
   *  to a specific range instead of dumping the whole file. Either bound may
   *  be -1 to mean "end of file". Only valid with `command: 'view'`. Declared
   *  as a fixed-length number array (min/max = 2) because `Type.Tuple` emits
   *  legacy `items: [...]` which Anthropic's draft 2020-12 validator rejects. */
  view_range: Type.Optional(Type.Array(Type.Number(), { minItems: 2, maxItems: 2 })),
});

export interface TextEditorDetails {
  command: 'view' | 'create' | 'str_replace' | 'insert';
  path: string;
  result?: unknown;
}

function ok(text: string, details: TextEditorDetails): AgentToolResult<TextEditorDetails> {
  return {
    content: [{ type: 'text', text }],
    details,
  };
}

export function makeTextEditorTool(
  fs: TextEditorFsCallbacks,
): AgentTool<typeof TextEditorParams, TextEditorDetails> {
  // Per-run view budget: the full content of a file is returned on the FIRST
  // view of each path; subsequent views collapse to a short summary (line
  // count + head snippet + explicit reminder). Rationale: view accumulates in
  // the agent's context window — re-viewing a 2000-line index.html four times
  // has blown the 1M-token limit in production. AGENTIC_TOOL_GUIDANCE already
  // asks the agent to "view once, then work from memory"; this enforces it.
  const viewCountByPath = new Map<string, number>();

  return {
    name: 'str_replace_based_edit_tool',
    label: 'Text editor',
    description:
      'Read and edit files in the current design via view/create/str_replace/insert commands. ' +
      'Paths are relative to the design root (e.g. "index.html", "_starters/ios-frame.jsx"). ' +
      'Use create for new files; str_replace requires an exact match of old_str; ' +
      'view returns file content or directory listing. ' +
      'IMPORTANT: pass `view_range: [startLine, endLine]` (1-indexed, inclusive; either bound may be -1 for EOF) ' +
      'to read only a slice of the file — strongly preferred over full-file views after the file has grown past ~100 lines. ' +
      'Without view_range, repeated `view` of the same path within a single run returns only a short summary to protect context.',
    parameters: TextEditorParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<TextEditorDetails>> {
      const path = params.path;
      switch (params.command) {
        case 'view': {
          const file = fs.view(path);
          if (file !== null) {
            // Range view — narrow, always fresh, never capped. Agent should
            // prefer this after the first orientation read.
            if (params.view_range) {
              const [rawStart, rawEnd] = params.view_range;
              if (typeof rawStart !== 'number' || typeof rawEnd !== 'number') {
                throw new Error('view_range must be [startLine, endLine] as two numbers');
              }
              const lines = file.content.split('\n');
              const start = Math.max(1, Math.floor(rawStart));
              const end = rawEnd === -1 ? lines.length : Math.max(start, Math.floor(rawEnd));
              const clampedEnd = Math.min(end, lines.length);
              const slice = lines
                .slice(start - 1, clampedEnd)
                .map((ln, i) => `${String(start + i).padStart(4, ' ')}  ${ln}`)
                .join('\n');
              const header = `${path} · lines ${start}-${clampedEnd} of ${lines.length}\n`;
              return ok(header + slice, {
                command: 'view',
                path,
                result: { numLines: file.numLines, viewRange: [start, clampedEnd] },
              });
            }
            const count = (viewCountByPath.get(path) ?? 0) + 1;
            viewCountByPath.set(path, count);
            if (count === 1) {
              return ok(file.content, {
                command: 'view',
                path,
                result: { numLines: file.numLines },
              });
            }
            // Second+ full-file view: return a tight summary. Agent should
            // switch to view_range for narrow inspections.
            const head = file.content.slice(0, 400);
            const ellipsis = file.content.length > 400 ? '…' : '';
            const summary = `${path} (already viewed ${count - 1} time(s) in this run — ${file.numLines} lines total)\n\nFirst 400 chars for orientation:\n${head}${ellipsis}\n\nTo see a specific region, re-issue view with \`view_range: [startLine, endLine]\` (1-indexed). Full-file re-views are disabled for the rest of this run to keep context from blowing up.`;
            return ok(summary, {
              command: 'view',
              path,
              result: { numLines: file.numLines, summarized: true },
            });
          }
          // Treat as directory if no file matches
          const entries = fs.listDir(path);
          if (entries.length === 0) {
            throw new Error(`Path not found: ${path}`);
          }
          return ok(entries.join('\n'), { command: 'view', path, result: { entries } });
        }
        case 'create': {
          const text = params.file_text ?? '';
          const result = await fs.create(path, text);
          return ok(`Created ${result.path}`, { command: 'create', path, result });
        }
        case 'str_replace': {
          const oldStr = params.old_str ?? '';
          const newStr = params.new_str ?? '';
          if (oldStr.length === 0) throw new Error('str_replace requires non-empty old_str');
          const result = await fs.strReplace(path, oldStr, newStr);
          return ok(`Edited ${result.path}`, { command: 'str_replace', path, result });
        }
        case 'insert': {
          const line = params.insert_line ?? 0;
          const text = params.new_str ?? '';
          const result = await fs.insert(path, line, text);
          return ok(`Inserted at ${result.path}:${line}`, { command: 'insert', path, result });
        }
      }
    },
  };
}
