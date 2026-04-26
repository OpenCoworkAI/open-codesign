/**
 * verify-ui-kit-parity — agent tool that compares a decomposed
 * ui_kits/<slug>/ output against the source artifact and emits a
 * deterministic parity report (no LLM judge, no variance).
 *
 * Three signals, all computed from the raw HTML / CSS strings:
 *   1. Element count parity   — structural tag distribution
 *   2. Visible text coverage  — % of source words present in decomposed
 *   3. Token coverage         — % of source hex/px/rem values present in tokens.css
 *
 * The agent calls this after decompose_to_ui_kit. If parityScore < 0.85,
 * the prompt instructs the agent to re-call decompose_to_ui_kit with
 * adjustments that address the explicit `gaps` list.
 *
 * Pattern mirrors done.ts: a deterministic checker run during the agent's
 * own turn so it can self-correct before calling done.
 */

import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import { type CoreLogger, NOOP_LOGGER } from '../logger.js';
import type { TextEditorFsCallbacks } from './text-editor';

const VerifyParams = Type.Object({
  slug: Type.String(),
  sourcePath: Type.Optional(Type.String()),
});

export interface ParityGap {
  kind: 'element' | 'text' | 'token';
  message: string;
}

export interface ParityReport {
  parityScore: number;
  status: 'ok' | 'needs_iteration';
  signals: {
    elementCountParity: number;
    visibleTextCoverage: number;
    tokenCoverage: number;
  };
  counts: {
    sourceElements: number;
    decomposedElements: number;
    sourceWords: number;
    decomposedWordsMatched: number;
    sourceTokens: number;
    tokenCssMatched: number;
  };
  gaps: ParityGap[];
}

const PARITY_THRESHOLD = 0.85;
const STRUCTURAL_TAGS = [
  'div',
  'section',
  'article',
  'aside',
  'nav',
  'header',
  'footer',
  'main',
  'button',
  'input',
  'select',
  'textarea',
  'form',
  'a',
  'span',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'table',
  'tr',
  'td',
  'th',
  'thead',
  'tbody',
  'img',
  'svg',
  'label',
  'p',
] as const;

function countElements(html: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const tag of STRUCTURAL_TAGS) {
    const re = new RegExp(`<${tag}\\b`, 'gi');
    counts[tag] = (html.match(re) ?? []).length;
  }
  return counts;
}

