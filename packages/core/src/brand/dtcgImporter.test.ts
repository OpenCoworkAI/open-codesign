import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { importDtcgJson } from './dtcgImporter.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dir, '__fixtures__/tokens.json');
const FIXTURE_JSON: unknown = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));

describe('importDtcgJson()', () => {
  it('flattens nested DTCG structure into DesignToken array', () => {
    const tokens = importDtcgJson(FIXTURE_JSON);
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('extracts color tokens with dot-path names', () => {
    const tokens = importDtcgJson(FIXTURE_JSON);
    const colorTokens = tokens.filter((t) => t.type === 'color');
    const names = colorTokens.map((t) => t.name);

    expect(names).toContain('color.brand.primary');
    expect(names).toContain('color.brand.secondary');
  });

  it('uses $type: color for explicitly typed color tokens', () => {
    const tokens = importDtcgJson(FIXTURE_JSON);
    const primary = tokens.find((t) => t.name === 'color.brand.primary');

    expect(primary).toBeDefined();
    expect(primary?.type).toBe('color');
    expect(primary?.value).toBe('#D97757');
  });

  it('inherits group $type for children without explicit $type', () => {
    const tokens = importDtcgJson(FIXTURE_JSON);
    // neutral.100 and neutral.900 have no explicit $type but are under color group
    const neutral100 = tokens.find((t) => t.name === 'color.neutral.100');
    expect(neutral100).toBeDefined();
    expect(neutral100?.type).toBe('color');
  });

  it('extracts fontFamily tokens', () => {
    const tokens = importDtcgJson(FIXTURE_JSON);
    const fontFamilyTokens = tokens.filter((t) => t.type === 'fontFamily');

    expect(fontFamilyTokens.length).toBeGreaterThan(0);
    const sansToken = fontFamilyTokens.find((t) => t.name === 'typography.fontFamily.sans');
    expect(sansToken).toBeDefined();
    expect(sansToken?.value).toContain('Inter');
  });

  it('maps $type: dimension to spacing for spacing tokens', () => {
    const tokens = importDtcgJson(FIXTURE_JSON);
    const spacingTokens = tokens.filter((t) => t.type === 'spacing');
    const names = spacingTokens.map((t) => t.name);

    expect(names).toContain('spacing.1');
    expect(names).toContain('spacing.4');
  });

  it('extracts shadow tokens', () => {
    const tokens = importDtcgJson(FIXTURE_JSON);
    const shadowTokens = tokens.filter((t) => t.type === 'shadow');

    expect(shadowTokens.length).toBeGreaterThan(0);
    expect(shadowTokens[0]?.name).toBe('shadow.sm');
  });

  it('sets group from parent path segments', () => {
    const tokens = importDtcgJson(FIXTURE_JSON);
    const primary = tokens.find((t) => t.name === 'color.brand.primary');

    expect(primary?.group).toBe('color.brand');
  });

  it('sets top-level tokens group to parent key', () => {
    const tokens = importDtcgJson(FIXTURE_JSON);
    const spacing1 = tokens.find((t) => t.name === 'spacing.1');
    expect(spacing1?.group).toBe('spacing');
  });

  it('sets origin to dtcg-json on every token', () => {
    const tokens = importDtcgJson(FIXTURE_JSON);
    for (const token of tokens) {
      expect(token.origin).toBe('dtcg-json');
    }
  });

  it('sets schemaVersion to 1 on every token', () => {
    const tokens = importDtcgJson(FIXTURE_JSON);
    for (const token of tokens) {
      expect(token.schemaVersion).toBe(1);
    }
  });

  it('handles non-object input gracefully (returns empty array)', () => {
    expect(importDtcgJson(null)).toEqual([]);
    expect(importDtcgJson('not-an-object')).toEqual([]);
    expect(importDtcgJson(42)).toEqual([]);
    expect(importDtcgJson([])).toEqual([]);
  });
});
