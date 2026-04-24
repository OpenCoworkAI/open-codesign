/**
 * tweaks — cross-file EDITMODE aggregator.
 *
 * v0.1 shipped a single-file `declare_tweak_schema` tool that only looked at
 * `index.html`. As workspaces grow to hold multiple source files (jsx, css,
 * html split by concern), the agent needs a way to register tweakable values
 * scattered across several files. This tool wraps two pure helpers:
 *
 *   - `parseTweakBlocks(files)` — strips non-EDITMODE files, returns per-file
 *     token bags.
 *   - `aggregateTweaks(files)` — flattens into `{file, key, value}` triples for
 *     hosts that prefer a table over nested maps.
 *
 * The legacy `declare_tweak_schema` tool stays in place and still governs
 * `TWEAK_SCHEMA` (control-hint) blocks. This tool is advisory: the renderer's
 * Tweaks panel uses its result to pre-populate controls so the user can nudge
 * values without re-prompting.
 */

import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { parseEditmodeBlock } from '@open-codesign/shared';
import { Type } from '@sinclair/typebox';

export interface TweakFileInput {
  file: string;
  contents: string;
}

export interface TweakBlock {
  file: string;
  tokens: Record<string, unknown>;
}

export interface TweakEntry {
  file: string;
  key: string;
  value: unknown;
}

export interface TweaksDetails {
  blocks: TweakBlock[];
  fileCount: number;
}

export function parseTweakBlocks(files: TweakFileInput[]): TweakBlock[] {
  const blocks: TweakBlock[] = [];
  for (const { file, contents } of files) {
    const parsed = parseEditmodeBlock(contents);
    if (!parsed) continue;
    blocks.push({ file, tokens: parsed.tokens });
  }
  return blocks;
}

export function aggregateTweaks(files: TweakFileInput[]): TweakEntry[] {
  const entries: TweakEntry[] = [];
  for (const block of parseTweakBlocks(files)) {
    for (const [key, value] of Object.entries(block.tokens)) {
      entries.push({ file: block.file, key, value });
    }
  }
  return entries;
}

const TweaksParams = Type.Object({
  patterns: Type.Optional(Type.Array(Type.String())),
});

const DEFAULT_PATTERNS = ['**/*.html', '**/*.jsx', '**/*.css', '**/*.js'];

export function makeTweaksTool(
  readWorkspaceFiles: (patterns?: string[]) => Promise<TweakFileInput[]>,
): AgentTool<typeof TweaksParams, TweaksDetails> {
  return {
    name: 'tweaks',
    label: 'Tweaks',
    description:
      "Scan the workspace for EDITMODE blocks across multiple files and return the aggregated tweakable key/value list. The renderer's tweaks panel uses this to let the user adjust values without re-prompting. Call AFTER scaffolding + writing initial code. Pattern array defaults to html/jsx/css/js.",
    parameters: TweaksParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<TweaksDetails>> {
      const patterns = params.patterns ?? DEFAULT_PATTERNS;
      const files = await readWorkspaceFiles(patterns);
      if (files.length === 0) {
        return {
          content: [{ type: 'text', text: 'no files matched' }],
          details: { blocks: [], fileCount: 0 },
        };
      }
      const blocks = parseTweakBlocks(files);
      const totalKeys = blocks.reduce((sum, b) => sum + Object.keys(b.tokens).length, 0);
      const details: TweaksDetails = { blocks, fileCount: blocks.length };
      return {
        content: [
          {
            type: 'text',
            text: `found ${totalKeys} tweakable value(s) across ${blocks.length} file(s)`,
          },
        ],
        details,
      };
    },
  };
}
