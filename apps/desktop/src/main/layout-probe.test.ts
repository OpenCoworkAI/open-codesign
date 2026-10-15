import { LAYOUT_WARNING_SOURCE, type LayoutIssue, MAX_LAYOUT_ISSUES } from '@open-codesign/core';
import type { Page } from 'puppeteer-core';
import { describe, expect, it } from 'vitest';
import {
  analyzeLayoutSamples,
  collectLayoutSamples,
  inspectLayout,
  LAYOUT_PROBE_LIMITS,
  type LayoutSamples,
  layoutFailureWarning,
  layoutWarnings,
  MAX_PROBE_ELEMENTS,
  OVERFLOW_TOLERANCE_PX,
  PHONE_VIEWPORT,
} from './layout-probe';

function samples(overrides: Partial<LayoutSamples> = {}): LayoutSamples {
  return {
    viewportWidth: 390,
    documentWidth: 390,
    rootClipsX: false,
    overflowing: [],
    clipped: [],
    truncated: false,
    ...overrides,
  };
}

describe('analyzeLayoutSamples', () => {
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

  it('lists overflow before clipped text, and reports clipped text on a page that hides overflow', () => {
    const issues = analyzeLayoutSamples(
      samples({
        documentWidth: 600,
        overflowing: [{ selector: 'div.wide', right: 600 }],
        clipped: [
          { selector: 'div#card', textRight: 340, boxRight: 300, textBottom: 60, boxBottom: 80 },
        ],
      }),
    );
    expect(issues.map((issue) => issue.check)).toEqual(['horizontal-overflow', 'clipped-text']);

    const hidden = analyzeLayoutSamples(
      samples({
        documentWidth: 600,
        rootClipsX: true,
        clipped: [
          { selector: 'div#card', textRight: 340, boxRight: 300, textBottom: 60, boxBottom: 80 },
        ],
      }),
    );
    expect(hidden.map((issue) => issue.check)).toEqual(['clipped-text']);
  });
});

describe('layout warnings', () => {
  it('shows each finding and note as a layout warning', () => {
    const issue: LayoutIssue = {
      check: 'horizontal-overflow',
      viewportWidth: 390,
      selector: 'html',
      message: 'The page scrolls sideways.',
      measured: 520,
      limit: 390,
    };

    expect(layoutWarnings({ issues: [issue], notes: ['Stopped after 5,000 elements.'] })).toEqual([
      { source: LAYOUT_WARNING_SOURCE, message: 'The page scrolls sideways.' },
      { source: LAYOUT_WARNING_SOURCE, message: 'Stopped after 5,000 elements.' },
    ]);
    expect(layoutWarnings({ issues: [], notes: [] })).toEqual([]);
  });

  it('says why the checks did not run', () => {
    expect(layoutFailureWarning(new Error('Preview operation timed out'))).toEqual({
      source: LAYOUT_WARNING_SOURCE,
      message: 'Layout checks did not run: Preview operation timed out',
    });
    expect(layoutFailureWarning('boom').message).toBe('Layout checks did not run: boom');
  });
});

interface FakePage {
  page: Page;
  viewports: Array<{ width: number; height: number }>;
}

/** A page whose measurements come from a script, one per call of the collector. */
function fakePage(
  original: { width: number; height: number } | null,
  measurements: Array<LayoutSamples | Error>,
): FakePage {
  const viewports: Array<{ width: number; height: number }> = [];
  const queue = [...measurements];
  const page = {
    viewport: () => original,
    setViewport: async (viewport: { width: number; height: number }) => {
      viewports.push(viewport);
    },
    evaluate: async (fn: unknown) => {
      if (fn !== collectLayoutSamples) return undefined;
      const next = queue.shift();
      if (next === undefined) throw new Error('Unexpected extra measurement');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { page: page as unknown as Page, viewports };
}

const desktop = { width: 1280, height: 800 };
const overflowAtPhone = samples({
  documentWidth: 700,
  overflowing: [{ selector: 'table#prices', right: 700 }],
});

describe('inspectLayout', () => {
  it('measures at the current width and at phone width, then restores the viewport', async () => {
    const { page, viewports } = fakePage(desktop, [
      samples({ viewportWidth: 1280, documentWidth: 1280 }),
      overflowAtPhone,
    ]);

    const inspection = await inspectLayout(page);

    expect(inspection.issues.map((issue) => [issue.check, issue.viewportWidth])).toEqual([
      ['horizontal-overflow', 390],
    ]);
    expect(inspection.notes).toEqual([]);
    expect(viewports).toEqual([{ ...desktop, ...PHONE_VIEWPORT }, desktop]);
  });

  it('does not resize a page that is already phone width', async () => {
    const { page, viewports } = fakePage({ width: PHONE_VIEWPORT.width, height: 700 }, [
      overflowAtPhone,
    ]);

    const inspection = await inspectLayout(page);

    expect(inspection.issues).toHaveLength(1);
    expect(viewports).toEqual([]);
  });

  it('restores the viewport and rejects when the phone measurement fails', async () => {
    const { page, viewports } = fakePage(desktop, [
      samples({ viewportWidth: 1280, documentWidth: 1280 }),
      new Error('Execution context was destroyed'),
    ]);

    await expect(inspectLayout(page)).rejects.toThrow('Execution context was destroyed');

    expect(viewports.at(-1)).toEqual(desktop);
  });

  it('rejects when the page has no viewport to measure', async () => {
    const { page } = fakePage(null, []);

    await expect(inspectLayout(page)).rejects.toThrow('The page has no viewport to measure');
  });

  it('keeps the first findings and says so when there are more than the budget', async () => {
    const clipped = Array.from({ length: MAX_LAYOUT_ISSUES }, (_, index) => ({
      selector: `p.item-${index}`,
      textRight: 400,
      boxRight: 300,
      textBottom: 20,
      boxBottom: 40,
    }));
    const { page } = fakePage(desktop, [
      samples({ viewportWidth: 1280, documentWidth: 1280, clipped }),
      overflowAtPhone,
    ]);

    const inspection = await inspectLayout(page);

    expect(inspection.issues).toHaveLength(MAX_LAYOUT_ISSUES);
    expect(inspection.issues.every((issue) => issue.check === 'clipped-text')).toBe(true);
    expect(inspection.notes).toEqual([
      `Layout checks found ${MAX_LAYOUT_ISSUES + 1} issues; only the first ${MAX_LAYOUT_ISSUES} are listed.`,
    ]);
  });

  it('says when the page was only measured in part', async () => {
    const { page } = fakePage(desktop, [
      samples({ viewportWidth: 1280, documentWidth: 1280, truncated: true }),
      samples(),
    ]);

    const inspection = await inspectLayout(page);

    expect(inspection.issues).toEqual([]);
    expect(inspection.notes).toEqual([
      `Layout checks stopped after ${MAX_PROBE_ELEMENTS.toLocaleString('en-US')} elements; the rest of the page was not measured.`,
    ]);
  });

  it('stops when the run is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { page } = fakePage(desktop, [samples(), samples()]);

    await expect(inspectLayout(page, controller.signal)).rejects.toThrow('Preview cancelled');
  });

  it('passes the documented limits to the page', () => {
    expect(LAYOUT_PROBE_LIMITS).toEqual({
      maxElements: 5000,
      overflowTolerance: 1,
      clipTolerance: 2,
      maxOverflowElements: 3,
      maxClippedTexts: 5,
    });
  });
});
