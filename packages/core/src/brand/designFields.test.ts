import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DesignToken, serializeDesignMd, validateDesignMd } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import { extractFromCssVars } from './cssVarExtractor.js';
import { mapTokensToDesignFields, type TokenFile } from './designFields.js';
import { extractFromTailwindConfig } from './tailwindExtractor.js';

const token = (
  type: DesignToken['type'],
  name: string,
  value: string,
  extra: Partial<DesignToken> = {},
): DesignToken => ({ schemaVersion: 1, type, name, value, origin: 'css-vars', ...extra });
const file = (path: string, ...tokens: DesignToken[]): TokenFile => ({ path, tokens });
const map = (...tokens: DesignToken[]) => mapTokensToDesignFields([file('tokens.css', ...tokens)]);

describe('mapTokensToDesignFields()', () => {
  it('maps every token type to the field DESIGN.md has for it', () => {
    const result = map(
      token('color', 'hex', '#FFF'),
      token('color', 'rgb', 'rgb(255 128 0)'),
      token('color', 'hsl', 'hsl(210 50% 40%)'),
      token('color', 'oklch', 'oklch(0.5 0 0)'),
      token('fontFamily', 'font-sans', 'Inter, ui-sans-serif'),
      token('radius', 'radius-lg', '0.5rem'),
      token('spacing', 'spacing-4', '1rem'),
      token('spacing', 'spacing-px', '1.5'),
      token('fontSize', 'text-lg', '1.125rem'),
      token('lineHeight', 'leading-tight', '1.25'),
      token('shadow', 'shadow-md', '0 4px   6px -1px rgb(0 0 0 / 0.1)'),
    );
    expect(result.fields).toEqual({
      colors: { hex: '#ffffff', rgb: '#ff8000', hsl: '#336699', oklch: '#636363' },
      typography: { sans: { fontFamily: 'Inter, ui-sans-serif' } },
      rounded: { lg: '0.5rem' },
      spacing: { 4: '1rem', px: 1.5 },
    });
    expect(result.sections).toEqual([
      {
        heading: 'Typography',
        content: '- font size `lg`: 1.125rem\n- line height `tight`: 1.25',
      },
      {
        heading: 'Elevation & Depth',
        content: '- `md`: 0 4px 6px -1px rgb(0 0 0 / 0.1)',
      },
    ]);
    expect(result.report).toEqual({
      clamped: [],
      unsupported: [],
      unresolved: [],
      otherThemes: [],
      shadowed: [],
    });
  });

  it('returns nothing for no tokens', () => {
    expect(mapTokensToDesignFields([])).toEqual({
      fields: {},
      sections: [],
      origins: {},
      report: { clamped: [], unsupported: [], unresolved: [], otherThemes: [], shadowed: [] },
    });
  });

  describe('names', () => {
    // [type, the name an extractor gives it, where it lands]
    it.each([
      ['color', 'colors.brand.500', 'colors.brand-500', '#ffffff'],
      ['color', 'color-brand-500', 'colors.brand-500', '#ffffff'],
      ['color', 'color.brand.primary', 'colors.brand-primary', '#ffffff'],
      ['color', 'background', 'colors.background', '#ffffff'],
      ['color', 'text-primary', 'colors.text-primary', '#ffffff'],
      ['fontFamily', 'fontFamily.sans', 'typography.sans', 'Inter'],
      ['fontFamily', 'font-sans', 'typography.sans', 'Inter'],
      ['fontFamily', 'font-family-sans', 'typography.sans', 'Inter'],
      ['radius', 'borderRadius.lg', 'rounded.lg', '4px'],
      ['radius', 'radius-lg', 'rounded.lg', '4px'],
      ['radius', 'radius', 'rounded.base', '4px'],
      ['spacing', 'spacing.4', 'spacing.4', '4px'],
      ['spacing', 'spacing', 'spacing.base', '4px'],
      ['fontSize', 'fontSize.lg', 'Typography.font size.lg', '1rem'],
      ['fontSize', 'text-lg', 'Typography.font size.lg', '1rem'],
      ['fontSize', 'font-size-base', 'Typography.font size.base', '1rem'],
      ['lineHeight', 'leading-tight', 'Typography.line height.tight', '1.5'],
      ['lineHeight', 'text-lg--line-height', 'Typography.line height.lg', '1.5'],
      ['shadow', 'boxShadow.md', 'Elevation & Depth.md', '0 1px 2px #000'],
      ['shadow', 'shadow-md', 'Elevation & Depth.md', '0 1px 2px #000'],
    ] as const)('%s %s lands at %s', (type, name, path, value) => {
      expect(Object.keys(map(token(type, name, value)).origins)).toEqual([path]);
    });
  });

  describe('colors', () => {
    it('clamps a color outside sRGB and reports the original value', () => {
      const result = map(
        token('color', 'vivid', 'oklch(0.7 0.4 150)'),
        token('color', 'plain', 'oklch(0.5 0 0)'),
      );
      expect(result.fields.colors).toEqual({ vivid: '#00d600', plain: '#636363' });
      expect(result.report.clamped).toEqual([
        {
          path: 'colors.vivid',
          original: 'oklch(0.7 0.4 150)',
          hex: '#00d600',
          source: 'tokens.css',
          token: 'vivid',
        },
      ]);
    });

    it('reports a color it cannot hold and leaves it out', () => {
      const result = map(
        token('color', 'ring', 'oklch(0.7 0.1 250 / 50%)'),
        token('color', 'overlay', '#00000080'),
        token('color', 'none', 'transparent'),
        token('color', 'wide', 'lab(50 20 20)'),
      );
      expect(result.fields).toEqual({});
      expect(result.report.unsupported.map((u) => [u.token, u.reason])).toEqual([
        ['ring', 'color-alpha'],
        ['overlay', 'color-alpha'],
        ['none', 'color-format'],
        ['wide', 'color-format'],
      ]);
      expect(result.report.unsupported[0]).toMatchObject({
        value: 'oklch(0.7 0.1 250 / 50%)',
        source: 'tokens.css',
      });
    });
  });

  describe('other values', () => {
    it('writes a bare 0 as 0px for a radius and as the number 0 for spacing', () => {
      const result = map(token('radius', 'radius-none', '0'), token('spacing', 'spacing-0', '0'));
      expect(result.fields).toEqual({ rounded: { none: '0px' }, spacing: { 0: 0 } });
    });

    it('reports a value with a unit DESIGN.md does not take', () => {
      const result = map(
        token('radius', 'radius-full', '50%'),
        token('radius', 'radius-sm', 'calc(0.5rem - 2px)'),
        token('spacing', 'spacing-fluid', 'clamp(1rem, 2vw, 2rem)'),
        token('fontSize', 'text-fluid', 'clamp(1rem, 2vw, 2rem)'),
        token('lineHeight', 'leading-loose', '150%'),
        token('fontSize', 'text-unitless', '16'),
        token('unknown', 'misc', '42'),
      );
      expect(result.fields).toEqual({});
      expect(result.sections).toEqual([]);
      expect(result.report.unsupported.map((u) => [u.token, u.reason])).toEqual([
        ['radius-full', 'dimension'],
        ['radius-sm', 'dimension'],
        ['spacing-fluid', 'dimension'],
        ['text-fluid', 'dimension'],
        ['leading-loose', 'dimension'],
        ['text-unitless', 'dimension'],
        ['misc', 'type'],
      ]);
    });
  });

  describe('var()', () => {
    it('replaces a var() with the scanned token it names, through a chain and across files', () => {
      const result = mapTokensToDesignFields([
        file('theme.css', token('color', 'color-ink', 'var(--color-text)')),
        file(
          'base.css',
          token('color', 'color-text', 'var(--brand)'),
          token('color', 'brand', 'oklch(0.5 0 0)'),
        ),
      ]);
      expect(result.fields.colors).toEqual({ ink: '#636363', text: '#636363', brand: '#636363' });
      expect(result.origins['colors.ink']).toEqual({ source: 'theme.css', token: 'color-ink' });
      expect(result.report.unresolved).toEqual([]);
    });

    it('uses the fallback only when the token is not scanned', () => {
      const result = map(
        token('color', 'a', 'var(--missing, rgb(0 0 0))'),
        token('color', 'b', 'var(--c, #ff0000)'),
        token('color', 'c', '#00ff00'),
      );
      expect(result.fields.colors).toEqual({ a: '#000000', b: '#00ff00', c: '#00ff00' });
    });

    it('substitutes inside a color function', () => {
      const result = map(
        token('unknown', 'hue', '210'),
        token('color', 'accent', 'hsl(var(--hue) 50% 40%)'),
      );
      expect(result.fields.colors).toEqual({ accent: '#336699' });
    });

    it('reports a var() that names nothing, or names itself', () => {
      const result = map(
        token('color', 'lost', 'var(--nope)'),
        token('color', 'loop-a', 'var(--loop-b)'),
        token('color', 'loop-b', 'var(--loop-a)'),
        token('color', 'self', 'var(--self)'),
        token('color', 'open', 'var(--nope'),
      );
      expect(result.fields).toEqual({});
      expect(result.report.unresolved.map((u) => [u.token, u.reason])).toEqual([
        ['lost', 'undefined'],
        ['loop-a', 'cycle'],
        ['loop-b', 'cycle'],
        ['self', 'cycle'],
        ['open', 'undefined'],
      ]);
      expect(result.report.unresolved[0]).toMatchObject({ value: 'var(--nope)' });
    });

    it('does not resolve through a value that only a theme variant defines', () => {
      const result = map(
        token('color', 'bg', '#000000', { block: '[data-theme="dark"]' }),
        token('color', 'surface', 'var(--bg)'),
      );
      expect(result.report.unresolved.map((u) => u.token)).toEqual(['surface']);
    });
  });

  describe('themes and repeated names', () => {
    it('keeps the default block and lists the other themes as not imported', () => {
      const dark = '[data-theme="dark"]';
      const result = map(
        token('color', 'bg', '#ffffff'),
        token('color', 'bg', '#000000', { block: dark }),
        token('color', 'only-dark', '#111111', { block: dark }),
      );
      expect(result.fields.colors).toEqual({ bg: '#ffffff' });
      expect(result.report.otherThemes).toEqual([
        { block: dark, value: '#000000', source: 'tokens.css', token: 'bg' },
        { block: dark, value: '#111111', source: 'tokens.css', token: 'only-dark' },
      ]);
    });

    it('ignores the same value again and reports a different one, keeping the first', () => {
      const result = mapTokensToDesignFields([
        file('a.css', token('color', 'brand', '#ff0000'), token('radius', 'radius-md', '4px')),
        file(
          'b.css',
          token('color', 'color-brand', 'rgb(255 0 0)'),
          token('radius', 'radius-md', '8px'),
        ),
      ]);
      expect(result.fields).toEqual({ colors: { brand: '#ff0000' }, rounded: { md: '4px' } });
      expect(result.origins['colors.brand']).toEqual({ source: 'a.css', token: 'brand' });
      expect(result.report.shadowed).toEqual([
        {
          path: 'rounded.md',
          value: '8px',
          kept: { source: 'a.css', token: 'radius-md' },
          source: 'b.css',
          token: 'radius-md',
        },
      ]);
    });
  });

  it('maps a Tailwind v4 stylesheet end to end into a DESIGN.md that validates', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'design-fields-'));
    const path = join(dir, 'globals.css');
    await writeFile(
      path,
      [
        '@import "tailwindcss";',
        ':root {',
        '  --radius: 0.625rem;',
        '  --background: oklch(1 0 0);',
        '  --foreground: oklch(0.145 0 0);',
        '  --primary: oklch(0.205 0 0);',
        '  --ring: oklch(0.708 0 0 / 50%);',
        '}',
        '[data-theme="dark"] {',
        '  --background: oklch(0.145 0 0);',
        '}',
        '@theme inline {',
        '  --font-sans: Inter, ui-sans-serif, system-ui;',
        '  --color-background: var(--background);',
        '  --color-primary: var(--primary);',
        '  --radius-lg: var(--radius);',
        '  --radius-sm: calc(var(--radius) - 4px);',
        '}',
        '',
      ].join('\n'),
    );
    const tokens = [
      ...(await extractFromTailwindConfig(path)),
      ...(await extractFromCssVars(path)),
    ];
    const result = mapTokensToDesignFields([{ path: 'globals.css', tokens }]);

    expect(result.fields).toEqual({
      colors: { background: '#ffffff', primary: '#171717', foreground: '#0a0a0a' },
      typography: { sans: { fontFamily: 'Inter, ui-sans-serif, system-ui' } },
      rounded: { lg: '0.625rem', base: '0.625rem' },
    });
    expect(result.report.otherThemes.map((o) => [o.token, o.block])).toEqual([
      ['background', '[data-theme="dark"]'],
    ]);
    expect(result.report.unsupported.map((u) => [u.token, u.reason])).toEqual([
      ['radius-sm', 'dimension'],
      ['ring', 'color-alpha'],
    ]);
    expect(result.report.unresolved).toEqual([]);

    const raw = serializeDesignMd({
      frontmatter: { name: 'Imported', ...result.fields },
      sections: result.sections,
    });
    expect(validateDesignMd(raw)).toEqual([]);
  });
});
