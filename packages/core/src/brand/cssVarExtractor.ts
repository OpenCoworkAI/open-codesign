import { readFile } from 'node:fs/promises';
import type { DesignToken } from '@open-codesign/shared';

type TokenType = DesignToken['type'];

function inferType(prop: string, value: string): TokenType | null {
  const p = prop.toLowerCase();

  // Order matters: specific shape patterns must run before broad color keywords
  // so things like `--border-radius-md` and `--text-lg` are not misclassified.
  if (/font-size|text-size/.test(p)) return 'fontSize';
  if (/font-family|font-sans|font-mono|font-serif|typeface/.test(p)) return 'fontFamily';
  if (/line-height|leading/.test(p)) return 'lineHeight';
  if (/radius|rounded|border-radius/.test(p)) return 'radius';
  if (/shadow|elevation/.test(p)) return 'shadow';
  if (/spacing|space|gap|padding|margin|indent|offset/.test(p)) return 'spacing';

  // `--text-*` is ambiguous in Tailwind v4 (size vs color). Disambiguate by value.
  if (/^text-/.test(p)) {
    if (looksLikeColor(value)) return 'color';
    if (looksLikeLength(value)) return 'fontSize';
    if (/^text-(xs|sm|base|lg|xl|\d+xl)$/.test(p)) return 'fontSize';
    return 'color';
  }

  if (
    /color|palette|brand|accent|fg|bg|foreground|background|fill|stroke|ring|border-color/.test(p)
  )
    return 'color';

  // Value-based fallback (handles e.g. `--border-primary: #fff` after broad keywords).
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

function looksLikeLength(value: string): boolean {
  return /^-?\d*\.?\d+(px|rem|em|%|vh|vw|ch|ex|pt|cm|mm|in)\b/i.test(value.trim());
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
