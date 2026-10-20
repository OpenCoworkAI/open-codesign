import { describe, expect, it } from 'vitest';
import {
  type DesignMdFrontmatter,
  formatDesignMdForPrompt,
  parseDesignMd,
  serializeDesignMd,
  validateDesignMd,
} from './design-md';

const VALID_DESIGN_MD = `---
version: alpha
name: Heritage
description: Premium editorial product surface
colors:
  primary: "#1A1C1E"
  secondary: "#6C7278"
  tertiary: "#B8422E"
typography:
  h1:
    fontFamily: Public Sans
    fontSize: 48px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.02em
rounded:
  sm: 4px
  md: 8px
spacing:
  sm: 8px
  md: 16px
components:
  button-primary:
    backgroundColor: "{colors.tertiary}"
    textColor: "#ffffff"
    typography: "{typography.h1}"
    rounded: "{rounded.sm}"
    padding: 12px
---

## Overview

Architectural minimalism meets journalistic gravitas.

## Colors

The palette is rooted in high-contrast neutrals.

## Typography

Public Sans carries both display and body copy.

## Layout

Use a fixed max-width grid with generous section rhythm.

## Elevation & Depth

Depth is achieved through tonal layers.

## Shapes

Small radii keep the interface precise.

## Components

Buttons are direct and editorial.

## Do's and Don'ts

Do use restraint. Don't use decorative gradients.
`;

