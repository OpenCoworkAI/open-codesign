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
function extractBodyAt(text: string, bracePos: number): string | null {
  if (text[bracePos] !== '{') return null;
  let depth = 0;
  let i = bracePos;
  while (i < text.length) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(bracePos + 1, i);
    }
    i++;
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

// Walk object literal text and collect leaf key→value pairs.
// Only extracts simple string literals and string arrays; skips functions and spreads.
function collectLeafPairs(body: string, prefix: string): Array<{ name: string; value: string }> {
  const results: Array<{ name: string; value: string }> = [];

  const flat = stripNestedBlocks(body);

  // Match  key: 'value'  or  key: "value"  or  key: ['a', 'b']  or  key: ["a", "b"]
  const leafRe = /['"]?([\w-]+)['"]?\s*:\s*(?:'([^']+)'|"([^"]+)"|\[(['"]?[^[\]]+['"]?)\])/g;
  const leafMatches = [...flat.matchAll(leafRe)];

  for (const m of leafMatches) {
    const key = m[1];
    const strValue = m[2] ?? m[3];
    const arrRaw = m[4];

    if (key === undefined) continue;
    if (['DEFAULT', 'screens', 'container'].includes(key)) continue;

    let value: string | undefined;
    if (strValue !== undefined) {
      value = strValue;
    } else if (arrRaw !== undefined) {
      // Extract first element of the array as the primary value
      const firstEl = arrRaw.match(/['"]?([^'",]+)['"]?/);
      value = firstEl?.[1]?.trim();
    }

    if (!value) continue;
    const name = prefix ? `${prefix}.${key}` : key;
    results.push({ name, value });
  }

  // Recurse into nested blocks
  const nestedRe = /['"]?([\w-]+)['"]?\s*:\s*\{/g;
  const nestedMatches = [...body.matchAll(nestedRe)];

  for (const nm of nestedMatches) {
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
  return /@theme\s*\{/.test(source);
}

function inferTypeFromCssProp(prop: string, value: string): TokenType | null {
  if (/color|bg|text|border|fill|stroke|ring/.test(prop)) return 'color';
  if (/font-size|text-size/.test(prop)) return 'fontSize';
  if (/font-family/.test(prop)) return 'fontFamily';
  if (/spacing|gap|padding|margin|space/.test(prop)) return 'spacing';
  if (/radius|rounded/.test(prop)) return 'radius';
  if (/shadow/.test(prop)) return 'shadow';
  if (/line-height|leading/.test(prop)) return 'lineHeight';
  if (looksLikeColor(value)) return 'color';
  return null;
}

function extractFromV4Theme(source: string): DesignToken[] {
  const results: DesignToken[] = [];

  const themeBlockRe = /@theme\s*\{/g;
  const m = themeBlockRe.exec(source);
  if (!m) return results;

  const blockStart = m.index + m[0].length - 1;
  const body = extractBodyAt(source, blockStart);
  if (!body) return results;

  const declRe = /--([\w-]+)\s*:\s*([^;]+);/g;
  const declMatches = [...body.matchAll(declRe)];

  for (const dm of declMatches) {
    const prop = dm[1];
    const rawValue = dm[2]?.trim();
    if (!prop || !rawValue) continue;

    const tokenType = inferTypeFromCssProp(prop, rawValue);
    if (!tokenType) continue;

    results.push({
      schemaVersion: 1,
      type: tokenType,
      name: prop,
      value: rawValue,
      origin: 'tailwind-config',
      group: prop.split('-').slice(0, 2).join('.'),
    });
  }

  return results;
}

function extractFromV3Config(source: string): DesignToken[] {
  const results: DesignToken[] = [];

  for (const section of THEME_SECTIONS) {
    const bodies = extractAllSectionBodies(source, section.key);

    for (const body of bodies) {
      const pairs = collectLeafPairs(body, section.key);
      for (const { name, value } of pairs) {
        if (!value) continue;
        // Skip values that look like JS function calls (but allow CSS color functions)
        if (value.includes('(') && !looksLikeColor(value)) continue;

        results.push({
          schemaVersion: 1,
          type: section.tokenType,
          name,
          value,
          origin: 'tailwind-config',
          group: name.split('.').slice(0, 2).join('.'),
        });
      }
    }
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
