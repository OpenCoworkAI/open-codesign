/**
 * tweaks — cross-file EDITMODE aggregator.
 *
 * As workspaces grow to hold multiple source files (jsx, css, html split by
 * concern), the agent needs a way to register tweakable values scattered
 * across several files. This tool wraps two pure helpers:
 *
 *   - `parseTweakBlocks(files)` — strips non-EDITMODE files, returns per-file
 *     token bags.
 *   - `aggregateTweaks(files)` — flattens into `{file, key, value}` triples for
 *     hosts that prefer a table over nested maps.
 *
 * This tool is advisory. The renderer parses its active source independently;
 * scanner results neither register controls nor bind values to the preview.
 */

import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import {
  type EditmodeTokens,
  type EditmodeTokenValue,
  inspectTweakSource,
  parseEditmodeBlock,
} from '@open-codesign/shared';
import { Type } from '@sinclair/typebox';

export interface TweakFileInput {
  file: string;
  contents: string;
}

export interface TweakBlock {
  file: string;
  tokens: EditmodeTokens;
}

export interface TweakEntry {
  file: string;
  key: string;
  value: EditmodeTokenValue;
}

export interface TweaksDetails {
  blocks: TweakBlock[];
  fileCount: number;
  scannedFileCount: number;
  missingFiles: string[];
  invalidFiles: { file: string; error: string }[];
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
      'Inspect existing EDITMODE declarations across workspace files. This read-only scan does not create controls, persist declarations, or connect bindings. The renderer reads only its active preview source; controls in unused starters do not affect it. Prefer patterns targeting the implemented preview entry when verifying controls. Call when tweak controls are enabled or useful. Defaults to html/jsx/css/js.',
    parameters: TweaksParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<TweaksDetails>> {
      const patterns = params.patterns ?? DEFAULT_PATTERNS;
      const files = await readWorkspaceFiles(patterns);
      if (files.length === 0) {
        return {
          content: [{ type: 'text', text: 'no files matched' }],
          details: {
            blocks: [],
            fileCount: 0,
            scannedFileCount: 0,
            missingFiles: [],
            invalidFiles: [],
          },
        };
      }
      const blocks: TweakBlock[] = [];
      const missingFiles: string[] = [];
      const invalidFiles: { file: string; error: string }[] = [];
      for (const { file, contents } of files) {
        const declaration = inspectTweakSource(contents);
        if (declaration.status === 'invalid') invalidFiles.push({ file, error: declaration.error });
        else if (!declaration.block) missingFiles.push(file);
        else blocks.push({ file, tokens: declaration.block.tokens });
      }
      const totalKeys = blocks.reduce((sum, b) => sum + Object.keys(b.tokens).length, 0);
      const details: TweaksDetails = {
        blocks,
        fileCount: blocks.length,
        scannedFileCount: files.length,
        missingFiles,
        invalidFiles,
      };
      return {
        content: [
          {
            type: 'text',
            text: `scanned ${files.length} file(s); found ${totalKeys} declared value(s) across ${blocks.length} file(s)${
              blocks.length > 0
                ? `: ${blocks.map((block) => block.file).join(', ')}`
                : '. No EDITMODE declarations found; this scan does not create controls'
            }. Missing declarations: ${missingFiles.join(', ') || 'none'}. Invalid declarations: ${
              invalidFiles.map(({ file, error }) => `${file}: ${error}`).join('; ') || 'none'
            }. The panel reads the active preview source; verify its rendered bindings separately.`,
          },
        ],
        details,
      };
    },
  };
}
