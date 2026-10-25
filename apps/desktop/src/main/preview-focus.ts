import type { PreviewInput, PreviewResult } from '@open-codesign/core';
import type { Page } from 'puppeteer-core';
import { boundedPreview } from './preview-interactions';

type FocusResult = NonNullable<PreviewResult['focus']>;
type FocusMeasurement = Pick<FocusResult, 'tagName' | 'text' | 'outerHTML' | 'bounds'>;

interface FocusElement {
  tagName: string;
  innerText?: string;
  textContent: string | null;
  outerHTML: string;
  parentElement: FocusElement | null;
  getClientRects(): { length: number };
  getBoundingClientRect(): FocusResult['bounds'];
  scrollIntoView(options: { block: string; inline: string; behavior: string }): void;
}
declare const document: {
  querySelectorAll(selector: string): ArrayLike<FocusElement>;
  defaultView: {
    scrollX: number;
    scrollY: number;
    getComputedStyle(element: FocusElement): {
      display: string;
      visibility: string;
      opacity: string;
    };
  };
};

// Serialized into Chrome by Puppeteer; keep this function independent of host closures.
export function measurePreviewFocus(selector: string): FocusMeasurement {
  let matches: ArrayLike<FocusElement>;
  try {
    matches = document.querySelectorAll(selector);
  } catch {
    throw new Error('Invalid focus CSS selector');
  }
  if (matches.length !== 1)
    throw new Error(`Focus requires one element; selector matched ${matches.length}`);
  const element = matches[0];
  if (!element || element.getClientRects().length === 0)
    throw new Error('Focus element is not visible');
  if (document.defaultView.getComputedStyle(element).visibility !== 'visible')
    throw new Error('Focus element is not visible');
  for (let ancestor: FocusElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = document.defaultView.getComputedStyle(ancestor);
    if (style.display === 'none' || Number(style.opacity) === 0)
      throw new Error('Focus element is not visible');
  }
  // Reveal below-fold blocks and nested scroll containers before measuring document coordinates.
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const rect = element.getBoundingClientRect();
  return {
    tagName: element.tagName.toLowerCase(),
    text: (element.innerText ?? element.textContent ?? '').slice(0, 2000),
    outerHTML: element.outerHTML.slice(0, 4000),
    bounds: {
      x: rect.x + document.defaultView.scrollX,
      y: rect.y + document.defaultView.scrollY,
      width: rect.width,
      height: rect.height,
    },
  };
}

export async function capturePreviewFocus(
  page: Pick<Page, 'evaluate' | 'screenshot'>,
  input: NonNullable<PreviewInput['focus']>,
  sourcePath: string,
  vision: boolean,
  signal?: AbortSignal,
): Promise<Pick<PreviewResult, 'focus' | 'screenshot'>> {
  const measured = await boundedPreview(
    page.evaluate(measurePreviewFocus, input.selector),
    2000,
    signal,
  );
  const { x, y, width, height } = measured.bounds;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0)
    throw new Error('Focus element has no finite visible area');
  const padding = input.padding ?? 16;
  const clip = {
    x: Math.max(0, Math.floor(x - padding)),
    y: Math.max(0, Math.floor(y - padding)),
    width: 0,
    height: 0,
    scale: input.scale ?? 2,
  };
  clip.width = Math.ceil(x + width + padding) - clip.x;
  clip.height = Math.ceil(y + height + padding) - clip.y;
  if (![clip.width, clip.height].every(Number.isFinite) || clip.width <= 0 || clip.height <= 0)
    throw new Error('Focus element is outside the document');
  const pixelWidth = Math.ceil(clip.width * clip.scale);
  const pixelHeight = Math.ceil(clip.height * clip.scale);
  if (vision && (pixelWidth > 4096 || pixelHeight > 4096 || pixelWidth * pixelHeight > 8_000_000))
    throw new Error(
      'Focus image exceeds 4096 px per side or 8 megapixels; choose a smaller block or scale',
    );
  const focus: FocusResult = { ...measured, sourcePath, selector: input.selector, clip };
  if (!vision) return { focus };
  const png = await boundedPreview(
    page.screenshot({ type: 'png', encoding: 'base64', clip, captureBeyondViewport: true }),
    2000,
    signal,
  );
  return { focus, screenshot: `data:image/png;base64,${png}` };
}
