import type { LayoutIssue } from '@open-codesign/core';
import { describe, expect, it } from 'vitest';
import {
  analyzeLayoutSamples,
  compositeOver,
  contrastRatio,
  measureTextContrast,
  relativeLuminance,
  selectIssues,
  toHex,
} from './layout-analysis';
import { OVERFLOW_TOLERANCE_PX, type Rgba, type TextGroup } from './layout-samples';
import { samples } from './layout-test-fixtures';

const WHITE: Rgba = [255, 255, 255, 1];
const group = (overrides: Partial<TextGroup> = {}): TextGroup => ({
  selector: 'p.note',
  count: 1,
  foreground: [119, 119, 119, 1],
  layers: [],
  large: false,
  ...overrides,
});

describe('colour maths', () => {
  it('computes the relative luminance of black, white and a grey', () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 10);
    expect(relativeLuminance([119, 119, 119])).toBeCloseTo(0.1845, 4);
  });

  it('computes WCAG contrast ratios the way the standard lists them', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 10);
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 10);
    expect(contrastRatio([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 2);
    expect(contrastRatio([118, 118, 118], [255, 255, 255])).toBeCloseTo(4.54, 2);
    expect(contrastRatio([10, 20, 30], [10, 20, 30])).toBe(1);
  });

  it('lays a translucent colour over an opaque one', () => {
    expect(compositeOver([0, 0, 0, 0.5], [255, 255, 255])).toEqual([127.5, 127.5, 127.5]);
    expect(compositeOver([10, 20, 30, 1], [200, 200, 200])).toEqual([10, 20, 30]);
    expect(compositeOver([10, 20, 30, 0], [200, 200, 200])).toEqual([200, 200, 200]);
  });

  it('writes colours as hex, rounding and keeping them in range', () => {
    expect(toHex([127.5, 0, 255])).toBe('#8000ff');
    expect(toHex([-4, 300, 1.2])).toBe('#00ff01');
  });
});

describe('measureTextContrast', () => {
  it('measures text on white when no background is set', () => {
    const { ratio, text, backdrop } = measureTextContrast({
      foreground: [119, 119, 119, 1],
      layers: [],
    });

    expect(backdrop).toEqual([255, 255, 255]);
    expect(text).toEqual([119, 119, 119]);
    expect(ratio).toBeCloseTo(4.48, 2);
  });

  it('lays the backgrounds over white from the outermost to the innermost', () => {
    // The innermost is half-transparent black over an opaque blue.
    const { backdrop } = measureTextContrast({
      foreground: WHITE,
      layers: [
        [0, 0, 0, 0.5],
        [0, 0, 255, 1],
      ],
    });

    expect(backdrop).toEqual([0, 0, 127.5]);
  });

  it('lays translucent text over the backdrop it sits on', () => {
    const { text, backdrop } = measureTextContrast({
      foreground: [0, 0, 0, 0.5],
      layers: [[255, 255, 255, 1]],
    });

    expect(backdrop).toEqual([255, 255, 255]);
    expect(text).toEqual([127.5, 127.5, 127.5]);
  });
});

