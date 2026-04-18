import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractFromCssVars } from './cssVarExtractor.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dir, '__fixtures__/tokens.css');

describe('extractFromCssVars()', () => {
  it('extracts color tokens from --color-* variables', async () => {
    const tokens = await extractFromCssVars(FIXTURE);
    const colorTokens = tokens.filter((t) => t.type === 'color');

    expect(colorTokens.length).toBeGreaterThan(0);
    const names = colorTokens.map((t) => t.name);
    expect(names).toContain('color-primary');
    expect(names).toContain('color-secondary');
    expect(names).toContain('color-background');
    expect(names).toContain('color-foreground');
  });

  it('extracts fontFamily tokens from --font-family-* variables', async () => {
    const tokens = await extractFromCssVars(FIXTURE);
    const fontFamilyTokens = tokens.filter((t) => t.type === 'fontFamily');

    expect(fontFamilyTokens.length).toBeGreaterThan(0);
    const names = fontFamilyTokens.map((t) => t.name);
    expect(names).toContain('font-family-sans');
    expect(names).toContain('font-family-mono');
  });

  it('extracts fontSize tokens from --font-size-* variables', async () => {
    const tokens = await extractFromCssVars(FIXTURE);
    const fontSizeTokens = tokens.filter((t) => t.type === 'fontSize');

    expect(fontSizeTokens.length).toBeGreaterThan(0);
    const names = fontSizeTokens.map((t) => t.name);
    expect(names).toContain('font-size-sm');
    expect(names).toContain('font-size-base');
  });

  it('extracts spacing tokens from --space-* variables', async () => {
    const tokens = await extractFromCssVars(FIXTURE);
    const spacingTokens = tokens.filter((t) => t.type === 'spacing');

    expect(spacingTokens.length).toBeGreaterThan(0);
    const names = spacingTokens.map((t) => t.name);
    expect(names).toContain('space-1');
    expect(names).toContain('space-2');
    expect(names).toContain('space-4');
  });

  it('extracts radius tokens from --radius-* variables', async () => {
    const tokens = await extractFromCssVars(FIXTURE);
    const radiusTokens = tokens.filter((t) => t.type === 'radius');

    expect(radiusTokens.length).toBeGreaterThan(0);
    const names = radiusTokens.map((t) => t.name);
    expect(names).toContain('radius-sm');
    expect(names).toContain('radius-md');
    expect(names).toContain('radius-lg');
  });

  it('extracts shadow tokens from --shadow-* variables', async () => {
    const tokens = await extractFromCssVars(FIXTURE);
    const shadowTokens = tokens.filter((t) => t.type === 'shadow');

    expect(shadowTokens.length).toBeGreaterThan(0);
    const names = shadowTokens.map((t) => t.name);
    expect(names).toContain('shadow-sm');
  });

  it('sets origin to css-vars on every token', async () => {
    const tokens = await extractFromCssVars(FIXTURE);
    for (const token of tokens) {
      expect(token.origin).toBe('css-vars');
    }
  });

  it('also picks up [data-theme] overrides', async () => {
    const tokens = await extractFromCssVars(FIXTURE);
    const names = tokens.map((t) => t.name);
    // [data-theme="dark"] re-declares --color-background and --color-foreground
    const backgroundCount = names.filter((n) => n === 'color-background').length;
    expect(backgroundCount).toBeGreaterThanOrEqual(2);
  });

  it('classifies --text-* size tokens as fontSize and color variants as color', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'css-vars-'));
    const file = join(dir, 'tokens.css');
    await writeFile(
      file,
      [
        ':root {',
        '  --text-lg: 1.125rem;',
        '  --text-base: 1rem;',
        '  --text-primary: oklch(0.7 0.1 30);',
        '  --text-muted: #888888;',
        '}',
        '',
      ].join('\n'),
    );
    const tokens = await extractFromCssVars(file);
    const byName = new Map(tokens.map((t) => [t.name, t]));

    expect(byName.get('text-lg')?.type).toBe('fontSize');
    expect(byName.get('text-base')?.type).toBe('fontSize');
    expect(byName.get('text-primary')?.type).toBe('color');
    expect(byName.get('text-muted')?.type).toBe('color');
  });

  it('classifies --border-radius-* as radius rather than color', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'css-vars-'));
    const file = join(dir, 'tokens.css');
    await writeFile(
      file,
      [':root {', '  --border-radius-md: 8px;', '  --border-color-muted: #ddd;', '}', ''].join(
        '\n',
      ),
    );
    const tokens = await extractFromCssVars(file);
    const byName = new Map(tokens.map((t) => [t.name, t]));

    expect(byName.get('border-radius-md')?.type).toBe('radius');
    expect(byName.get('border-color-muted')?.type).toBe('color');
  });
});
