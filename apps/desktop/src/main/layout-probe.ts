/**
 * Deterministic layout and accessibility checks for the pages `preview` and
 * `done` already open in Chrome. The page-side function only collects raw
 * measurements; the decisions (what counts as overflow, low contrast, a small
 * target) are made on that data in `layout-analysis.ts`, so they can be tested
 * without a browser.
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
import { analyzeLayoutSamples, selectIssues } from './layout-analysis';
import {
  ALL_CHECKS,
  LAYOUT_BUDGET_MS,
  LAYOUT_PROBE_LIMITS,
  type LayoutProbeChecks,
  type LayoutProbeLimits,
  type LayoutSamples,
  PHONE_VIEWPORT,
  type Rgba,
  type TextGroup,
} from './layout-samples';
import { boundedPreview } from './preview-interactions';

// collectLayoutSamples is serialized into the page. Node's tsconfig has no DOM
// types, so these describe only the browser globals it touches.
interface PageStyle {
  display: string;
  position: string;
  visibility: string;
  opacity: string;
  overflowX: string;
  overflowY: string;
  textOverflow: string;
  webkitLineClamp?: string;
  animationName: string;
  color: string;
  backgroundColor: string;
  backgroundImage: string;
  fontSize: string;
  fontWeight: string;
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
  disabled?: boolean;
  value?: string;
  alt?: string;
  labels?: ArrayLike<PageNode>;
  getBoundingClientRect(): PageRect;
  querySelectorAll(selector: string): ArrayLike<PageElement>;
  matches(selector: string): boolean;
  closest(selector: string): PageElement | null;
  getAttribute(name: string): string | null;
}
interface PageCanvasContext {
  globalCompositeOperation: string;
  fillStyle: string;
  fillRect(x: number, y: number, width: number, height: number): void;
  getImageData(x: number, y: number, width: number, height: number): { data: ArrayLike<number> };
}
interface PageCanvas {
  width: number;
  height: number;
  getContext(type: '2d', options: { willReadFrequently: boolean }): PageCanvasContext | null;
}
declare const document: {
  documentElement: PageElement & { clientWidth: number; scrollWidth: number };
  body: PageElement | null;
  createRange(): { selectNodeContents(node: PageNode): void; getBoundingClientRect(): PageRect };
  createElement(tag: 'canvas'): PageCanvas;
  getElementById(id: string): PageElement | null;
};
declare const Node: { TEXT_NODE: number };
declare function getComputedStyle(element: PageElement): PageStyle;
declare function requestAnimationFrame(callback: () => void): number;

/**
 * Runs inside the page: plain DOM, `getComputedStyle`, `getBoundingClientRect`
 * and a 1 × 1 canvas to turn any CSS colour into sRGB. It must stay
 * self-contained, because Puppeteer serializes it to source.
 */
