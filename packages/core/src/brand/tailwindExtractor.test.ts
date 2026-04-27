import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractFromTailwindConfig } from './tailwindExtractor.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dir, '__fixtures__/tailwind.config.js');

describe('extractFromTailwindConfig()', () => {
  it('extracts brand colors from theme.extend.colors', async () => {
    const tokens = await extractFromTailwindConfig(FIXTURE);
    const colorTokens = tokens.filter((t) => t.type === 'color');
    const names = colorTokens.map((t) => t.name);

    expect(names).toContain('colors.brand.primary');
    expect(names).toContain('colors.brand.secondary');
  });

  it('extracts top-level colors from theme.colors', async () => {
    const tokens = await extractFromTailwindConfig(FIXTURE);
    const colorTokens = tokens.filter((t) => t.type === 'color');
    const names = colorTokens.map((t) => t.name);

    expect(names).toContain('colors.white');
    expect(names).toContain('colors.black');
  });

  it('extracts fontSize tokens', async () => {
    const tokens = await extractFromTailwindConfig(FIXTURE);
    const fontSizeTokens = tokens.filter((t) => t.type === 'fontSize');

    expect(fontSizeTokens.length).toBeGreaterThan(0);
    const names = fontSizeTokens.map((t) => t.name);
    expect(names).toContain('fontSize.base');
    expect(names).toContain('fontSize.lg');
  });

  it('extracts fontFamily tokens', async () => {
    const tokens = await extractFromTailwindConfig(FIXTURE);
    const fontFamilyTokens = tokens.filter((t) => t.type === 'fontFamily');

    expect(fontFamilyTokens.length).toBeGreaterThan(0);
    const sansToken = fontFamilyTokens.find((t) => t.name === 'fontFamily.sans');
    expect(sansToken).toBeDefined();
    expect(sansToken?.value).toContain('Inter');
  });

  it('extracts borderRadius tokens', async () => {
    const tokens = await extractFromTailwindConfig(FIXTURE);
    const radiusTokens = tokens.filter((t) => t.type === 'radius');

    expect(radiusTokens.length).toBeGreaterThan(0);
    const names = radiusTokens.map((t) => t.name);
    expect(names).toContain('borderRadius.md');
  });

  it('sets origin to tailwind-config on every token', async () => {
    const tokens = await extractFromTailwindConfig(FIXTURE);
    for (const token of tokens) {
      expect(token.origin).toBe('tailwind-config');
    }
  });

  it('sets schemaVersion to 1 on every token', async () => {
    const tokens = await extractFromTailwindConfig(FIXTURE);
    for (const token of tokens) {
      expect(token.schemaVersion).toBe(1);
    }
  });

  it('does not return duplicate token names', async () => {
    const tokens = await extractFromTailwindConfig(FIXTURE);
    const names = tokens.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('extracts tokens from every @theme block when multiple are present (v4)', async () => {
    const multiThemeFixture = resolve(__dir, '__fixtures__/tailwind.v4.multi-theme.css');
    const tokens = await extractFromTailwindConfig(multiThemeFixture);
    const names = tokens.map((t) => t.name);

    expect(names).toContain('color-brand-primary');
    expect(names).toContain('color-brand-secondary');
    expect(names).toContain('font-size-base');

    expect(names).toContain('color-accent');
    expect(names).toContain('radius-md');
    expect(names).toContain('shadow-lg');
  });

  it('does not terminate @theme block on `}` inside a string literal (v4)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tw-extract-'));
    const file = join(dir, 'tailwind.css');
    await writeFile(
      file,
      '@theme {\n  --font-family-display: "Inter, backup }";\n  --color-brand-primary: #ff0000;\n}\n',
    );
    const tokens = await extractFromTailwindConfig(file);
    const names = tokens.map((t) => t.name);
    expect(names).toContain('font-family-display');
    expect(names).toContain('color-brand-primary');
  });

  it('ignores `}` inside a CSS comment (v4)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tw-extract-'));
    const file = join(dir, 'tailwind.css');
    await writeFile(
      file,
      '@theme {\n  /* close brace } in a comment */\n  --color-brand-secondary: #00ff00;\n}\n',
    );
    const tokens = await extractFromTailwindConfig(file);
    const names = tokens.map((t) => t.name);
    expect(names).toContain('color-brand-secondary');
  });

  it('detects and extracts tokens from @theme inline { ... } (v4)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tw-extract-'));
    const file = join(dir, 'tailwind.css');
    await writeFile(file, '@theme inline {\n  --color-brand-x: #112233;\n}\n');
    const tokens = await extractFromTailwindConfig(file);
    const names = tokens.map((t) => t.name);
    expect(names).toContain('color-brand-x');
  });

  it('detects and extracts tokens from @theme static { ... } (v4)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tw-extract-'));
    const file = join(dir, 'tailwind.css');
    await writeFile(file, '@theme static {\n  --spacing-y: 2px;\n}\n');
    const tokens = await extractFromTailwindConfig(file);
    const names = tokens.map((t) => t.name);
    expect(names).toContain('spacing-y');
  });

  it('detects and extracts tokens from @theme reference { ... } (v4)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tw-extract-'));
    const file = join(dir, 'tailwind.css');
    await writeFile(file, '@theme reference {\n  --radius-z: 3px;\n}\n');
    const tokens = await extractFromTailwindConfig(file);
    const names = tokens.map((t) => t.name);
    expect(names).toContain('radius-z');
  });

  it('classifies --text-* size tokens as fontSize and color tokens as color (v4)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tw-extract-'));
    const file = join(dir, 'tailwind.css');
    await writeFile(
      file,
      [
        '@theme {',
        '  --text-lg: 1.125rem;',
        '  --text-base: 1rem;',
        '  --text-primary: oklch(0.7 0.1 30);',
        '  --text-muted: #888888;',
        '}',
        '',
      ].join('\n'),
    );
    const tokens = await extractFromTailwindConfig(file);
    const byName = new Map(tokens.map((t) => [t.name, t]));

    expect(byName.get('text-lg')?.type).toBe('fontSize');
    expect(byName.get('text-base')?.type).toBe('fontSize');
    expect(byName.get('text-primary')?.type).toBe('color');
    expect(byName.get('text-muted')?.type).toBe('color');
  });
});
