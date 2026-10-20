/**
 * What the page-side layout function measures, and the named limits that bound
 * it. Plain data and constants only: the function runs in the page, the
 * decisions are made on this data in `layout-analysis.ts`.
 */

/** The narrow viewport every page is also measured at. */
export const PHONE_VIEWPORT = { width: 390, height: 844 } as const;
/** Most elements one measurement visits; a larger page is measured only in part. */
export const MAX_PROBE_ELEMENTS = 5000;
/** Time allowed for all measurements together. */
export const LAYOUT_BUDGET_MS = 5000;
/** Cleanup has its own budget so a cancelled inspection can restore the preview viewport. */
export const LAYOUT_RESTORE_BUDGET_MS = 1000;

/** Sub-pixel rounding is not overflow. */
export const OVERFLOW_TOLERANCE_PX = 1;
/** Text may stick out of a clipping box by this much before it counts as clipped. */
export const CLIP_TOLERANCE_PX = 2;
/** Elements named per viewport when the page scrolls sideways. */
export const MAX_OVERFLOW_ELEMENTS = 3;
/** Clipped texts named per viewport. */
export const MAX_CLIPPED_TEXTS = 5;

/** WCAG 2.x level AA contrast: 4.5:1 for text, 3:1 for large text. */
export const MIN_CONTRAST_RATIO = 4.5;
export const MIN_LARGE_TEXT_CONTRAST_RATIO = 3;
/** Large text is at least 24 px, or at least 18.66 px and bold (WCAG's 18 pt and 14 pt bold). */
export const LARGE_TEXT_PX = 24;
export const LARGE_BOLD_TEXT_PX = 18.66;
export const BOLD_WEIGHT = 700;
/** Distinct colour and size combinations kept per measurement; more are counted, not checked. */
export const MAX_TEXT_GROUPS = 200;
/** Text this transparent, or sitting in something this transparent, is not measured. */
export const MIN_MEASURED_OPACITY = 0.99;

/** WCAG 2.2 SC 2.5.8: a pointer target is at least 24 by 24 CSS px, or has room around it. */
export const MIN_TARGET_SIZE_PX = 24;
/** Targets looked at per measurement; the spacing exception compares each with the others. */
export const MAX_TARGETS = 400;
/** Small targets named per viewport, smallest first. */
export const MAX_SMALL_TARGETS = 5;

/** Controls without a name named per measurement. */
export const MAX_UNNAMED_CONTROLS = 5;

/** Red, green and blue as 0 to 255 and alpha as 0 to 1, in sRGB. */
export type Rgba = [number, number, number, number];

export interface OverflowingElement {
  selector: string;
  /** Right edge of the element, in CSS px from the left of the viewport. */
  right: number;
}

/** The side of a clipping box that its text sticks out of the most. */
export type ClippedSide = 'right' | 'bottom' | 'left' | 'top';

export interface ClippedText {
  selector: string;
  side: ClippedSide;
  /** The text's edge on that side, in CSS px from the top left of the viewport. */
  textEdge: number;
  /** The box's edge on that side, in the same px. */
  boxEdge: number;
}

/** Text elements that share a colour, the backgrounds behind it and a size class. */
export interface TextGroup {
  selector: string;
  /** How many text elements share this combination. */
  count: number;
  foreground: Rgba;
  /** The backgrounds behind the text, innermost first, up to and including the first opaque one. */
  layers: Rgba[];
  large: boolean;
}

export interface SmallTarget {
  selector: string;
  width: number;
  height: number;
}

export interface UnnamedControl {
  selector: string;
  /** The tag, plus the role when there is one, for the message. */
  kind: string;
}

/** What the page-side function returns. Plain data, so it survives serialization. */
export interface LayoutSamples {
  viewportWidth: number;
  documentWidth: number;
  /** The page cannot scroll sideways, because the root or body hides horizontal overflow. */
  rootClipsX: boolean;
  overflowing: OverflowingElement[];
  clipped: ClippedText[];
  textGroups: TextGroup[];
  /** Text elements on a background image or gradient, or partly transparent, that were not measured. */
  unmeasuredText: number;
  /** Colour combinations past `maxTextGroups` that were not measured. */
  droppedTextGroups: number;
  /** Findings past a per-check limit (overflowing elements, clipped texts, small targets, unnamed controls). */
  omitted: number;
  smallTargets: SmallTarget[];
  unnamedControls: UnnamedControl[];
  /** The element limit was reached, so the rest of the page was not measured. */
  truncated: boolean;
}

/** Which checks one measurement runs. Contrast and names do not depend on width; tap targets matter at phone width. */
export interface LayoutProbeChecks {
  overflow: boolean;
  clipped: boolean;
  contrast: boolean;
  targets: boolean;
  names: boolean;
}

export interface LayoutProbeLimits {
  checks: LayoutProbeChecks;
  maxElements: number;
  overflowTolerance: number;
  clipTolerance: number;
  maxOverflowElements: number;
  maxClippedTexts: number;
  largeTextPx: number;
  largeBoldTextPx: number;
  boldWeight: number;
  maxTextGroups: number;
  minMeasuredOpacity: number;
  minTargetSizePx: number;
  maxTargets: number;
  maxSmallTargets: number;
  maxUnnamedControls: number;
}

export const ALL_CHECKS: LayoutProbeChecks = {
  overflow: true,
  clipped: true,
  contrast: true,
  targets: true,
  names: true,
};

export const LAYOUT_PROBE_LIMITS: LayoutProbeLimits = {
  checks: ALL_CHECKS,
  maxElements: MAX_PROBE_ELEMENTS,
  overflowTolerance: OVERFLOW_TOLERANCE_PX,
  clipTolerance: CLIP_TOLERANCE_PX,
  maxOverflowElements: MAX_OVERFLOW_ELEMENTS,
  maxClippedTexts: MAX_CLIPPED_TEXTS,
  largeTextPx: LARGE_TEXT_PX,
  largeBoldTextPx: LARGE_BOLD_TEXT_PX,
  boldWeight: BOLD_WEIGHT,
  maxTextGroups: MAX_TEXT_GROUPS,
  minMeasuredOpacity: MIN_MEASURED_OPACITY,
  minTargetSizePx: MIN_TARGET_SIZE_PX,
  maxTargets: MAX_TARGETS,
  maxSmallTargets: MAX_SMALL_TARGETS,
  maxUnnamedControls: MAX_UNNAMED_CONTROLS,
};
