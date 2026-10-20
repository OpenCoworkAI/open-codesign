import { describe, expect, it } from 'vitest';
import { cssColorToHex } from './color.js';

const ok = (hex: string, clamped = false) => ({ ok: true, hex, clamped });

describe('cssColorToHex()', () => {
  describe('hex', () => {
    it.each([
      ['#fff', '#ffffff'],
      ['#ABC', '#aabbcc'],
      ['#FFAA00', '#ffaa00'],
      ['#f00f', '#ff0000'],
      ['#ff0000ff', '#ff0000'],
    ])('%s -> %s', (input, hex) => {
      expect(cssColorToHex(input)).toEqual(ok(hex));
    });

    it.each(['#f008', '#ff000080'])('reports alpha for %s', (input) => {
      expect(cssColorToHex(input)).toEqual({ ok: false, reason: 'alpha' });
    });

    it.each(['#ggg', '#12345', '#', 'fff'])('reports the format of %s', (input) => {
      expect(cssColorToHex(input)).toEqual({ ok: false, reason: 'format' });
    });
  });

  describe('rgb()', () => {
    it.each([
      ['rgb(255, 0, 0)', '#ff0000'],
      ['rgb(255 128 0)', '#ff8000'],
      ['rgba(255, 0, 0, 1)', '#ff0000'],
      ['rgb(255 0 0 / 100%)', '#ff0000'],
      ['rgb(100% 50% 0%)', '#ff8000'],
      ['RGB(0,0,0)', '#000000'],
    ])('%s -> %s', (input, hex) => {
      expect(cssColorToHex(input)).toEqual(ok(hex));
    });

    it.each([
      'rgb(255 0 0 / 50%)',
      'rgba(0, 0, 0, .5)',
      'rgb(0 0 0 / 0)',
    ])('reports alpha for %s', (input) => {
      expect(cssColorToHex(input)).toEqual({ ok: false, reason: 'alpha' });
    });

    it('clamps a channel outside 0-255 and says so', () => {
      expect(cssColorToHex('rgb(300 -4 0)')).toEqual(ok('#ff0000', true));
    });

    it.each([
      'rgb(1 2)',
      'rgb(1 2 3 4 5)',
      'rgb(1 2 3 4)',
      'rgb(1, 2, 3, 4, 5)',
      'rgb(1 2 3 / 0.5 / 0.2)',
      'rgb()',
      'rgb(1deg 2 3)',
      'rgb(red)',
    ])('reports the format of %s', (input) => {
      expect(cssColorToHex(input)).toEqual({ ok: false, reason: 'format' });
    });
  });

  describe('hsl()', () => {
    it.each([
      ['hsl(0 100% 50%)', '#ff0000'],
      ['hsl(120, 100%, 25%)', '#008000'],
      ['hsl(210 50% 40%)', '#336699'],
      ['hsl(30deg 80% 60%)', '#eb9947'],
      ['hsl(-120 100% 50%)', '#0000ff'],
      ['hsl(0.5turn 100% 50%)', '#00ffff'],
      ['hsl(200grad 100% 50%)', '#00ffff'],
      ['hsla(0, 0%, 100%, 1)', '#ffffff'],
      ['hsl(359 100% 50%)', '#ff0004'],
    ])('%s -> %s', (input, hex) => {
      expect(cssColorToHex(input)).toEqual(ok(hex));
    });

    it('reports alpha', () => {
      expect(cssColorToHex('hsl(0 100% 50% / 0.5)')).toEqual({ ok: false, reason: 'alpha' });
    });

    it.each([
      'hsl(0 100 50)',
      'hsl(0 100%)',
      'hsl(red 100% 50%)',
    ])('reports the format of %s', (input) => {
      expect(cssColorToHex(input)).toEqual({ ok: false, reason: 'format' });
    });
  });

  // Expected values come from a separate implementation: the CSS Color 4 reference route
  // (OKLab -> LMS -> XYZ D65 -> linear sRGB), not the matrices used in color.ts. The Tailwind
  // v4 entries match the hex values Tailwind documents for those palette steps.
  describe('oklch()', () => {
    it.each([
      ['oklch(1 0 0)', '#ffffff'],
      ['oklch(0 0 0)', '#000000'],
      ['oklch(0.5 0 0)', '#636363'],
      ['oklch(0.627955 0.257683 29.2339)', '#ff0000'],
      ['oklch(0.452014 0.313214 264.052)', '#0000ff'],
      ['oklch(0.86644 0.294827 142.495)', '#00ff00'],
      ['oklch(0.7 0.15 250)', '#4ba3f7'],
      ['oklch(0.5 0.1 0)', '#904961'],
      ['oklch(0.75 0.12 120)', '#a4b95e'],
      ['oklch(0.637 0.237 25.331)', '#fb2c36'],
      ['oklch(0.551 0.027 264.364)', '#6a7282'],
      ['oklch(0.97 0.014 254.604)', '#eff6ff'],
    ])('in gamut: %s -> %s', (input, hex) => {
      expect(cssColorToHex(input)).toEqual(ok(hex));
    });

    it.each([
      ['oklch(0.7 0.4 150)', '#00d600'],
      ['oklch(0.9 0.35 200)', '#00ffff'],
      ['oklch(0.3 0.3 30)', '#8f0000'],
    ])('out of gamut: %s is clamped to %s and says so', (input, hex) => {
      expect(cssColorToHex(input)).toEqual(ok(hex, true));
    });

    // Only a clamp that changes a channel by a full step counts: the hex is the same as the
    // rounded unclamped color, so a channel 0.06 steps outside sRGB is not reported.
    it.each([
      ['oklch(0.627955 0.2577 29.2339)', false],
      ['oklch(0.627955 0.258 29.2339)', true],
      ['oklch(1.001 0 0)', false],
      ['oklch(1.002 0 0)', true],
      ['oklch(1.01 0 0)', true],
    ])('reports %s as clamped: %s', (input, clamped) => {
      const result = cssColorToHex(input);
      expect(result).toMatchObject({ ok: true, clamped });
      expect(result).toHaveProperty('hex', input.startsWith('oklch(0.6') ? '#ff0000' : '#ffffff');
    });

    it('treats an achromatic color as a gray of the same lightness', () => {
      expect(cssColorToHex('oklch(0.5 0 0)')).toEqual(cssColorToHex('oklch(0.5 0 217)'));
      expect(cssColorToHex('oklch(0.5 none none)')).toEqual(ok('#636363'));
    });

    it.each([
      ['oklch(50% 0 0)', '#636363'],
      ['OKLCH(0.5 0% 0deg)', '#636363'],
      ['oklch(0.75 30% 120)', '#a4b95e'],
      ['oklch(0.75 0.12 0.3333333333turn)', '#a4b95e'],
      ['oklch(0.75 0.12 133.33333grad)', '#a4b95e'],
      ['oklch(0.75 0.12 2.0943951rad)', '#a4b95e'],
      ['oklch(0.5 0.1 0 / 1)', '#904961'],
      ['oklch(0.5 0.1 0 / 100%)', '#904961'],
    ])('accepts the notation %s', (input, hex) => {
      expect(cssColorToHex(input)).toEqual(ok(hex));
    });

    it('reports alpha', () => {
      expect(cssColorToHex('oklch(0.5 0.1 0 / 50%)')).toEqual({ ok: false, reason: 'alpha' });
    });

    it.each([
      'oklch(0.5 0.1)',
      'oklch(0.5 0.1 0 0)',
      'oklch(0.5, 0.1, 0)',
      'oklch(from red l c h)',
      'oklch(0.5 0.1 0px)',
      'oklch(0.5deg 0.1 0)',
    ])('reports the format of %s', (input) => {
      expect(cssColorToHex(input)).toEqual({ ok: false, reason: 'format' });
    });
  });

  it.each([
    'red',
    'transparent',
    'currentColor',
    'var(--brand)',
    'lab(50 20 20)',
    'color-mix(in srgb, red, blue)',
    '',
  ])('reports the format of %j', (input) => {
    expect(cssColorToHex(input)).toEqual({ ok: false, reason: 'format' });
  });
  // The input is CSS from a folder the user picked, which can be someone else's repository.
  describe('long input', () => {
    const LONG = 100_000;
    const fast = (value: string) => {
      const start = performance.now();
      const result = cssColorToHex(value);
      expect(performance.now() - start).toBeLessThan(250);
      return result;
    };

    it.each([
      ['whitespace inside the parentheses', `rgb(${'\t'.repeat(LONG)}(`],
      ['whitespace before the closing parenthesis', `rgb(1${' '.repeat(LONG)}x)`],
      ['digits before a bad suffix', `rgb(${'1'.repeat(LONG)}x 0 0)`],
      ['an exponent without digits', `rgb(1${'e'.repeat(LONG)} 0 0)`],
    ])('is rejected in linear time: %s', (_name, input) => {
      expect(fast(input)).toEqual({ ok: false, reason: 'format' });
    });

    it('still converts a long run of whitespace between valid parts', () => {
      expect(
        fast(
          `rgb(${' '.repeat(LONG)}255${' '.repeat(LONG)}0${' '.repeat(LONG)}0${' '.repeat(LONG)})`,
        ),
      ).toEqual(ok('#ff0000'));
    });
  });
});
