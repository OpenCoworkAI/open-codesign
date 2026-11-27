import { describe, expect, it } from 'vitest';
import {
  buildPalette,
  colorKey,
  designMdColors,
  paletteMatch,
  paletteSwatchSelected,
  parseTweakCssVar,
  sourceColorCounts,
  toTweakCssVarKey,
  tweakColorTokens,
  tweakCssVarForToken,
} from './palette';

describe('inspector color palette helpers', () => {
  it('normalizes hex and functional color literals without accepting invalid strings', () => {
    expect(colorKey('#ABC')).toBe('#aabbcc');
    expect(colorKey(' #1234 ')).toBe('#11223344');
    expect(colorKey('#00FF88')).toBe('#00ff88');
    expect(colorKey('rgb(255, 0, 128)')).toBe('#ff0080');
    expect(colorKey('not-a-color')).toBeNull();
  });

  it('counts occurrences per canonical color key across source literals', () => {
    const counts = sourceColorCounts(
      '<div style={{ color: "#fff", borderColor: "#FFFFFF", backgroundColor: "#112233" }} />',
    );
    expect(counts.get('#ffffff')).toEqual({ value: '#fff', count: 2 });
    expect(counts.get('#112233')).toEqual({ value: '#112233', count: 1 });
  });

  it('extracts valid frontmatter colors from DESIGN.md and fails safely on bad markdown', () => {
    const md = `---
colors:
  primary: "#294c60"
  accent: rgb(255, 100, 0)
  invalid: notacolor
  ignoredNumber: 42
---
# Design tokens`;
    expect(designMdColors(md)).toEqual({
      primary: '#294c60',
      accent: 'rgb(255, 100, 0)',
    });
    expect(designMdColors(null)).toEqual({});
    expect(designMdColors('---\ncolors: [1, 2]\n---')).toEqual({});
    expect(designMdColors('---\n: : : invalid yaml [[\n---')).toEqual({});
  });

  it('filters color tweak tokens by schema or color literal heuristic', () => {
    expect(
      tweakColorTokens(
        { accent: '#f97316', ink: 'Brand', heading: 'Title', gap: 16, surface: 'rgb(1, 2, 3)' },
        { ink: { kind: 'color' }, heading: { kind: 'string' } },
      ),
    ).toEqual({
      accent: '#f97316',
      ink: 'Brand',
      surface: 'rgb(1, 2, 3)',
    });
  });

  it('prioritizes token > design > used, deduplicates by key, and caps at 16 entries', () => {
    const extraColors = Array.from(
      { length: 20 },
      (_, i) => `#${String(i + 10).padStart(6, '0')}`,
    ).join(' ');
    const palette = buildPalette({
      tokens: { accent: '#f97316' },
      designColors: { primary: '#F97316', neutral: '#334155' },
      source: `#f97316 #f97316 #334155 #10b981 ${extraColors}`,
    });
    expect(palette).toHaveLength(16);
    expect(palette[0]).toEqual({
      value: '#f97316',
      name: 'accent',
      source: 'token',
      count: 2,
    });
    expect(palette[1]).toEqual({
      value: '#334155',
      name: 'neutral',
      source: 'design',
      count: 1,
    });
    expect(palette[2]).toEqual({
      value: '#10b981',
      name: '',
      source: 'used',
      count: 1,
    });

    expect(paletteMatch(palette, '#F97316')).toEqual(palette[0]);
    expect(paletteMatch(palette, '#10b981')).toBeNull();
    expect(paletteMatch(palette, 'invalid')).toBeNull();
  });

  it('matches and formats var(--ocd-tweak-<k>) CSS custom property tokens', () => {
    expect(toTweakCssVarKey('accentColor')).toBe('accent-color');
    expect(tweakCssVarForToken('accentColor')).toBe('var(--ocd-tweak-accent-color)');
    expect(parseTweakCssVar('var(--ocd-tweak-accent-color)')).toBe('accent-color');
    expect(parseTweakCssVar('var(--ocd-tweak-accent-color, #fff)')).toBe('accent-color');
    expect(parseTweakCssVar('var(--other-var)')).toBeNull();

    const palette = buildPalette({
      tokens: { accentColor: '#f97316' },
      designColors: { neutral: '#334155' },
    });
    const first = palette[0];
    const second = palette[1];
    if (!first || !second) throw new Error('Missing palette swatches');
    expect(paletteMatch(palette, 'var(--ocd-tweak-accent-color)')).toEqual(first);
    expect(paletteMatch(palette, 'var(--ocd-tweak-missing)')).toBeNull();
    expect(paletteSwatchSelected(first, 'var(--ocd-tweak-accent-color)')).toBe(true);
    expect(paletteSwatchSelected(second, 'var(--ocd-tweak-accent-color)')).toBe(false);
  });
});
