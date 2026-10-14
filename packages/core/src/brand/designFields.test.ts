import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DesignToken, serializeDesignMd, validateDesignMd } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import { extractFromCssVars } from './cssVarExtractor.js';
import {
  MAX_RESOLVED_LENGTH,
  MAX_VAR_DEPTH,
  mapTokensToDesignFields,
  type TokenFile,
} from './designFields.js';
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

  describe('CSS spellings DESIGN.md does not take as written', () => {
    // DESIGN.md wants a digit before the point and a lowercase unit; CSS allows neither.
    it.each([
      ['.5rem', '0.5rem'],
      ['-.5rem', '-0.5rem'],
      ['1REM', '1rem'],
      ['.25EM', '0.25em'],
      ['8PX', '8px'],
      ['0.50rem', '0.50rem'],
    ])('writes %s as %s for a radius and for spacing', (written, written_) => {
      const result = map(
        token('radius', 'radius-a', written),
        token('spacing', 'spacing-a', written),
      );
      expect(result.fields).toEqual({ rounded: { a: written_ }, spacing: { a: written_ } });
      expect(result.report.unsupported).toEqual([]);
    });

    it.each([
      ['.5', 0.5],
      ['-.5', -0.5],
      ['1.50', 1.5],
    ])('writes a unitless spacing %s as the number %s', (written, number) => {
      expect(map(token('spacing', 'spacing-a', written)).fields.spacing).toEqual({ a: number });
    });

    it('accepts them for font sizes and line heights', () => {
      const result = map(
        token('fontSize', 'text-a', '.875REM'),
        token('lineHeight', 'leading-a', '.5'),
        token('lineHeight', 'leading-b', '1.5EM'),
      );
      expect(result.sections).toEqual([
        {
          heading: 'Typography',
          content: '- font size `a`: 0.875rem\n- line height `a`: .5\n- line height `b`: 1.5em',
        },
      ]);
    });

    it('treats the same length spelled two ways as one value', () => {
      const result = mapTokensToDesignFields([
        file('a.css', token('radius', 'radius-md', '.5rem'), token('spacing', 'spacing-1', '.5')),
        file('b.css', token('radius', 'radius-md', '0.5REM'), token('spacing', 'spacing-1', '0.5')),
      ]);
      expect(result.report.shadowed).toEqual([]);
    });

    it('still leaves out what is not a length', () => {
      const result = map(
        token('radius', 'radius-a', '5.rem'),
        token('radius', 'radius-b', '.rem'),
        token('spacing', 'spacing-a', '1.5vw'),
        token('spacing', 'spacing-b', '..5'),
      );
      expect(result.fields).toEqual({});
      expect(result.report.unsupported.map((u) => u.reason)).toEqual(Array(4).fill('dimension'));
    });

    it('produces a DESIGN.md that validates', () => {
      const result = map(
        token('radius', 'radius-a', '.5rem'),
        token('radius', 'radius-b', '1REM'),
        token('spacing', 'spacing-a', '-.5rem'),
        token('spacing', 'spacing-b', '.5'),
      );
      expect(result.fields).toEqual({
        rounded: { a: '0.5rem', b: '1rem' },
        spacing: { a: '-0.5rem', b: 0.5 },
      });
      const raw = serializeDesignMd({ frontmatter: { name: 'X', ...result.fields } });
      expect(validateDesignMd(raw)).toEqual([]);
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

    it('stops a chain nested deeper than the limit and resolves the ones within it', () => {
      const chain = Array.from({ length: MAX_VAR_DEPTH + 8 }, (_, i) =>
        token('color', `c${i}`, i === 0 ? '#112233' : `var(--c${i - 1})`),
      );
      const result = map(...chain);
      expect(Object.keys(result.fields.colors ?? {})).toEqual(
        chain.slice(0, MAX_VAR_DEPTH).map((c) => c.name),
      );
      expect(result.report.unresolved.map((u) => u.reason)).toEqual(Array(8).fill('too-complex'));
    });

    // Each level names the one below twice, so resolving it in full takes 2^levels steps.
    it('gives up on a value that grows past the limit instead of expanding it', () => {
      const levels = 20;
      const tokens = [
        token('shadow', 'l0', '0 0 0 #000'),
        ...Array.from({ length: levels }, (_, i) =>
          token('shadow', `l${i + 1}`, `var(--l${i}), var(--l${i})`),
        ),
      ];
      const start = performance.now();
      const result = map(...tokens);
      expect(performance.now() - start).toBeLessThan(250);
      const tooComplex = result.report.unresolved.filter((u) => u.reason === 'too-complex');
      expect(tooComplex.length).toBeGreaterThan(0);
      for (const line of result.sections[0]?.content.split('\n') ?? []) {
        expect(line.length).toBeLessThanOrEqual(MAX_RESOLVED_LENGTH + 20);
      }
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
