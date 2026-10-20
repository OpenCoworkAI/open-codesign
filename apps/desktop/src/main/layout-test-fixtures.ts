import type { LayoutSamples } from './layout-samples';

/** A measurement of a page with nothing to report, with fields overridden by a test. */
export function samples(overrides: Partial<LayoutSamples> = {}): LayoutSamples {
  return {
    viewportWidth: 390,
    documentWidth: 390,
    rootClipsX: false,
    overflowing: [],
    clipped: [],
    textGroups: [],
    unmeasuredText: 0,
    droppedTextGroups: 0,
    omitted: 0,
    smallTargets: [],
    unnamedControls: [],
    truncated: false,
    ...overrides,
  };
}
