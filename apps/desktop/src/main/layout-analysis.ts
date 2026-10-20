/**
 * The decisions behind the layout checks, made on the plain data the page-side
 * function collects, so every threshold is testable without a browser.
 */

import type { LayoutIssue } from '@open-codesign/core';
import {
  type ClippedText,
  LAYOUT_PROBE_LIMITS,
  type LayoutSamples,
  MIN_CONTRAST_RATIO,
  MIN_LARGE_TEXT_CONTRAST_RATIO,
  MIN_TARGET_SIZE_PX,
  type Rgba,
  type TextGroup,
} from './layout-samples';

const formatPx = (value: number) => `${value.toLocaleString('en-US')} px`;

type Rgb = [number, number, number];

/** A colour with some transparency, laid over an opaque one. */
export function compositeOver(top: Rgba, base: Rgb): Rgb {
  const [red, green, blue, alpha] = top;
  return [
    red * alpha + base[0] * (1 - alpha),
    green * alpha + base[1] * (1 - alpha),
    blue * alpha + base[2] * (1 - alpha),
  ];
}

/** WCAG relative luminance of an sRGB colour. */
export function relativeLuminance([red, green, blue]: Rgb): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** WCAG contrast ratio, from 1 to 21. */
export function contrastRatio(first: Rgb, second: Rgb): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function toHex([red, green, blue]: Rgb): string {
  const part = (channel: number) =>
    Math.round(Math.min(255, Math.max(0, channel)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(red)}${part(green)}${part(blue)}`;
}

/**
 * The backgrounds behind the text are laid over white, the colour of a page that
 * sets none, from the outermost to the innermost; then the text over the result.
 */
export function measureTextContrast(group: Pick<TextGroup, 'foreground' | 'layers'>): {
  ratio: number;
  text: Rgb;
  backdrop: Rgb;
} {
  let backdrop: Rgb = [255, 255, 255];
  for (let index = group.layers.length - 1; index >= 0; index -= 1) {
    const layer = group.layers[index];
    if (layer) backdrop = compositeOver(layer, backdrop);
  }
  const text = compositeOver(group.foreground, backdrop);
  return { ratio: contrastRatio(text, backdrop), text, backdrop };
}

function overflowIssues(samples: LayoutSamples, tolerance: number): LayoutIssue[] {
  const { viewportWidth, documentWidth } = samples;
  if (samples.rootClipsX || documentWidth - viewportWidth <= tolerance) return [];
  if (samples.overflowing.length === 0) {
    return [
      {
        check: 'horizontal-overflow',
        viewportWidth,
        selector: 'html',
        message: `The page is ${formatPx(documentWidth)} wide at a ${formatPx(viewportWidth)} viewport, so it scrolls sideways; no single element was identified.`,
        measured: documentWidth,
        limit: viewportWidth,
      },
    ];
  }
  return samples.overflowing.map((element) => ({
    check: 'horizontal-overflow',
    viewportWidth,
    selector: element.selector,
    message: `${element.selector} reaches ${formatPx(element.right)}, past the ${formatPx(viewportWidth)} viewport edge, so the page scrolls sideways.`,
    measured: element.right,
    limit: viewportWidth,
  }));
}

function clippedEdges({ side, textEdge, boxEdge }: ClippedText): string {
  const text = formatPx(textEdge);
  const box = formatPx(boxEdge);
  switch (side) {
    case 'right':
      return `the text reaches ${text} but the box ends at ${box}`;
    case 'bottom':
      return `the text reaches ${text} from the top but the box ends at ${box}`;
    case 'left':
      return `the text starts at ${text} but the box starts at ${box}`;
    case 'top':
      return `the text starts at ${text} from the top but the box starts at ${box}`;
  }
}

function clippedIssues(samples: LayoutSamples): LayoutIssue[] {
  const { viewportWidth } = samples;
  return samples.clipped.map((text) => ({
    check: 'clipped-text',
    viewportWidth,
    selector: text.selector,
    message: `${text.selector} hides part of its text: ${clippedEdges(text)} (viewport ${formatPx(viewportWidth)}).`,
    measured: text.textEdge,
    limit: text.boxEdge,
  }));
}

function contrastIssues(samples: LayoutSamples): LayoutIssue[] {
  const failing = samples.textGroups
    .map((group) => {
      const { ratio, text, backdrop } = measureTextContrast(group);
      return { group, ratio, text, backdrop };
    })
    .filter(
      ({ group, ratio }) =>
        ratio < (group.large ? MIN_LARGE_TEXT_CONTRAST_RATIO : MIN_CONTRAST_RATIO),
    )
    .sort((a, b) => a.ratio - b.ratio);

  return failing.map(({ group, ratio, text, backdrop }) => {
    const needed = group.large ? MIN_LARGE_TEXT_CONTRAST_RATIO : MIN_CONTRAST_RATIO;
    // WCAG does not round up: 4.499 does not pass as 4.5.
    const shown = Math.floor(ratio * 100) / 100;
    const shared = group.count > 1 ? ` ${group.count} text elements use this pair.` : '';
    return {
      check: 'low-contrast',
      viewportWidth: samples.viewportWidth,
      selector: group.selector,
      message: `${group.selector} has low text contrast: ${shown}:1 for ${toHex(text)} on ${toHex(backdrop)}, but ${group.large ? 'large text' : 'text'} needs ${needed}:1.${shared}`,
      measured: shown,
      limit: needed,
    };
  });
}

function targetIssues(samples: LayoutSamples): LayoutIssue[] {
  return samples.smallTargets.map((target) => ({
    check: 'small-target',
    viewportWidth: samples.viewportWidth,
    selector: target.selector,
    message: `${target.selector} is ${target.width} × ${target.height} px; a tap target should be at least ${MIN_TARGET_SIZE_PX} × ${MIN_TARGET_SIZE_PX} px, or have that much room around it.`,
    measured: Math.min(target.width, target.height),
    limit: MIN_TARGET_SIZE_PX,
  }));
}

function nameIssues(samples: LayoutSamples): LayoutIssue[] {
  return samples.unnamedControls.map((control) => ({
    check: 'missing-name',
    viewportWidth: samples.viewportWidth,
    selector: control.selector,
    message: `${control.selector} (${control.kind}) has no accessible name: it has no text, aria-label, aria-labelledby, label or title.`,
  }));
}

/** Turns one measurement into findings, in the order the checks are listed in the docs. */
export function analyzeLayoutSamples(
  samples: LayoutSamples,
  limits: Pick<typeof LAYOUT_PROBE_LIMITS, 'overflowTolerance'> = LAYOUT_PROBE_LIMITS,
): LayoutIssue[] {
  return [
    ...overflowIssues(samples, limits.overflowTolerance),
    ...clippedIssues(samples),
    ...contrastIssues(samples),
    ...targetIssues(samples),
    ...nameIssues(samples),
  ];
}

/**
 * Keeps at most `max` findings. When there are more, it takes one from each
 * check in turn, so a page with fifty tiny buttons still shows its contrast
 * problem, and keeps the original order.
 */
export function selectIssues(issues: LayoutIssue[], max: number): LayoutIssue[] {
  if (issues.length <= max) return issues;
  const queues = new Map<string, LayoutIssue[]>();
  for (const issue of issues) {
    const queue = queues.get(issue.check);
    if (queue) queue.push(issue);
    else queues.set(issue.check, [issue]);
  }
  const picked = new Set<LayoutIssue>();
  while (picked.size < max) {
    for (const queue of queues.values()) {
      const next = queue.shift();
      if (next) picked.add(next);
      if (picked.size === max) break;
    }
  }
  return issues.filter((issue) => picked.has(issue));
}
