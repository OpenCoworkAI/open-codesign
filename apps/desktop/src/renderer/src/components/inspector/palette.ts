import type { EditmodeTokens, TweakSchema } from '@open-codesign/shared';
import { parseDesignMd } from '@open-codesign/shared';
import { isColorString, toNativeColorInputValue } from '../TweakPanel.inputs';

export type PaletteSource = 'token' | 'design' | 'used';

export interface PaletteColor {
  /** The literal written to source when picked. */
  value: string;
  /** Token or DESIGN.md name; empty for colors only seen in the source. */
  name: string;
  source: PaletteSource;
  /** Literal occurrences in the current source. */
  count: number;
}

const MAX_PALETTE = 16;
const SOURCE_COLOR_RE =
  /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|rgba?\([^)\n]{1,64}\)|hsla?\([^)\n]{1,64}\)/g;

/** A comparison key for color literals; never written back to source. */
export function colorKey(value: string): string | null {
  const trimmed = value.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i.exec(trimmed);
  if (short) {
    const [, r, g, b, a] = short;
    const alpha = a ? `${a}${a}` : '';
    return `#${r}${r}${g}${g}${b}${b}${alpha}`.toLowerCase();
  }
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(trimmed)) return trimmed.toLowerCase();
  if (!isColorString(trimmed)) return null;
  return toNativeColorInputValue(trimmed) ?? trimmed.toLowerCase().replace(/\s+/g, '');
}

export function sourceColorCounts(source: string): Map<string, { value: string; count: number }> {
  const counts = new Map<string, { value: string; count: number }>();
  for (const match of source.matchAll(SOURCE_COLOR_RE)) {
    const key = colorKey(match[0]);
    if (!key) continue;
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { value: match[0], count: 1 });
  }
  return counts;
}

export function designMdColors(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const colors = parseDesignMd(raw).frontmatter['colors'];
    if (!colors || typeof colors !== 'object' || Array.isArray(colors)) return {};
    return Object.fromEntries(
      Object.entries(colors as Record<string, unknown>).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && isColorString(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

export function tweakColorTokens(
  tokens: EditmodeTokens | null | undefined,
  schema: TweakSchema | null | undefined,
): Record<string, string> {
  if (!tokens) return {};
  return Object.fromEntries(
    Object.entries(tokens).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' &&
        (schema?.[entry[0]]?.kind === 'color' || isColorString(entry[1])),
    ),
  );
}

/**
 * Named colors come first (tweak tokens, then DESIGN.md), followed by the
 * literals the page already uses most. Duplicates keep the most authoritative
 * name so a picked swatch reads as `= accent` rather than a bare hex.
 */
export function buildPalette(input: {
  tokens?: Record<string, string>;
  designColors?: Record<string, string>;
  source?: string;
}): PaletteColor[] {
  const counts = sourceColorCounts(input.source ?? '');
  const byKey = new Map<string, PaletteColor>();
  const add = (value: string, name: string, source: PaletteSource) => {
    const key = colorKey(value);
    if (!key || byKey.has(key)) return;
    byKey.set(key, { value, name, source, count: counts.get(key)?.count ?? 0 });
  };
  for (const [name, value] of Object.entries(input.tokens ?? {})) add(value, name, 'token');
  for (const [name, value] of Object.entries(input.designColors ?? {})) add(value, name, 'design');
  [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .forEach((entry) => add(entry.value, '', 'used'));
  return [...byKey.values()].slice(0, MAX_PALETTE);
}

export function paletteMatch(palette: readonly PaletteColor[], value: string): PaletteColor | null {
  const key = colorKey(value);
  if (!key) return null;
  return palette.find((color) => color.name && colorKey(color.value) === key) ?? null;
}
