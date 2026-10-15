/**
 * Deterministic layout checks for the pages `preview` and `done` already open
 * in Chrome. The page-side function only collects raw measurements; the
 * decisions (what counts as overflow, how many findings to keep) are made here
 * on plain data so they can be tested without a browser.
 *
 * Findings are advice. They never change `ok` or the `done` status, because a
 * heuristic can be wrong and a false positive must not cost a repair round.
 */

import {
  type DoneError,
  LAYOUT_WARNING_SOURCE,
  type LayoutIssue,
  MAX_LAYOUT_ISSUES,
} from '@open-codesign/core';
import type { Page } from 'puppeteer-core';
import { boundedPreview } from './preview-interactions';

// collectLayoutSamples is serialized into the page. Node's tsconfig has no DOM
// types, so these describe only the browser globals it touches.
interface PageStyle {
  display: string;
  position: string;
  overflowX: string;
  overflowY: string;
  textOverflow: string;
  webkitLineClamp?: string;
  animationName: string;
}
interface PageRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}
interface PageNode {
  nodeType: number;
  textContent: string | null;
}
interface PageElement extends PageNode {
  tagName: string;
  id: string;
  classList: ArrayLike<string>;
  parentElement: PageElement | null;
  children: ArrayLike<PageElement>;
  childNodes: ArrayLike<PageNode>;
  getBoundingClientRect(): PageRect;
  querySelectorAll(selector: string): ArrayLike<PageElement>;
}
declare const document: {
  documentElement: PageElement & { clientWidth: number; scrollWidth: number };
  body: PageElement | null;
  createRange(): { selectNodeContents(node: PageNode): void; getBoundingClientRect(): PageRect };
};
declare const Node: { TEXT_NODE: number };
declare function getComputedStyle(element: PageElement): PageStyle;
declare function requestAnimationFrame(callback: () => void): number;

/** The narrow viewport every page is also measured at. */
export const PHONE_VIEWPORT = { width: 390, height: 844 } as const;
/** Most elements one measurement visits; a larger page is measured only in part. */
export const MAX_PROBE_ELEMENTS = 5000;
/** Sub-pixel rounding is not overflow. */
export const OVERFLOW_TOLERANCE_PX = 1;
/** Text may stick out of a clipping box by this much before it counts as clipped. */
export const CLIP_TOLERANCE_PX = 2;
/** Elements named per viewport when the page scrolls sideways. */
export const MAX_OVERFLOW_ELEMENTS = 3;
/** Clipped texts named per viewport. */
export const MAX_CLIPPED_TEXTS = 5;
/** Time allowed for both measurements together. */
export const LAYOUT_BUDGET_MS = 5000;

export interface OverflowingElement {
  selector: string;
  /** Right edge of the element, in CSS px from the left of the viewport. */
  right: number;
}

export interface ClippedText {
  selector: string;
  textRight: number;
  boxRight: number;
  textBottom: number;
  boxBottom: number;
}

/** What the page-side function returns. Plain data, so it survives serialization. */
export interface LayoutSamples {
  viewportWidth: number;
  documentWidth: number;
  /** The page cannot scroll sideways, because the root or body hides horizontal overflow. */
  rootClipsX: boolean;
  overflowing: OverflowingElement[];
  clipped: ClippedText[];
  /** The element limit was reached, so the rest of the page was not measured. */
  truncated: boolean;
}

export interface LayoutProbeLimits {
  maxElements: number;
  overflowTolerance: number;
  clipTolerance: number;
  maxOverflowElements: number;
  maxClippedTexts: number;
}

export const LAYOUT_PROBE_LIMITS: LayoutProbeLimits = {
  maxElements: MAX_PROBE_ELEMENTS,
  overflowTolerance: OVERFLOW_TOLERANCE_PX,
  clipTolerance: CLIP_TOLERANCE_PX,
  maxOverflowElements: MAX_OVERFLOW_ELEMENTS,
  maxClippedTexts: MAX_CLIPPED_TEXTS,
};

/**
 * Runs inside the page: plain DOM, `getComputedStyle` and `getBoundingClientRect`.
 * It must stay self-contained, because Puppeteer serializes it to source.
 */
