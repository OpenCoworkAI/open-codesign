import { readFile } from 'node:fs/promises';
import type { DesignToken } from '@open-codesign/shared';

type TokenType = DesignToken['type'];

function inferType(prop: string, value: string): TokenType | null {
  const p = prop.toLowerCase();

  if (/color|palette|brand|accent|fg|bg|foreground|background|fill|stroke|ring|border/.test(p))
    return 'color';
  if (/font-size|text-size|text-sm|text-base|text-lg|text-xl/.test(p)) return 'fontSize';
  if (/font-family|font-sans|font-mono|font-serif|typeface/.test(p)) return 'fontFamily';
  if (/spacing|space|gap|padding|margin|indent|offset/.test(p)) return 'spacing';
  if (/radius|rounded/.test(p)) return 'radius';
  if (/shadow|elevation/.test(p)) return 'shadow';
  if (/line-height|leading/.test(p)) return 'lineHeight';

  // Value-based fallback
  if (looksLikeColor(value)) return 'color';

  return null;
}

function looksLikeColor(value: string): boolean {
  return (
    /^#[0-9a-fA-F]{3,8}$/.test(value) ||
    /^rgba?\s*\(/.test(value) ||
    /^hsla?\s*\(/.test(value) ||
    /^oklch\s*\(/.test(value) ||
    /^color\s*\(/.test(value)
  );
}

// Extract all CSS custom-property declarations from `:root` or `[data-theme]`
// blocks in the given CSS source text.
function extractDeclarations(source: string): Array<{ prop: string; value: string }> {
  const results: Array<{ prop: string; value: string }> = [];

  const blockRe = /(?::root|\[data-theme[^\]]*\])\s*\{([^}]*)\}/g;
  const blockMatches = [...source.matchAll(blockRe)];

  for (const blockMatch of blockMatches) {
    const body = blockMatch[1];
    if (!body) continue;

    const declRe = /--([\w-]+)\s*:\s*([^;]+);/g;
    const declMatches = [...body.matchAll(declRe)];

    for (const dm of declMatches) {
      const prop = dm[1]?.trim();
      const value = dm[2]?.trim();
      if (prop && value) results.push({ prop, value });
    }
  }

  return results;
}

export async function extractFromCssVars(filePath: string): Promise<DesignToken[]> {
  const source = await readFile(filePath, 'utf-8');
  const declarations = extractDeclarations(source);
  const tokens: DesignToken[] = [];

  for (const { prop, value } of declarations) {
    const tokenType = inferType(prop, value);
    if (!tokenType) continue;

    tokens.push({
      schemaVersion: 1,
      type: tokenType,
      name: prop,
      value,
      origin: 'css-vars',
      group: prop.split('-').slice(0, 3).join('-'),
    });
  }

  return tokens;
}