describe('analyzeLayoutSamples: overflow and clipped text', () => {
  it('reports a page that fits, or is off by less than the tolerance, as clean', () => {
    expect(analyzeLayoutSamples(samples())).toEqual([]);
    expect(analyzeLayoutSamples(samples({ documentWidth: 390 + OVERFLOW_TOLERANCE_PX }))).toEqual(
      [],
    );
  });

  it('names each element that makes the page scroll sideways, with the numbers', () => {
    const issues = analyzeLayoutSamples(
      samples({
        documentWidth: 1412,
        overflowing: [
          { selector: 'table#prices', right: 1412 },
          { selector: 'main > div.hero', right: 960 },
        ],
      }),
    );

    expect(issues).toEqual([
      {
        check: 'horizontal-overflow',
        viewportWidth: 390,
        selector: 'table#prices',
        message:
          'table#prices reaches 1,412 px, past the 390 px viewport edge, so the page scrolls sideways.',
        measured: 1412,
        limit: 390,
      },
      {
        check: 'horizontal-overflow',
        viewportWidth: 390,
        selector: 'main > div.hero',
        message:
          'main > div.hero reaches 960 px, past the 390 px viewport edge, so the page scrolls sideways.',
        measured: 960,
        limit: 390,
      },
    ]);
  });

  it('still reports the overflow when no single element was identified', () => {
    expect(analyzeLayoutSamples(samples({ documentWidth: 520 }))).toEqual([
      {
        check: 'horizontal-overflow',
        viewportWidth: 390,
        selector: 'html',
        message:
          'The page is 520 px wide at a 390 px viewport, so it scrolls sideways; no single element was identified.',
        measured: 520,
        limit: 390,
      },
    ]);
  });

  it('does not report overflow the page hides, because it cannot scroll sideways', () => {
    expect(
      analyzeLayoutSamples(
        samples({
          documentWidth: 900,
          rootClipsX: true,
          overflowing: [{ selector: 'div.wide', right: 900 }],
        }),
      ),
    ).toEqual([]);
  });

  it('reports text a box clips on the side that sticks out', () => {
    const issues = analyzeLayoutSamples(
      samples({
        viewportWidth: 1280,
        documentWidth: 1280,
        clipped: [
          { selector: 'div#card', textRight: 340, boxRight: 300, textBottom: 60, boxBottom: 80 },
          { selector: 'p.teaser', textRight: 200, boxRight: 300, textBottom: 190, boxBottom: 120 },
        ],
      }),
    );

    expect(issues).toEqual([
      {
        check: 'clipped-text',
        viewportWidth: 1280,
        selector: 'div#card',
        message:
          'div#card hides part of its text: the text reaches 340 px but the box ends at 300 px (viewport 1,280 px).',
        measured: 340,
        limit: 300,
      },
      {
        check: 'clipped-text',
        viewportWidth: 1280,
        selector: 'p.teaser',
        message:
          'p.teaser hides part of its text: the text reaches 190 px from the top but the box ends at 120 px (viewport 1,280 px).',
        measured: 190,
        limit: 120,
      },
    ]);
  });
});

describe('analyzeLayoutSamples: contrast', () => {
  const contrastOf = (...groups: TextGroup[]) =>
    analyzeLayoutSamples(samples({ textGroups: groups })).filter(
      (issue) => issue.check === 'low-contrast',
    );

  it('reports text just under 4.5:1 and names both colours', () => {
    const [issue] = contrastOf(group());

    expect(issue).toEqual({
      check: 'low-contrast',
      viewportWidth: 390,
      selector: 'p.note',
      message: 'p.note has low text contrast: 4.47:1 for #777777 on #ffffff, but text needs 4.5:1.',
      measured: 4.47,
      limit: 4.5,
    });
  });

  it('never rounds a failing ratio up to the threshold', () => {
    // #777 is 4.478:1; rounded to two decimals it would read 4.48, still short of 4.5.
    const [issue] = contrastOf(group());

    expect(issue?.measured).toBe(4.47);
    expect(issue?.measured).toBeLessThan(4.5);
  });

  it('accepts text at or above 4.5:1', () => {
    expect(contrastOf(group({ foreground: [118, 118, 118, 1] }))).toEqual([]);
    expect(contrastOf(group({ foreground: [0, 0, 0, 1] }))).toEqual([]);
  });

  it('asks only 3:1 of large text', () => {
    // #949494 is 3.03:1 on white: enough for large text, not for body text.
    const grey: Rgba = [148, 148, 148, 1];

    expect(contrastOf(group({ foreground: grey, large: true }))).toEqual([]);
    const [issue] = contrastOf(group({ foreground: grey }));
    expect(issue?.limit).toBe(4.5);
    const [largeIssue] = contrastOf(group({ foreground: [170, 170, 170, 1], large: true }));
    expect(largeIssue?.limit).toBe(3);
    expect(largeIssue?.message).toContain('large text needs 3:1');
  });

  it('measures against the backgrounds laid over white', () => {
    const [issue] = contrastOf(
      group({ foreground: WHITE, layers: [[0, 0, 0, 0.5]], selector: 'h2.badge' }),
    );

    expect(issue?.message).toBe(
      'h2.badge has low text contrast: 3.97:1 for #ffffff on #808080, but text needs 4.5:1.',
    );
  });

  it('says how many text elements share a failing pair', () => {
    const [issue] = contrastOf(group({ count: 7 }));

    expect(issue?.message).toMatch(/ 7 text elements use this pair\.$/);
    expect(contrastOf(group({ count: 1 }))[0]?.message).not.toContain('use this pair');
  });

  it('lists the worst pair first and every failing pair', () => {
    const issues = contrastOf(
      group({ selector: 'a', foreground: [150, 150, 150, 1] }),
      group({ selector: 'b', foreground: [200, 200, 200, 1] }),
      group({ selector: 'c', foreground: [119, 119, 119, 1] }),
    );

    expect(issues.map((issue) => issue.selector)).toEqual(['b', 'a', 'c']);
  });
});