export function collectLayoutSamples(limits: LayoutProbeLimits): LayoutSamples {
  const root = document.documentElement;
  const body = document.body;
  const clipsX = (value: string) => value === 'hidden' || value === 'clip';
  const rootOverflowX = getComputedStyle(root).overflowX;
  const bodyOverflowX = body ? getComputedStyle(body).overflowX : 'visible';
  const rootClipsX =
    clipsX(rootOverflowX) || (rootOverflowX === 'visible' && clipsX(bodyOverflowX));
  const viewportWidth = root.clientWidth;
  const documentWidth = root.scrollWidth;
  const samples: LayoutSamples = {
    viewportWidth,
    documentWidth,
    rootClipsX,
    overflowing: [],
    clipped: [],
    truncated: false,
  };
  if (!body) return samples;

  const selectorOf = (element: PageElement): string => {
    const parts: string[] = [];
    let node: PageElement | null = element;
    while (node && node !== body && parts.length < 3) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(`${part}#${node.id}`);
        node = null;
        break;
      }
      const classes = Array.from(node.classList).slice(0, 2);
      if (classes.length > 0) part += `.${classes.join('.')}`;
      parts.unshift(part);
      node = node.parentElement;
    }
    const path = parts.join(' > ');
    return (node === body || node === null ? path : `… > ${path}`).slice(0, 120);
  };

  const sideways = documentWidth - viewportWidth > limits.overflowTolerance && !rootClipsX;
  const extending = new Set<PageElement>();
  const elements = body.querySelectorAll('*');
  const visited = Math.min(elements.length, limits.maxElements);
  samples.truncated = elements.length > limits.maxElements;

  const clippedByAncestor = (element: PageElement): boolean => {
    for (let node = element.parentElement; node && node !== body; node = node.parentElement) {
      if (getComputedStyle(node).overflowX !== 'visible') return true;
    }
    return false;
  };

  for (let index = 0; index < visited; index += 1) {
    const element = elements[index];
    if (!element) continue;
    const style = getComputedStyle(element);
    if (style.display === 'none') continue;
    const box = element.getBoundingClientRect();

    if (sideways && style.position !== 'fixed' && box.width > 0) {
      if (box.right > viewportWidth + limits.overflowTolerance && !clippedByAncestor(element)) {
        extending.add(element);
      }
    }

    const clipsText = clipsX(style.overflowX) || clipsX(style.overflowY);
    const intentional =
      style.textOverflow === 'ellipsis' ||
      (style.webkitLineClamp !== undefined && style.webkitLineClamp !== 'none') ||
      style.animationName !== 'none';
    if (
      !clipsText ||
      intentional ||
      box.width < 1 ||
      box.height < 1 ||
      samples.clipped.length >= limits.maxClippedTexts
    ) {
      continue;
    }
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType !== Node.TEXT_NODE || !(child.textContent ?? '').trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(child);
      const text = range.getBoundingClientRect();
      if (text.width < 1 || text.height < 1) continue;
      const tolerance = limits.clipTolerance;
      if (
        text.right > box.right + tolerance ||
        text.bottom > box.bottom + tolerance ||
        text.left < box.left - tolerance ||
        text.top < box.top - tolerance
      ) {
        samples.clipped.push({
          selector: selectorOf(element),
          textRight: Math.round(text.right),
          boxRight: Math.round(box.right),
          textBottom: Math.round(text.bottom),
          boxBottom: Math.round(box.bottom),
        });
        break;
      }
    }
  }

  // Name the outermost elements that cross the edge: along each chain, the first box
  // that goes past it is where the overflow starts.
  const outermost: OverflowingElement[] = [];
  for (const element of extending) {
    if (element.parentElement && extending.has(element.parentElement)) continue;
    outermost.push({
      selector: selectorOf(element),
      right: Math.round(element.getBoundingClientRect().right),
    });
  }
  outermost.sort((a, b) => b.right - a.right);
  samples.overflowing = outermost.slice(0, limits.maxOverflowElements);
  return samples;
}

const formatPx = (value: number) => `${value.toLocaleString('en-US')} px`;