export function collectLayoutSamples(limits: LayoutProbeLimits): LayoutSamples {
  const { checks } = limits;
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
    textGroups: [],
    unmeasuredText: 0,
    droppedTextGroups: 0,
    omitted: 0,
    smallTargets: [],
    unnamedControls: [],
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
  const hasText = (node: PageNode) => (node.textContent ?? '').trim() !== '';
  const ownTextNodes = (element: PageElement) =>
    Array.from(element.childNodes).filter(
      (child) => child.nodeType === Node.TEXT_NODE && hasText(child),
    );

  // Any CSS colour, as sRGB: computed colours can be in other spaces (oklch, color-mix).
  const colors = new Map<string, Rgba>();
  const canvas = checks.contrast ? document.createElement('canvas') : null;
  if (canvas) {
    canvas.width = 1;
    canvas.height = 1;
  }
  const context = canvas ? canvas.getContext('2d', { willReadFrequently: true }) : null;
  if (checks.contrast && !context) throw new Error('A 2D canvas is not available to read colours');
  // Computed sRGB colours are `rgb(r, g, b)` or `rgba(r, g, b, a)`, which are read exactly;
  // a canvas rounds alpha to 8 bits, so it is used only for the other spaces.
  const legacyColor = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/;
  const toRgba = (value: string): Rgba => {
    const known = colors.get(value);
    if (known) return known;
    const parts = legacyColor.exec(value);
    if (parts) {
      const exact: Rgba = [
        Number(parts[1]),
        Number(parts[2]),
        Number(parts[3]),
        parts[4] === undefined ? 1 : Number(parts[4]),
      ];
      colors.set(value, exact);
      return exact;
    }
    if (!context) throw new Error('A 2D canvas is not available to read colours');
    context.globalCompositeOperation = 'copy';
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const data = context.getImageData(0, 0, 1, 1).data;
    const color: Rgba = [
      data[0] ?? 0,
      data[1] ?? 0,
      data[2] ?? 0,
      Math.round(((data[3] ?? 0) / 255) * 1000) / 1000,
    ];
    colors.set(value, color);
    return color;
  };

  const sideways =
    checks.overflow && documentWidth - viewportWidth > limits.overflowTolerance && !rootClipsX;
  const extending = new Set<PageElement>();
  const textGroups = new Map<string, TextGroup>();
  const targets: Array<{ element: PageElement; box: PageRect }> = [];
  const controlSelector =
    'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="menuitem"], [role="textbox"], [role="combobox"], [role="slider"]';
  const elements = body.querySelectorAll('*');
  const visited = Math.min(elements.length, limits.maxElements);
  samples.truncated = elements.length > limits.maxElements;

  const clippedByAncestor = (element: PageElement): boolean => {
    for (let node = element.parentElement; node && node !== body; node = node.parentElement) {
      if (getComputedStyle(node).overflowX !== 'visible') return true;
    }
    return false;
  };

  const textOf = (node: PageNode | null) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const accessibleName = (element: PageElement): string => {
    const labelledBy = (element.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => textOf(document.getElementById(id)))
      .join(' ')
      .trim();
    if (labelledBy) return labelledBy;
    const label = (element.getAttribute('aria-label') ?? '').trim();
    if (label) return label;
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute('type') ?? '').toLowerCase();
    if (tag === 'input') {
      if (type === 'submit' || type === 'reset') return (element.value ?? '').trim() || type;
      if (type === 'button') return (element.value ?? '').trim();
      if (type === 'image') return (element.alt ?? '').trim();
    }
    const labelText = Array.from(element.labels ?? [])
      .map((node) => textOf(node))
      .join(' ')
      .trim();
    if (labelText) return labelText;
    if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') {
      const text = textOf(element);
      if (text) return text;
    }
    for (const inner of Array.from(element.querySelectorAll('img[alt], svg title, [aria-label]'))) {
      const innerName =
        (inner.getAttribute('alt') ?? '').trim() ||
        (inner.getAttribute('aria-label') ?? '').trim() ||
        (inner.tagName.toLowerCase() === 'title' ? textOf(inner) : '');
      if (innerName) return innerName;
    }
    return (element.getAttribute('title') ?? '').trim();
  };

  for (let index = 0; index < visited; index += 1) {
    const element = elements[index];
    if (!element) continue;
    const style = getComputedStyle(element);
    if (style.display === 'none') continue;
    const box = element.getBoundingClientRect();
    const shown = style.visibility === 'visible';

    if (sideways && style.position !== 'fixed' && box.width > 0) {
      if (box.right > viewportWidth + limits.overflowTolerance && !clippedByAncestor(element)) {
        extending.add(element);
      }
    }

    if (checks.clipped) {
      const clipsText = clipsX(style.overflowX) || clipsX(style.overflowY);
      const intentional =
        style.textOverflow === 'ellipsis' ||
        (style.webkitLineClamp !== undefined && style.webkitLineClamp !== 'none') ||
        style.animationName !== 'none';
      if (clipsText && !intentional && box.width >= 1 && box.height >= 1) {
        for (const child of ownTextNodes(element)) {
          const range = document.createRange();
          range.selectNodeContents(child);
          const text = range.getBoundingClientRect();
          if (text.width < 1 || text.height < 1) continue;
          const sides = [
            { side: 'right', beyond: text.right - box.right, text: text.right, box: box.right },
            {
              side: 'bottom',
              beyond: text.bottom - box.bottom,
              text: text.bottom,
              box: box.bottom,
            },
            { side: 'left', beyond: box.left - text.left, text: text.left, box: box.left },
            { side: 'top', beyond: box.top - text.top, text: text.top, box: box.top },
          ] as const;
          const worst = sides.reduce((most, next) => (next.beyond > most.beyond ? next : most));
          if (worst.beyond > limits.clipTolerance) {
            if (samples.clipped.length < limits.maxClippedTexts) {
              samples.clipped.push({
                selector: selectorOf(element),
                side: worst.side,
                textEdge: Math.round(worst.text),
                boxEdge: Math.round(worst.box),
              });
            } else {
              samples.omitted += 1;
            }
            break;
          }
        }
      }
    }

    if (checks.contrast && shown && box.width >= 1 && box.height >= 1) {
      if (ownTextNodes(element).length > 0) {
        let opacity = 1;
        for (let node: PageElement | null = element; node; node = node.parentElement) {
          opacity *= Number(getComputedStyle(node).opacity);
        }
        // The backgrounds behind the text: its own ancestors, up to the first opaque one.
        const layers: Rgba[] = [];
        let pictured = false;
        for (let node: PageElement | null = element; node; node = node.parentElement) {
          const nodeStyle = getComputedStyle(node);
          if (nodeStyle.backgroundImage !== 'none') {
            pictured = true;
            break;
          }
          const layer = toRgba(nodeStyle.backgroundColor);
          if (layer[3] > 0) {
            layers.push(layer);
            if (layer[3] === 1) break;
          }
        }
        if (pictured || opacity < limits.minMeasuredOpacity) {
          samples.unmeasuredText += 1;
        } else {
          const size = Number.parseFloat(style.fontSize);
          const large =
            size >= limits.largeTextPx ||
            (size >= limits.largeBoldTextPx &&
              Number.parseInt(style.fontWeight, 10) >= limits.boldWeight);
          const foreground = toRgba(style.color);
          const key = `${foreground.join(',')}|${layers.map((layer) => layer.join(',')).join(';')}|${large}`;
          const group = textGroups.get(key);
          if (group) {
            group.count += 1;
          } else if (textGroups.size < limits.maxTextGroups) {
            textGroups.set(key, {
              selector: selectorOf(element),
              count: 1,
              foreground,
              layers,
              large,
            });
          } else {
            samples.droppedTextGroups += 1;
          }
        }
      }
    }

    if ((checks.targets || checks.names) && shown && element.matches(controlSelector)) {
      if (!element.closest('[aria-hidden="true"]')) {
        if (checks.names && accessibleName(element) === '') {
          if (samples.unnamedControls.length < limits.maxUnnamedControls) {
            const role = element.getAttribute('role');
            samples.unnamedControls.push({
              selector: selectorOf(element),
              kind: `${element.tagName.toLowerCase()}${role ? ` role=${role}` : ''}`,
            });
          } else {
            samples.omitted += 1;
          }
        }
        // A control with no size, or hidden by opacity, is a visually hidden input whose label is the target.
        const measurable = box.width >= 2 && box.height >= 2 && style.opacity !== '0';
        if (
          checks.targets &&
          measurable &&
          element.disabled !== true &&
          style.display !== 'inline'
        ) {
          if (targets.length < limits.maxTargets) targets.push({ element, box });
          else samples.truncated = true;
        }
      }
    }
  }

  // Name the outermost elements that cross the edge: along each chain, the first box
  // that goes past it is where the overflow starts.
  const outermost: Array<{ selector: string; right: number }> = [];
  for (const element of extending) {
    if (element.parentElement && extending.has(element.parentElement)) continue;
    outermost.push({
      selector: selectorOf(element),
      right: Math.round(element.getBoundingClientRect().right),
    });
  }
  outermost.sort((a, b) => b.right - a.right);
  samples.overflowing = outermost.slice(0, limits.maxOverflowElements);
  samples.omitted += Math.max(0, outermost.length - limits.maxOverflowElements);

  samples.textGroups = Array.from(textGroups.values());

  // A small target passes when the square around its centre touches no other target.
  const half = limits.minTargetSizePx / 2;
  const small: Array<{ selector: string; width: number; height: number }> = [];
  for (const { element, box } of targets) {
    if (box.width >= limits.minTargetSizePx && box.height >= limits.minTargetSizePx) continue;
    const centerX = (box.left + box.right) / 2;
    const centerY = (box.top + box.bottom) / 2;
    const crowded = targets.some(
      (other) =>
        other.element !== element &&
        other.box.left < centerX + half &&
        other.box.right > centerX - half &&
        other.box.top < centerY + half &&
        other.box.bottom > centerY - half,
    );
    if (crowded) {
      small.push({
        selector: selectorOf(element),
        width: Math.round(box.width),
        height: Math.round(box.height),
      });
    }
  }
  small.sort((a, b) => Math.min(a.width, a.height) - Math.min(b.width, b.height));
  samples.smallTargets = small.slice(0, limits.maxSmallTargets);
  samples.omitted += Math.max(0, small.length - limits.maxSmallTargets);
  return samples;
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