describe('analyzeLayoutSamples: small targets and names', () => {
  it('reports each small target with its size', () => {
    const issues = analyzeLayoutSamples(
      samples({ smallTargets: [{ selector: 'button.close', width: 16, height: 20 }] }),
    );

    expect(issues).toEqual([
      {
        check: 'small-target',
        viewportWidth: 390,
        selector: 'button.close',
        message:
          'button.close is 16 × 20 px; a tap target should be at least 24 × 24 px, or have that much room around it.',
        measured: 16,
        limit: 24,
      },
    ]);
  });

  it('reports each control with no name, without numbers', () => {
    const issues = analyzeLayoutSamples(
      samples({
        unnamedControls: [
          { selector: 'button.menu', kind: 'button' },
          { selector: 'div.toggle', kind: 'div role=switch' },
        ],
      }),
    );

    expect(issues).toEqual([
      {
        check: 'missing-name',
        viewportWidth: 390,
        selector: 'button.menu',
        message:
          'button.menu (button) has no accessible name: it has no text, aria-label, aria-labelledby, label or title.',
      },
      {
        check: 'missing-name',
        viewportWidth: 390,
        selector: 'div.toggle',
        message:
          'div.toggle (div role=switch) has no accessible name: it has no text, aria-label, aria-labelledby, label or title.',
      },
    ]);
    expect(issues[0]).not.toHaveProperty('measured');
  });

  it('lists the checks in one fixed order', () => {
    const issues = analyzeLayoutSamples(
      samples({
        documentWidth: 600,
        overflowing: [{ selector: 'div.wide', right: 600 }],
        clipped: [
          { selector: 'div#card', textRight: 340, boxRight: 300, textBottom: 60, boxBottom: 80 },
        ],
        textGroups: [group()],
        smallTargets: [{ selector: 'button.close', width: 16, height: 16 }],
        unnamedControls: [{ selector: 'button.menu', kind: 'button' }],
      }),
    );

    expect(issues.map((issue) => issue.check)).toEqual([
      'horizontal-overflow',
      'clipped-text',
      'low-contrast',
      'small-target',
      'missing-name',
    ]);
  });
});

describe('selectIssues', () => {
  const issue = (check: LayoutIssue['check'], index: number): LayoutIssue => ({
    check,
    viewportWidth: 390,
    selector: `${check}-${index}`,
    message: `${check} ${index}`,
  });

  it('keeps everything when it fits the budget', () => {
    const issues = [issue('low-contrast', 1), issue('missing-name', 1)];

    expect(selectIssues(issues, 5)).toBe(issues);
    expect(selectIssues(issues, 2)).toBe(issues);
  });

  it('takes one from each check in turn and keeps the original order', () => {
    const issues = [
      ...[1, 2, 3, 4, 5].map((index) => issue('horizontal-overflow', index)),
      ...[1, 2, 3, 4, 5].map((index) => issue('low-contrast', index)),
      issue('missing-name', 1),
    ];

    expect(selectIssues(issues, 4).map((item) => item.selector)).toEqual([
      'horizontal-overflow-1',
      'horizontal-overflow-2',
      'low-contrast-1',
      'missing-name-1',
    ]);
  });

  it('still shows a rare check when one check has far more findings than the budget', () => {
    const issues = [
      ...Array.from({ length: 40 }, (_, index) => issue('small-target', index)),
      issue('low-contrast', 1),
    ];

    const kept = selectIssues(issues, 20);

    expect(kept).toHaveLength(20);
    expect(kept.some((item) => item.check === 'low-contrast')).toBe(true);
  });
});