/** Turns one measurement into findings. Pure, so the thresholds are testable without Chrome. */
export function analyzeLayoutSamples(
  samples: LayoutSamples,
  limits: Pick<LayoutProbeLimits, 'overflowTolerance'> = LAYOUT_PROBE_LIMITS,
): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const { viewportWidth, documentWidth } = samples;

  if (!samples.rootClipsX && documentWidth - viewportWidth > limits.overflowTolerance) {
    if (samples.overflowing.length === 0) {
      issues.push({
        check: 'horizontal-overflow',
        viewportWidth,
        selector: 'html',
        message: `The page is ${formatPx(documentWidth)} wide at a ${formatPx(viewportWidth)} viewport, so it scrolls sideways; no single element was identified.`,
        measured: documentWidth,
        limit: viewportWidth,
      });
    }
    for (const element of samples.overflowing) {
      issues.push({
        check: 'horizontal-overflow',
        viewportWidth,
        selector: element.selector,
        message: `${element.selector} reaches ${formatPx(element.right)}, past the ${formatPx(viewportWidth)} viewport edge, so the page scrolls sideways.`,
        measured: element.right,
        limit: viewportWidth,
      });
    }
  }

  for (const text of samples.clipped) {
    const horizontal = text.textRight > text.boxRight;
    issues.push({
      check: 'clipped-text',
      viewportWidth,
      selector: text.selector,
      message: horizontal
        ? `${text.selector} hides part of its text: the text reaches ${formatPx(text.textRight)} but the box ends at ${formatPx(text.boxRight)} (viewport ${formatPx(viewportWidth)}).`
        : `${text.selector} hides part of its text: the text reaches ${formatPx(text.textBottom)} from the top but the box ends at ${formatPx(text.boxBottom)} (viewport ${formatPx(viewportWidth)}).`,
      measured: horizontal ? text.textRight : text.textBottom,
      limit: horizontal ? text.boxRight : text.boxBottom,
    });
  }
  return issues;
}

export interface LayoutInspection {
  issues: LayoutIssue[];
  /** Things the agent should know about the measurement itself, such as a cap that was hit. */
  notes: string[];
}

/** Waits two frames so a resized page has laid out again. */
async function settleLayout(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function measure(page: Page): Promise<LayoutSamples> {
  return page.evaluate(collectLayoutSamples, LAYOUT_PROBE_LIMITS);
}

/**
 * Measures the open page at its current viewport and at phone width, then puts
 * the viewport back. A failure rejects, so the caller reports it instead of
 * silently reporting a clean page.
 */
export async function inspectLayout(page: Page, signal?: AbortSignal): Promise<LayoutInspection> {
  return boundedPreview(runInspection(page), LAYOUT_BUDGET_MS, signal);
}

async function runInspection(page: Page): Promise<LayoutInspection> {
  const original = page.viewport();
  if (original === null) throw new Error('The page has no viewport to measure');
  const widths = original.width === PHONE_VIEWPORT.width ? [] : [PHONE_VIEWPORT];
  const issues: LayoutIssue[] = [];
  let truncated = false;
  const take = (samples: LayoutSamples) => {
    issues.push(...analyzeLayoutSamples(samples));
    truncated ||= samples.truncated;
  };

  take(await measure(page));
  try {
    for (const viewport of widths) {
      await page.setViewport({ ...original, ...viewport });
      await settleLayout(page);
      take(await measure(page));
    }
  } finally {
    if (widths.length > 0) await page.setViewport(original);
  }

  const notes: string[] = [];
  if (truncated) {
    notes.push(
      `Layout checks stopped after ${MAX_PROBE_ELEMENTS.toLocaleString('en-US')} elements; the rest of the page was not measured.`,
    );
  }
  if (issues.length > MAX_LAYOUT_ISSUES) {
    notes.push(
      `Layout checks found ${issues.length} issues; only the first ${MAX_LAYOUT_ISSUES} are listed.`,
    );
  }
  return { issues: issues.slice(0, MAX_LAYOUT_ISSUES), notes };
}

/** What `done` shows for a measurement: each finding and note as a non-blocking warning. */
export function layoutWarnings(inspection: LayoutInspection): DoneError[] {
  return [...inspection.issues.map((issue) => issue.message), ...inspection.notes].map(
    (message) => ({ message, source: LAYOUT_WARNING_SOURCE }),
  );
}

/** What `done` shows when the measurement itself failed. */
export function layoutFailureWarning(error: unknown): DoneError {
  const reason = error instanceof Error ? error.message : String(error);
  return { message: `Layout checks did not run: ${reason}`, source: LAYOUT_WARNING_SOURCE };
}
