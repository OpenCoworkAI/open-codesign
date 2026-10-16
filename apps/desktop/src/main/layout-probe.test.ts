import { LAYOUT_WARNING_SOURCE, type LayoutIssue, MAX_LAYOUT_ISSUES } from '@open-codesign/core';
import type { Page } from 'puppeteer-core';
import { describe, expect, it } from 'vitest';
import {
  collectLayoutSamples,
  inspectLayout,
  layoutFailureWarning,
  layoutWarnings,
} from './layout-probe';
import {
  ALL_CHECKS,
  LAYOUT_PROBE_LIMITS,
  type LayoutProbeLimits,
  type LayoutSamples,
  PHONE_VIEWPORT,
} from './layout-samples';
import { samples } from './layout-test-fixtures';

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

    expect(layoutWarnings({ issues: [issue], notes: ['Not the whole page.'] })).toEqual([
      { source: LAYOUT_WARNING_SOURCE, message: 'The page scrolls sideways.' },
      { source: LAYOUT_WARNING_SOURCE, message: 'Not the whole page.' },
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
  /** The limits the page-side function was called with, one per measurement. */
  calls: LayoutProbeLimits[];
}

/** A page whose measurements come from a script, one per call of the collector. */
function fakePage(
  original: { width: number; height: number } | null,
  measurements: Array<LayoutSamples | Error>,
): FakePage {
  const viewports: Array<{ width: number; height: number }> = [];
  const calls: LayoutProbeLimits[] = [];
  const queue = [...measurements];
  const page = {
    viewport: () => original,
    setViewport: async (viewport: { width: number; height: number }) => {
      viewports.push(viewport);
    },
    evaluate: async (fn: unknown, limits: LayoutProbeLimits) => {
      if (fn !== collectLayoutSamples) return undefined;
      calls.push(limits);
      const next = queue.shift();
      if (next === undefined) throw new Error('Unexpected extra measurement');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { page: page as unknown as Page, viewports, calls };
}

const desktop = { width: 1280, height: 800 };
const atDesktop = (overrides: Partial<LayoutSamples> = {}) =>
  samples({ viewportWidth: 1280, documentWidth: 1280, ...overrides });
const overflowAtPhone = samples({
  documentWidth: 700,
  overflowing: [{ selector: 'table#prices', right: 700 }],
});

describe('inspectLayout', () => {
  it('measures at the current width and at phone width, then restores the viewport', async () => {
    const { page, viewports } = fakePage(desktop, [atDesktop(), overflowAtPhone]);

    const inspection = await inspectLayout(page);

    expect(inspection.issues.map((issue) => [issue.check, issue.viewportWidth])).toEqual([
      ['horizontal-overflow', 390],
    ]);
    expect(inspection.notes).toEqual([]);
    expect(viewports).toEqual([{ ...desktop, ...PHONE_VIEWPORT }, desktop]);
  });

  it('runs contrast and names at the current width, and tap targets at phone width', async () => {
    const { page, calls } = fakePage(desktop, [atDesktop(), samples()]);

    await inspectLayout(page);

    expect(calls.map((call) => call.checks)).toEqual([
      { overflow: true, clipped: true, contrast: true, targets: false, names: true },
      { overflow: true, clipped: true, contrast: false, targets: true, names: false },
    ]);
    expect(calls.every((call) => call.maxElements === LAYOUT_PROBE_LIMITS.maxElements)).toBe(true);
  });

  it('runs every check in one pass on a page that is already phone width', async () => {
    const { page, viewports, calls } = fakePage({ width: PHONE_VIEWPORT.width, height: 700 }, [
      overflowAtPhone,
    ]);

    const inspection = await inspectLayout(page);

    expect(inspection.issues).toHaveLength(1);
    expect(viewports).toEqual([]);
    expect(calls.map((call) => call.checks)).toEqual([ALL_CHECKS]);
  });

  it('restores the viewport and rejects when the phone measurement fails', async () => {
    const { page, viewports } = fakePage(desktop, [
      atDesktop(),
      new Error('Execution context was destroyed'),
    ]);

    await expect(inspectLayout(page)).rejects.toThrow('Execution context was destroyed');

    expect(viewports.at(-1)).toEqual(desktop);
  });

  it('rejects when the page has no viewport to measure', async () => {
    const { page } = fakePage(null, []);

    await expect(inspectLayout(page)).rejects.toThrow('The page has no viewport to measure');
  });

  it('stops when the run is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { page } = fakePage(desktop, [samples(), samples()]);

    await expect(inspectLayout(page, controller.signal)).rejects.toThrow('Preview cancelled');
  });

  describe('when there is more than the budget', () => {
    const clipped = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        selector: `p.item-${index}`,
        side: 'right' as const,
        textEdge: 400,
        boxEdge: 300,
      }));

    it('lists the budget, one check at a time, and says how many there were', async () => {
      const { page } = fakePage(desktop, [
        atDesktop({
          clipped: clipped(5),
          textGroups: Array.from({ length: 30 }, (_, index) => ({
            selector: `p.low-${index}`,
            count: 1,
            foreground: [200 - index, 200 - index, 200 - index, 1],
            layers: [],
            large: false,
          })),
        }),
        samples({ unnamedControls: [{ selector: 'button.menu', kind: 'button' }] }),
      ]);

      const inspection = await inspectLayout(page);

      expect(inspection.issues).toHaveLength(MAX_LAYOUT_ISSUES);
      expect(new Set(inspection.issues.map((issue) => issue.check))).toEqual(
        new Set(['clipped-text', 'low-contrast', 'missing-name']),
      );
      expect(inspection.notes).toEqual([
        `Layout checks found 36 issues; ${MAX_LAYOUT_ISSUES} are listed, taken from each check in turn.`,
      ]);
    });

    it('says how many findings went past the per-check limits', async () => {
      const { page } = fakePage(desktop, [atDesktop({ omitted: 3 }), samples({ omitted: 1 })]);

      const inspection = await inspectLayout(page);

      expect(inspection.notes).toEqual([
        '4 more findings past the per-check limits were not listed.',
      ]);
      const single = await inspectLayout(
        fakePage(desktop, [atDesktop({ omitted: 1 }), samples()]).page,
      );
      expect(single.notes).toEqual(['1 more finding past the per-check limits was not listed.']);
    });
  });

  describe('notes about the measurement', () => {
    it('says when the page was only measured in part', async () => {
      const { page } = fakePage(desktop, [atDesktop({ truncated: true }), samples()]);

      const inspection = await inspectLayout(page);

      expect(inspection.issues).toEqual([]);
      expect(inspection.notes).toEqual([
        'Layout checks did not cover the whole page (more than 5,000 elements or 400 controls); the rest was not measured.',
      ]);
    });

    it('says how many text elements were not measured for contrast, and why', async () => {
      const many = fakePage(desktop, [atDesktop({ unmeasuredText: 12 }), samples()]);
      const one = fakePage(desktop, [atDesktop({ unmeasuredText: 1 }), samples()]);

      expect((await inspectLayout(many.page)).notes).toEqual([
        'Contrast was not checked for 12 text elements on a background image or gradient, or partly transparent.',
      ]);
      expect((await inspectLayout(one.page)).notes).toEqual([
        'Contrast was not checked for 1 text element on a background image or gradient, or partly transparent.',
      ]);
    });

    it('says how many colour combinations were past the limit', async () => {
      const { page } = fakePage(desktop, [atDesktop({ droppedTextGroups: 3 }), samples()]);

      expect((await inspectLayout(page)).notes).toEqual([
        '3 colour combinations beyond the first 200 were not checked for contrast.',
      ]);
    });
  });

  it('passes the documented limits to the page', () => {
    expect(LAYOUT_PROBE_LIMITS).toMatchObject({
      maxElements: 5000,
      overflowTolerance: 1,
      clipTolerance: 2,
      maxOverflowElements: 3,
      maxClippedTexts: 5,
      largeTextPx: 24,
      largeBoldTextPx: 18.66,
      boldWeight: 700,
      maxTextGroups: 200,
      minMeasuredOpacity: 0.99,
      minTargetSizePx: 24,
      maxTargets: 400,
      maxSmallTargets: 5,
      maxUnnamedControls: 5,
    });
  });
});
