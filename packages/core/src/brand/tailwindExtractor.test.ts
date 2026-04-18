import { dirname, resolve } from 'node:path';
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
});