function totalElementCount(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

function elementParityScore(
  source: Record<string, number>,
  decomposed: Record<string, number>,
): { score: number; gaps: ParityGap[] } {
  const gaps: ParityGap[] = [];
  let totalDelta = 0;
  let totalSource = 0;
  for (const tag of STRUCTURAL_TAGS) {
    const s = source[tag] ?? 0;
    const d = decomposed[tag] ?? 0;
    const delta = Math.abs(s - d);
    totalDelta += delta;
    totalSource += s;
    if (s > 0 && delta / Math.max(s, 1) > 0.5) {
      gaps.push({
        kind: 'element',
        message: `${s} <${tag}> in source, ${d} in decomposed (delta ${delta})`,
      });
    }
  }
  if (totalSource === 0) return { score: 1, gaps };
  const score = Math.max(0, 1 - totalDelta / totalSource);
  return { score, gaps };
}

function stripTags(html: string): string {
  // Close-tag patterns mirror the opening pattern's `\b[^>]*` so we strip
  // the full `<script>...</script foo="bar" >` form. HTML5 parsers tolerate
  // attributes and trailing whitespace inside end tags (silently ignored)
  // and CodeQL's "Bad HTML filtering regexp" rule flags the literal
  // `</script>` form because it leaves bodies behind for `</script >` etc.
  // The `\b` after the tag name prevents over-matching like `</scripts>`.
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function visibleWords(html: string): Set<string> {
  const text = stripTags(html).toLowerCase();
  const words = text.match(/[a-z][a-z0-9]{2,}/g) ?? [];
  return new Set(words);
}

function textCoverage(
  sourceWords: Set<string>,
  decomposedWords: Set<string>,
): { score: number; matched: number } {
  if (sourceWords.size === 0) return { score: 1, matched: 0 };
  let matched = 0;
  for (const w of sourceWords) {
    if (decomposedWords.has(w)) matched += 1;
  }
  return { score: matched / sourceWords.size, matched };
}

function extractTokenValues(text: string): Set<string> {
  const values = new Set<string>();
  // Hex colors (#fff, #ffffff, #ffffffff)
  for (const m of text.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
    values.add(m.toLowerCase());
  }
  // rgb / rgba
  for (const m of text.match(/rgba?\([^)]+\)/g) ?? []) {
    values.add(m.replace(/\s+/g, '').toLowerCase());
  }
  // length values: digits + unit
  for (const m of text.match(/\b\d+(?:\.\d+)?(?:px|rem|em)\b/g) ?? []) {
    values.add(m.toLowerCase());
  }
  return values;
}

function tokenCoverageScore(
  source: Set<string>,
  tokensCss: string,
): { score: number; matched: number; gaps: ParityGap[] } {
  if (source.size === 0) return { score: 1, matched: 0, gaps: [] };
  const tokenValues = extractTokenValues(tokensCss);
  const gaps: ParityGap[] = [];
  let matched = 0;
  for (const v of source) {
    if (tokenValues.has(v)) {
      matched += 1;
    } else {
      gaps.push({
        kind: 'token',
        message: `value ${v} appears in source but missing from tokens.css`,
      });
    }
  }
  // Cap gaps to first 8 to keep the agent's context small
  return { score: matched / source.size, matched, gaps: gaps.slice(0, 8) };
}

export function makeVerifyUiKitParityTool(
  fs: TextEditorFsCallbacks | undefined,
  logger: CoreLogger = NOOP_LOGGER,
): AgentTool<typeof VerifyParams, ParityReport> {
  return {
    name: 'verify_ui_kit_parity',
    label: 'Verify UI Kit parity',
    description:
      'Compare a decomposed ui_kits/<slug>/ output against the source artifact ' +
      'and emit a deterministic parity report (element-count, visible-text-coverage, ' +
      'token-coverage). Call this AFTER decompose_to_ui_kit. If parityScore is below ' +
      '0.85, re-call decompose_to_ui_kit with adjustments that address the gaps list ' +
      'returned by this tool. No LLM judge involved — the result is reproducible.',
    parameters: VerifyParams,
    async execute(_toolCallId, params, _signal): Promise<AgentToolResult<ParityReport>> {
      const sourcePath = params.sourcePath ?? 'index.html';
      const decomposedPath = `ui_kits/${params.slug}/index.html`;
      const tokensPath = `ui_kits/${params.slug}/tokens.css`;

      if (!fs) {
        const empty: ParityReport = {
          parityScore: 0,
          status: 'needs_iteration',
          signals: {
            elementCountParity: 0,
            visibleTextCoverage: 0,
            tokenCoverage: 0,
          },
          counts: {
            sourceElements: 0,
            decomposedElements: 0,
            sourceWords: 0,
            decomposedWordsMatched: 0,
            sourceTokens: 0,
            tokenCssMatched: 0,
          },
          gaps: [{ kind: 'element', message: 'fs not available; cannot read artifacts to verify' }],
        };
        return {
          content: [{ type: 'text', text: 'Parity verifier could not access the virtual fs.' }],
          details: empty,
        };
      }

      const source = fs.view(sourcePath);
      const decomposed = fs.view(decomposedPath);
      const tokens = fs.view(tokensPath);

      if (!source || !decomposed) {
        const which: string[] = [];
        if (!source) which.push(sourcePath);
        if (!decomposed) which.push(decomposedPath);
        const report: ParityReport = {
          parityScore: 0,
          status: 'needs_iteration',
          signals: {
            elementCountParity: 0,
            visibleTextCoverage: 0,
            tokenCoverage: 0,
          },
          counts: {
            sourceElements: 0,
            decomposedElements: 0,
            sourceWords: 0,
            decomposedWordsMatched: 0,
            sourceTokens: 0,
            tokenCssMatched: 0,
          },
          gaps: [
            {
              kind: 'element',
              message: `missing artifact(s): ${which.join(', ')}. Re-call decompose_to_ui_kit first.`,
            },
          ],
        };
        return {
          content: [
            {
              type: 'text',
              text: `Cannot verify: missing ${which.join(', ')}.`,
            },
          ],
          details: report,
        };
      }

      const sourceCounts = countElements(source.content);
      const decomposedCounts = countElements(decomposed.content);
      const elementResult = elementParityScore(sourceCounts, decomposedCounts);

      const sourceWords = visibleWords(source.content);
      const decomposedWords = visibleWords(decomposed.content);
      const textResult = textCoverage(sourceWords, decomposedWords);

      const sourceTokenValues = extractTokenValues(source.content);
      const tokenResult = tokenCoverageScore(sourceTokenValues, tokens?.content ?? '');

      // Weighted: structure 0.4, text 0.3, tokens 0.3
      const parityScore =
        elementResult.score * 0.4 + textResult.score * 0.3 + tokenResult.score * 0.3;

      const status: ParityReport['status'] =
        parityScore >= PARITY_THRESHOLD ? 'ok' : 'needs_iteration';
      const gaps: ParityGap[] = [...elementResult.gaps, ...tokenResult.gaps];
      if (textResult.score < 0.7) {
        gaps.push({
          kind: 'text',
          message: `only ${textResult.matched}/${sourceWords.size} unique source words present in decomposed index.html`,
        });
      }

      const report: ParityReport = {
        parityScore: Number(parityScore.toFixed(3)),
        status,
        signals: {
          elementCountParity: Number(elementResult.score.toFixed(3)),
          visibleTextCoverage: Number(textResult.score.toFixed(3)),
          tokenCoverage: Number(tokenResult.score.toFixed(3)),
        },
        counts: {
          sourceElements: totalElementCount(sourceCounts),
          decomposedElements: totalElementCount(decomposedCounts),
          sourceWords: sourceWords.size,
          decomposedWordsMatched: textResult.matched,
          sourceTokens: sourceTokenValues.size,
          tokenCssMatched: tokenResult.matched,
        },
        gaps,
      };

      logger.info('[verify_ui_kit_parity] step=ok', {
        slug: params.slug,
        parityScore: report.parityScore,
        status,
        gaps: gaps.length,
      });

      const summary =
        status === 'ok'
          ? `Parity OK (${report.parityScore}). Element ${report.signals.elementCountParity}, text ${report.signals.visibleTextCoverage}, token ${report.signals.tokenCoverage}.`
          : `Parity needs iteration (${report.parityScore} < ${PARITY_THRESHOLD}). Element ${report.signals.elementCountParity}, text ${report.signals.visibleTextCoverage}, token ${report.signals.tokenCoverage}. ${gaps.length} gap(s) to address.`;

      return {
        content: [{ type: 'text', text: summary }],
        details: report,
      };
    },
  };
}