async function measure(page: Page, checks: LayoutProbeChecks): Promise<LayoutSamples> {
  return page.evaluate(collectLayoutSamples, { ...LAYOUT_PROBE_LIMITS, checks });
}

/**
 * Measures the open page at its current viewport and at phone width, then puts
 * the viewport back. A failure rejects, so the caller reports it instead of
 * silently reporting a clean page.
 */
export async function inspectLayout(page: Page, signal?: AbortSignal): Promise<LayoutInspection> {
  return boundedPreview(runInspection(page), LAYOUT_BUDGET_MS, signal);
}

/** Contrast and names do not depend on width, so the phone pass skips them; tap targets matter there. */
const CURRENT_WIDTH_CHECKS: LayoutProbeChecks = { ...ALL_CHECKS, targets: false };
const PHONE_WIDTH_CHECKS: LayoutProbeChecks = {
  overflow: true,
  clipped: true,
  contrast: false,
  targets: true,
  names: false,
};

async function runInspection(page: Page): Promise<LayoutInspection> {
  const original = page.viewport();
  if (original === null) throw new Error('The page has no viewport to measure');
  const alreadyPhone = original.width === PHONE_VIEWPORT.width;
  const issues: LayoutIssue[] = [];
  const measured: LayoutSamples[] = [];
  const take = (samples: LayoutSamples) => {
    measured.push(samples);
    issues.push(...analyzeLayoutSamples(samples));
  };

  take(await measure(page, alreadyPhone ? ALL_CHECKS : CURRENT_WIDTH_CHECKS));
  if (!alreadyPhone) {
    try {
      await page.setViewport({ ...original, ...PHONE_VIEWPORT });
      await settleLayout(page);
      take(await measure(page, PHONE_WIDTH_CHECKS));
    } finally {
      await page.setViewport(original);
    }
  }

  const notes: string[] = [];
  if (measured.some((samples) => samples.truncated)) {
    notes.push(
      'Layout checks did not cover the whole page (more than 5,000 elements or 400 controls); the rest was not measured.',
    );
  }
  const unmeasured = measured.reduce((sum, samples) => sum + samples.unmeasuredText, 0);
  if (unmeasured > 0) {
    notes.push(
      `Contrast was not checked for ${unmeasured} text element${unmeasured === 1 ? '' : 's'} on a background image or gradient, or partly transparent.`,
    );
  }
  const dropped = measured.reduce((sum, samples) => sum + samples.droppedTextGroups, 0);
  if (dropped > 0) {
    notes.push(
      `${dropped} colour combination${dropped === 1 ? '' : 's'} beyond the first 200 were not checked for contrast.`,
    );
  }
  const omitted = measured.reduce((sum, samples) => sum + samples.omitted, 0);
  if (omitted > 0) {
    notes.push(
      `${omitted} more finding${omitted === 1 ? '' : 's'} past the per-check limits ${omitted === 1 ? 'was' : 'were'} not listed.`,
    );
  }
  if (issues.length > MAX_LAYOUT_ISSUES) {
    notes.push(
      `Layout checks found ${issues.length} issues; ${MAX_LAYOUT_ISSUES} are listed, taken from each check in turn.`,
    );
  }
  return { issues: selectIssues(issues, MAX_LAYOUT_ISSUES), notes };
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
