import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { extractFromCssVars, extractFromTailwindConfig, importDtcgJson } from '@open-codesign/core';
import type { DesignToken } from '@open-codesign/shared';
import { IGNORED_DIRS } from './design-system';

export interface TokenScanLimits {
  /** Directories below the picked folder that are entered. */
  maxDepth: number;
  /** Files looked at before the walk stops. */
  maxFiles: number;
  /** Largest source file that is read. */
  maxFileBytes: number;
}

export const DEFAULT_TOKEN_SCAN_LIMITS: TokenScanLimits = {
  maxDepth: 6,
  maxFiles: 10_000,
  maxFileBytes: 256_000,
};

export type TokenSourceKind = 'tailwind-config' | 'css' | 'dtcg-json';

export interface TokenSource {
  kind: TokenSourceKind;
  /** Path relative to the picked folder, with `/` separators. */
  path: string;
  tokens: DesignToken[];
}

export interface SkippedTokenSource {
  path: string;
  reason: 'too-large' | 'invalid-json';
}

export interface TokenScan {
  sources: TokenSource[];
  skipped: SkippedTokenSource[];
  /** True when the walk stopped at `maxFiles`, so later files were not looked at. */
  truncated: boolean;
}

const TAILWIND_CONFIG = /^tailwind\.config\.(?:js|cjs|mjs|ts)$/;
const DTCG_FILE = /(?:^|\.)tokens\.json$/;
const CSS_ROOT_BLOCK = /:root|\[data-theme/;
const CSS_THEME_BLOCK = /@theme\b/;

function sourceKind(fileName: string): TokenSourceKind | null {
  if (TAILWIND_CONFIG.test(fileName)) return 'tailwind-config';
  if (DTCG_FILE.test(fileName)) return 'dtcg-json';
  if (fileName.endsWith('.css')) return 'css';
  return null;
}

interface Candidate {
  file: string;
  kind: TokenSourceKind;
}

interface Walk {
  candidates: Candidate[];
  visited: number;
  truncated: boolean;
}

// Directory entries from readdir are not followed through symlinks: a link is
// neither isDirectory() nor isFile(), so the scan stays inside the picked folder.
async function walk(
  dir: string,
  depth: number,
  limits: TokenScanLimits,
  state: Walk,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (state.truncated) return;
    if (entry.isDirectory()) {
      if (depth < limits.maxDepth && !IGNORED_DIRS.has(entry.name)) {
        await walk(join(dir, entry.name), depth + 1, limits, state);
      }
    } else if (entry.isFile()) {
      if (state.visited >= limits.maxFiles) {
        state.truncated = true;
        return;
      }
      state.visited += 1;
      const kind = sourceKind(entry.name);
      if (kind !== null) state.candidates.push({ file: join(dir, entry.name), kind });
    }
  }
}

async function readTokens(
  file: string,
  kind: TokenSourceKind,
): Promise<DesignToken[] | 'invalid-json'> {
  if (kind === 'tailwind-config') return extractFromTailwindConfig(file);
  if (kind === 'dtcg-json') {
    // importDtcgJson accepts any parsed value, so only malformed JSON marks a bad file.
    // Read errors propagate instead of being reported as a skipped file.
    try {
      return importDtcgJson(JSON.parse(await readFile(file, 'utf-8')));
    } catch (error) {
      if (error instanceof SyntaxError) return 'invalid-json';
      throw error;
    }
  }
  const css = await readFile(file, 'utf-8');
  const tokens: DesignToken[] = [];
  if (CSS_THEME_BLOCK.test(css)) tokens.push(...(await extractFromTailwindConfig(file)));
  if (CSS_ROOT_BLOCK.test(css)) tokens.push(...(await extractFromCssVars(file)));
  return tokens;
}

/**
 * Finds the files under `rootPath` that carry design tokens (a Tailwind config,
 * CSS with `:root`, `[data-theme]` or `@theme` blocks, DTCG JSON) and extracts
 * them. Files are read as text and never executed.
 */
export async function scanTokenSources(
  rootPath: string,
  limits: TokenScanLimits = DEFAULT_TOKEN_SCAN_LIMITS,
): Promise<TokenScan> {
  const state: Walk = { candidates: [], visited: 0, truncated: false };
  await walk(rootPath, 0, limits, state);

  const sources: TokenSource[] = [];
  const skipped: SkippedTokenSource[] = [];
  for (const { file, kind } of state.candidates) {
    const path = relative(rootPath, file).split(sep).join('/');
    if ((await stat(file)).size > limits.maxFileBytes) {
      skipped.push({ path, reason: 'too-large' });
      continue;
    }
    const tokens = await readTokens(file, kind);
    if (tokens === 'invalid-json') skipped.push({ path, reason: 'invalid-json' });
    else if (tokens.length > 0) sources.push({ kind, path, tokens });
  }
  return { sources, skipped, truncated: state.truncated };
}