describe('Google DESIGN.md helpers', () => {
  it('preserves string component extensions with warnings per the upstream consumer contract', () => {
    const raw = VALID_DESIGN_MD.replace(
      '    padding: 12px',
      '    padding: 12px\n    minHeight: 44px\n    borderRadius: 16px',
    );
    const findings = validateDesignMd(raw);
    expect(findings).toEqual([
      expect.objectContaining({ severity: 'warning', path: 'components.button-primary.minHeight' }),
      expect.objectContaining({
        severity: 'warning',
        path: 'components.button-primary.borderRadius',
      }),
    ]);
    expect(parseDesignMd(raw).frontmatter['components']).toMatchObject({
      'button-primary': { minHeight: '44px', borderRadius: '16px' },
    });
    expect(formatDesignMdForPrompt(raw)).toContain('minHeight: 44px');
  });

  it.each([
    '44',
    '{ value: 44px }',
    '[44px]',
    'null',
  ])('keeps non-string component extensions blocking: %s', (value) => {
    const findings = validateDesignMd(
      VALID_DESIGN_MD.replace('    padding: 12px', `    minHeight: ${value}`),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        path: 'components.button-primary.minHeight',
        message: 'Expected a string or token reference',
      }),
    );
  });

  it('gives concrete object repair shapes instead of just naming rejected types', () => {
    const findings = validateDesignMd(`---
name: Example
typography:
  body: system-ui
components:
  button: comfortable touch target
---`);
    expect(findings).toEqual([
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('fontFamily: "system-ui"'),
      }),
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('rounded: "8px"'),
      }),
    ]);
  });

  it('parses and validates the Google README-style format', () => {
    const parsed = parseDesignMd(VALID_DESIGN_MD);
    expect(parsed.frontmatter['name']).toBe('Heritage');
    expect(parsed.bodySections.map((section) => section.heading)).toEqual([
      'Overview',
      'Colors',
      'Typography',
      'Layout',
      'Elevation & Depth',
      'Shapes',
      'Components',
      "Do's and Don'ts",
    ]);
    expect(validateDesignMd(VALID_DESIGN_MD).filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('preserves unknown top-level fields with actionable non-blocking warnings', () => {
    const raw = VALID_DESIGN_MD.replace('rounded:', 'radius:').replace(
      'spacing:',
      'shadows:\n  card: "0 2px 8px #000000"\ncustomMetadata:\n  tags: [editorial, premium]\nspacing:',
    );
    expect(validateDesignMd(raw)).toEqual([
      expect.objectContaining({
        severity: 'warning',
        path: 'radius',
        message: expect.stringContaining('rounded'),
      }),
      expect.objectContaining({
        severity: 'warning',
        path: 'shadows',
        message: expect.stringContaining('Elevation & Depth'),
      }),
      expect.objectContaining({ severity: 'warning', path: 'customMetadata' }),
    ]);
    const parsed = parseDesignMd(raw);
    expect(parsed.frontmatter['radius']).toEqual({ sm: '4px', md: '8px' });
    expect(parsed.frontmatter['rounded']).toBeUndefined();
    expect(parsed.frontmatter['shadows']).toEqual({ card: '0 2px 8px #000000' });
    expect(parsed.frontmatter['customMetadata']).toEqual({ tags: ['editorial', 'premium'] });
    expect(formatDesignMdForPrompt(raw)).toContain(parsed.frontmatterText);
  });

  it.each([
    '0',
    '"0"',
    '.02em',
    '-.02em',
    '.5px',
    '-.5rem',
    '0px',
    '-0.02em',
  ])('accepts CSS zero and dimension spellings across token groups: %s', (value) => {
    const raw = VALID_DESIGN_MD.replace('fontSize: 48px', `fontSize: ${value}`)
      .replace('lineHeight: 1.1', `lineHeight: ${value}`)
      .replace('letterSpacing: -0.02em', `letterSpacing: ${value}`)
      .replace('sm: 4px', `sm: ${value}`)
      .replace('sm: 8px', `sm: ${value}`);
    expect(validateDesignMd(raw)).toEqual([]);
  });

  it.each([
    '0.5',
    '"0.5"',
    '16',
    '".5"',
    'true',
    'null',
    '[]',
    '{}',
    '.inf',
    '1vw',
    '1%',
  ])('keeps nonzero unitless and malformed dimensions blocking: %s', (value) => {
    expect(
      validateDesignMd(
        VALID_DESIGN_MD.replace('letterSpacing: -0.02em', `letterSpacing: ${value}`),
      ),
    ).toContainEqual(
      expect.objectContaining({ severity: 'error', path: 'typography.h1.letterSpacing' }),
    );
  });

  it('keeps typography structure errors blocking alongside top-level extension warnings', () => {
    const raw = VALID_DESIGN_MD.replace('rounded:', 'radius:').replace(
      'typography:',
      'typography:\n  fontFamily: Public Sans',
    );
    expect(validateDesignMd(raw)).toEqual([
      expect.objectContaining({ severity: 'warning', path: 'radius' }),
      expect.objectContaining({
        severity: 'error',
        path: 'typography.fontFamily',
        message: expect.stringContaining('typography: { body: { fontFamily:'),
      }),
    ]);
  });

  it.each([
    VALID_DESIGN_MD.replace('name: Heritage', 'name: Heritage\nname: Duplicate'),
    VALID_DESIGN_MD.replace('name: Heritage', 'name: [unterminated'),
    VALID_DESIGN_MD.replace('name: Heritage\n', ''),
  ])('keeps invalid frontmatter blocking when extensions are present', (invalid) => {
    expect(
      validateDesignMd(invalid.replace('rounded:', 'radius:')).some(
        (finding) => finding.severity === 'error',
      ),
    ).toBe(true);
  });

  it('rejects old typography weight keys instead of treating them as fontWeight', () => {
    const findings = validateDesignMd(VALID_DESIGN_MD.replace('fontWeight: 600', 'weight: 600'));
    expect(findings).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        path: 'typography.h1.weight',
      }),
    );
  });

  it('rejects invalid colors and duplicate known sections', () => {
    const badColor = validateDesignMd(VALID_DESIGN_MD.replace('"#1A1C1E"', '"oklch(0.4 0 0)"'));
    expect(badColor).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        path: 'colors.primary',
      }),
    );

    const duplicateSection = validateDesignMd(
      `${VALID_DESIGN_MD}\n\n## Colors\n\nSecond colors section.`,
    );
    expect(duplicateSection).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        path: 'body.Colors',
      }),
    );
  });

  it('rejects oversized YAML frontmatter instead of truncating token data', () => {
    const oversized = `---\nname: Huge\ncolors:\n  primary: "#111111"\ndescription: "${'x'.repeat(70_000)}"\n---\n\n## Overview\n\nToo large.`;
    expect(validateDesignMd(oversized)).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        path: 'frontmatter',
      }),
    );
  });

  it('rejects numeric component values instead of treating them as token strings', () => {
    const findings = validateDesignMd(VALID_DESIGN_MD.replace('padding: 12px', 'padding: 12'));
    expect(findings).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        path: 'components.button-primary.padding',
      }),
    );
  });

  it('preserves unknown markdown sections while keeping them out of token validation', () => {
    const withUnknown = `${VALID_DESIGN_MD}\n\n## Voice\n\nWarm, exact, and quiet.`;
    const parsed = parseDesignMd(withUnknown);
    expect(parsed.bodySections.at(-1)?.heading).toBe('Voice');
    expect(validateDesignMd(withUnknown).filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('formats prompt context with full frontmatter and capped body prose', () => {
    const longBody = `${VALID_DESIGN_MD}\n\n## Voice\n\n${'x'.repeat(2500)}`;
    const formatted = formatDesignMdForPrompt(longBody);
    expect(formatted).toContain('---\nversion: alpha');
    expect(formatted).toContain('colors:');
    expect(formatted.length).toBeLessThan(longBody.length);
    expect(formatted).toContain('[DESIGN.md body truncated to 2000 chars]');
  });

  it('preserves the original YAML frontmatter text in prompt context', () => {
    const raw = `---
name: Preserve Order
# user-authored note
version: alpha
colors:
  primary: "#111111"
---

## Overview

Keep original frontmatter ordering.
`;
    const formatted = formatDesignMdForPrompt(raw);
    expect(formatted).toContain(
      '---\nname: Preserve Order\n# user-authored note\nversion: alpha\ncolors:',
    );
  });

  it('prioritizes known Google sections before unknown sections when capping prompt prose', () => {
    const reordered = `---
version: alpha
name: Reordered
---

## Voice

${'x'.repeat(2500)}

## Overview

Keep this overview.

## Colors

Keep these colors.
`;
    const formatted = formatDesignMdForPrompt(reordered);
    expect(formatted.indexOf('## Overview')).toBeLessThan(formatted.indexOf('## Voice'));
    expect(formatted).toContain('Keep this overview.');
    expect(formatted).toContain('Keep these colors.');
    expect(formatted).toContain('[DESIGN.md body truncated to 2000 chars]');
  });
});

describe('serializeDesignMd', () => {
  const frontmatter = {
    name: 'Imported: "Acme"',
    version: 'alpha',
    colors: { primary: '#1a1c1e', 'brand-500': '#fff' },
    typography: {
      sans: { fontFamily: 'Inter, ui-sans-serif, system-ui' },
      mono: { fontFamily: '"JetBrains Mono", monospace' },
    },
    rounded: { lg: '0.5rem', none: '0px' },
    spacing: { base: '0.25rem', zero: 0, '4': '1rem' },
  };

  it('writes a document that validates and parses back to the same fields', () => {
    const raw = serializeDesignMd({
      frontmatter,
      sections: [{ heading: 'Overview', content: 'Imported from the project.' }],
    });
    expect(validateDesignMd(raw)).toEqual([]);
    const doc = parseDesignMd(raw);
    expect(doc.frontmatter).toEqual(frontmatter);
    expect(doc.bodySections).toEqual([
      { heading: 'Overview', content: 'Imported from the project.' },
    ]);
  });

  it('writes every frontmatter field, so the field list and the type cannot drift', () => {
    const everyField: Required<DesignMdFrontmatter> = {
      version: 'alpha',
      name: 'X',
      description: 'Every field.',
      colors: { primary: '#111111' },
      typography: { body: { fontFamily: 'Inter' } },
      rounded: { sm: '4px' },
      spacing: { sm: '8px' },
      components: { button: { backgroundColor: '#111111' } },
    };
    const raw = serializeDesignMd({ frontmatter: everyField });
    expect(Object.keys(parseDesignMd(raw).frontmatter)).toEqual(Object.keys(everyField));
    expect(parseDesignMd(raw).frontmatter).toEqual(everyField);
    expect(validateDesignMd(raw)).toEqual([]);
  });

  it('keeps hex colors as strings', () => {
    const raw = serializeDesignMd({
      frontmatter: { name: 'X', colors: { a: '#fff', b: '#000000' } },
    });
    expect(parseDesignMd(raw).frontmatter['colors']).toEqual({ a: '#fff', b: '#000000' });
  });

  it('writes fields and sections in the canonical order whatever order they arrive in', () => {
    const raw = serializeDesignMd({
      frontmatter: {
        spacing: { sm: '8px' },
        colors: { a: '#ffffff' },
        name: 'X',
        version: 'alpha',
      },
      sections: [
        { heading: 'Typography', content: 'Type.' },
        { heading: 'Notes', content: 'Extra.' },
        { heading: 'Overview', content: 'Intro.' },
      ],
    });
    expect(Object.keys(parseDesignMd(raw).frontmatter)).toEqual([
      'version',
      'name',
      'colors',
      'spacing',
    ]);
    expect(parseDesignMd(raw).bodySections.map((section) => section.heading)).toEqual([
      'Overview',
      'Typography',
      'Notes',
    ]);
    expect(validateDesignMd(raw)).toEqual([]);
  });

  it('writes only the frontmatter when there are no sections', () => {
    const raw = serializeDesignMd({ frontmatter: { name: 'X' } });
    expect(raw).toBe('---\nname: X\n---\n');
    expect(parseDesignMd(raw).body).toBe('');
  });

  it('does not fold long values', () => {
    const fontFamily = Array.from({ length: 40 }, (_, n) => `Font Number ${n}`).join(', ');
    const raw = serializeDesignMd({
      frontmatter: { name: 'X', typography: { t: { fontFamily } } },
    });
    expect(raw.split('\n').some((line) => line.includes(fontFamily))).toBe(true);
    expect(parseDesignMd(raw).frontmatter['typography']).toEqual({ t: { fontFamily } });
  });

  it('keeps a multi-line description', () => {
    const description = 'First line.\nSecond line: with a colon.';
    const raw = serializeDesignMd({ frontmatter: { name: 'X', description } });
    expect(parseDesignMd(raw).frontmatter['description']).toBe(description);
  });
});
