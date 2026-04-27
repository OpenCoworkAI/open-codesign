import { readFile } from 'node:fs/promises';
import type { DesignToken } from '@open-codesign/shared';

// Matches a JS/TS object key that starts a nested block or a leaf value.
// We intentionally parse the config as text — never require() or eval() it.
// This prevents arbitrary code execution from user-supplied config files.

type TokenType = DesignToken['type'];

interface TailwindThemeSection {
  key: string;
  tokenType: TokenType;
}

const THEME_SECTIONS: TailwindThemeSection[] = [
  { key: 'colors', tokenType: 'color' },
  { key: 'color', tokenType: 'color' },
  { key: 'backgroundColor', tokenType: 'color' },
  { key: 'textColor', tokenType: 'color' },
  { key: 'borderColor', tokenType: 'color' },
  { key: 'fontSize', tokenType: 'fontSize' },
  { key: 'fontFamily', tokenType: 'fontFamily' },
  { key: 'spacing', tokenType: 'spacing' },
  { key: 'borderRadius', tokenType: 'radius' },
  { key: 'boxShadow', tokenType: 'shadow' },
  { key: 'lineHeight', tokenType: 'lineHeight' },
];

function looksLikeColor(value: string): boolean {
  return (
    /^#[0-9a-fA-F]{3,8}$/.test(value) ||
    /^rgba?\s*\(/.test(value) ||
    /^hsla?\s*\(/.test(value) ||
    /^oklch\s*\(/.test(value) ||
    /^color\s*\(/.test(value)
  );
}

function looksLikeLength(value: string): boolean {
  return /^-?\d*\.?\d+(px|rem|em|%|vh|vw|ch|ex|pt|cm|mm|in)\b/i.test(value.trim());
}

// Extract all section object literal bodies for a given key.
// We collect all occurrences (e.g. theme.colors AND theme.extend.colors) so
// nested extends do not shadow the base theme.
function extractAllSectionBodies(source: string, sectionKey: string): string[] {
  const bodies: string[] = [];
  const sectionRe = new RegExp(`\\b${sectionKey}\\s*:\\s*\\{`, 'g');
  const matches = [...source.matchAll(sectionRe)];

  for (const match of matches) {
    const startBrace = (match.index ?? 0) + match[0].length - 1;
    const body = extractBodyAt(source, startBrace);
    if (body !== null) bodies.push(body);
  }

  return bodies;
}

// Extract the body of a `{` brace at position `bracePos` in `text`.
// Quote- and comment-aware so braces inside strings or comments do not
// terminate blocks early.
function extractBodyAt(text: string, bracePos: number): string | null {
  if (text[bracePos] !== '{') return null;

  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = bracePos; i < text.length; i++) {
    const ch = text[i] as string;
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(bracePos + 1, i);
    }
  }
  return null;
}

// Remove nested object blocks so leaf regex only sees top-level keys.
function stripNestedBlocks(body: string): string {
  let result = '';
  let depth = 0;
  for (const ch of body) {
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      if (depth > 0) depth--;
    } else if (depth === 0) {
      result += ch;
    }
  }
  return result;
}

function leafValueFromMatch(m: RegExpMatchArray): string | undefined {
  const strValue = m[2] ?? m[3];
  if (strValue !== undefined) return strValue;
  const arrRaw = m[4];
  if (arrRaw === undefined) return undefined;
  const firstEl = arrRaw.match(/['"]?([^'",]+)['"]?/);
  return firstEl?.[1]?.trim();
}

// Walk object literal text and collect leaf key→value pairs.
// Only extracts simple string literals and string arrays; skips functions and spreads.
function collectLeafPairs(body: string, prefix: string): Array<{ name: string; value: string }> {
  const results: Array<{ name: string; value: string }> = [];

  const flat = stripNestedBlocks(body);

  // Match  key: 'value'  or  key: "value"  or  key: ['a', 'b']  or  key: ["a", "b"]
  const leafRe = /['"]?([\w-]+)['"]?\s*:\s*(?:'([^']+)'|"([^"]+)"|\[(['"]?[^[\]]+['"]?)\])/g;
  for (const m of flat.matchAll(leafRe)) {
    const key = m[1];
    if (key === undefined) continue;
    if (['DEFAULT', 'screens', 'container'].includes(key)) continue;
    const value = leafValueFromMatch(m);
    if (!value) continue;
    results.push({ name: prefix ? `${prefix}.${key}` : key, value });
  }

  // Recurse into nested blocks
  const nestedRe = /['"]?([\w-]+)['"]?\s*:\s*\{/g;
  for (const nm of body.matchAll(nestedRe)) {
    const subKey = nm[1];
    if (subKey === undefined) continue;
    const subStart = (nm.index ?? 0) + nm[0].length - 1;
    const subBody = extractBodyAt(body, subStart);
    if (subBody !== null) {
      const subPrefix = prefix ? `${prefix}.${subKey}` : subKey;
      results.push(...collectLeafPairs(subBody, subPrefix));
    }
  }

  return results;
}

function hasTailwindV4Theme(source: string): boolean {
  return /@theme\b[^{]*\{/.test(source);
}

function inferTypeFromCssProp(prop: string, value: string): TokenType | null {
  // Order matters: specific shape patterns must run before broad keyword classifiers.
  // so Tailwind v4 `--text-*` size tokens are not misclassified as color.
  if (/font-size|text-size/.test(prop)) return 'fontSize';
  if (/font-family/.test(prop)) return 'fontFamily';
  if (/line-height|leading/.test(prop)) return 'lineHeight';
  if (/radius|rounded/.test(prop)) return 'radius';
  if (/shadow/.test(prop)) return 'shadow';
  if (/spacing|gap|padding|margin|space/.test(prop)) return 'spacing';

  // `--text-*` is ambiguous in Tailwind v4 (size vs color). Disambiguate by value.
  if (/^text-/.test(prop)) {
    if (looksLikeColor(value)) return 'color';
    if (looksLikeLength(value)) return 'fontSize';
    if (/^text-(xs|sm|base|lg|xl|\d+xl)$/.test(prop)) return 'fontSize';
    return 'color';
  }

  if (/color|bg|border|fill|stroke|ring/.test(prop)) return 'color';
  if (looksLikeColor(value)) return 'color';
  return null;
}

function collectV4Declarations(body: string, seen: Set<string>): DesignToken[] {
  const out: DesignToken[] = [];
  const declRe = /--([\w-]+)\s*:\s*([^;]+);/g;
  for (const dm of body.matchAll(declRe)) {
    const prop = dm[1];
    const rawValue = dm[2]?.trim();
    if (!prop || !rawValue) continue;
    if (seen.has(prop)) continue;

    const tokenType = inferTypeFromCssProp(prop, rawValue);
    if (!tokenType) continue;

    seen.add(prop);
    out.push({
      schemaVersion: 1,
      type: tokenType,
      name: prop,
      value: rawValue,
      origin: 'tailwind-config',
      group: prop.split('-').slice(0, 2).join('.'),
    });
  }
  return out;
}

function extractFromV4Theme(source: string): DesignToken[] {
  const results: DesignToken[] = [];
  const seen = new Set<string>();
  const themeBlockRe = /@theme\b[^{]*\{/g;

  for (const m of source.matchAll(themeBlockRe)) {
    const blockStart = (m.index ?? 0) + m[0].length - 1;
    const body = extractBodyAt(source, blockStart);
    if (!body) continue;
    results.push(...collectV4Declarations(body, seen));
  }

  return results;
}

function collectV3SectionTokens(section: TailwindThemeSection, source: string): DesignToken[] {
  const out: DesignToken[] = [];
  for (const body of extractAllSectionBodies(source, section.key)) {
    for (const { name, value } of collectLeafPairs(body, section.key)) {
      if (!value) continue;
      // Skip values that look like JS function calls (but allow CSS color functions)
      if (value.includes('(') && !looksLikeColor(value)) continue;
      out.push({
        schemaVersion: 1,
        type: section.tokenType,
        name,
        value,
        origin: 'tailwind-config',
        group: name.split('.').slice(0, 2).join('.'),
      });
    }
  }
  return out;
}

function extractFromV3Config(source: string): DesignToken[] {
  const results: DesignToken[] = [];
  for (const section of THEME_SECTIONS) {
    results.push(...collectV3SectionTokens(section, source));
  }

  // Deduplicate by name (first occurrence wins — theme.extend listed first usually)
  const seen = new Set<string>();
  const deduped: DesignToken[] = [];
  for (const token of results) {
    if (!seen.has(token.name)) {
      seen.add(token.name);
      deduped.push(token);
    }
  }

  return deduped;
}

export async function extractFromTailwindConfig(filePath: string): Promise<DesignToken[]> {
  const source = await readFile(filePath, 'utf-8');

  if (hasTailwindV4Theme(source)) {
    return extractFromV4Theme(source);
  }

  return extractFromV3Config(source);
}
