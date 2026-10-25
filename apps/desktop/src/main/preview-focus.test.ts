import type { Page } from 'puppeteer-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capturePreviewFocus, type measurePreviewFocus } from './preview-focus';

const bounds = { x: 80, y: 40, width: 300, height: 150 };
const element = {
  tagName: 'SECTION',
  innerText: 'Basic plan',
  textContent: 'Basic plan',
  outerHTML: '<section id="pricing">Basic plan</section>',
  parentElement: { parentElement: null },
  getClientRects: vi.fn(() => ({ length: 1 })),
  getBoundingClientRect: vi.fn(() => ({ ...bounds })),
  scrollIntoView: vi.fn(),
};
const pageDocument = {
  querySelectorAll: vi.fn(() => [element]),
  defaultView: {
    scrollX: 32,
    scrollY: 600,
    getComputedStyle: vi.fn((_element: unknown) => ({
      display: 'block',
      visibility: 'visible',
      opacity: '1',
    })),
  },
};

beforeEach(() => {
  element.innerText = 'Basic plan';
  element.outerHTML = '<section id="pricing">Basic plan</section>';
  element.getClientRects.mockReturnValue({ length: 1 });
  element.getBoundingClientRect.mockReturnValue({ ...bounds });
  element.scrollIntoView.mockClear();
  pageDocument.querySelectorAll.mockReset().mockReturnValue([element]);
  pageDocument.defaultView.scrollX = 32;
  pageDocument.defaultView.scrollY = 600;
  pageDocument.defaultView.getComputedStyle
    .mockReset()
    .mockReturnValue({ display: 'block', visibility: 'visible', opacity: '1' });
  vi.stubGlobal('document', pageDocument);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function browserBoundary() {
  const evaluate = vi.fn(async (fn: typeof measurePreviewFocus, selector: string) => fn(selector));
  const screenshot = vi.fn(async () => 'aW1n');
  return {
    evaluate,
    screenshot,
    page: { evaluate, screenshot } as unknown as Pick<Page, 'evaluate' | 'screenshot'>,
  };
}

describe('focused preview', () => {
  it('captures padded document coordinates at 2x and returns bounded DOM context without modifying source markup', async () => {
    const { page, screenshot } = browserBoundary();
    const before = element.outerHTML;
    const result = await capturePreviewFocus(page, { selector: '#pricing' }, 'Pricing.jsx', true);
    expect(result.focus).toEqual({
      selector: '#pricing',
      sourcePath: 'Pricing.jsx',
      tagName: 'section',
      text: 'Basic plan',
      outerHTML: '<section id="pricing">Basic plan</section>',
      bounds: { x: 112, y: 640, width: 300, height: 150 },
      clip: { x: 96, y: 624, width: 332, height: 182, scale: 2 },
    });
    expect(screenshot).toHaveBeenCalledExactlyOnceWith({
      type: 'png',
      encoding: 'base64',
      captureBeyondViewport: true,
      clip: result.focus?.clip,
    });
    expect(result.screenshot).toBe('data:image/png;base64,aW1n');
    expect(pageDocument.querySelectorAll).toHaveBeenCalledWith('#pricing');
    expect(element.scrollIntoView).toHaveBeenCalledOnce();
    expect(element.outerHTML).toBe(before);
  });

  it('uses explicit crop scale/padding and clamps document-edge padding', async () => {
    pageDocument.defaultView.scrollX = 0;
    pageDocument.defaultView.scrollY = 0;
    element.getBoundingClientRect.mockReturnValue({ x: 5, y: 3, width: 40, height: 20 });
    const { page } = browserBoundary();
    const result = await capturePreviewFocus(
      page,
      { selector: '#pricing', scale: 3, padding: 10 },
      'App.jsx',
      true,
    );
    expect(result.focus?.clip).toEqual({ x: 0, y: 0, width: 55, height: 33, scale: 3 });
  });

  it.each([0, 2])('rejects a selector matching %d elements before capture', async (count) => {
    pageDocument.querySelectorAll.mockReturnValue(Array.from({ length: count }, () => element));
    const { page, screenshot } = browserBoundary();
    await expect(capturePreviewFocus(page, { selector: '.card' }, 'App.jsx', true)).rejects.toThrow(
      'Focus requires one',
    );
    expect(screenshot).not.toHaveBeenCalled();
  });

  it('reports invalid CSS selectors without taking a screenshot', async () => {
    pageDocument.querySelectorAll.mockImplementation(() => {
      throw new Error('DOM syntax error');
    });
    const { page, screenshot } = browserBoundary();
    await expect(capturePreviewFocus(page, { selector: '[' }, 'App.jsx', true)).rejects.toThrow(
      'Invalid focus CSS',
    );
    expect(screenshot).not.toHaveBeenCalled();
  });

  it.each([
    { display: 'none' },
    { visibility: 'hidden' },
    { opacity: '0' },
  ])('rejects hidden ancestors (%j)', async (style) => {
    pageDocument.defaultView.getComputedStyle.mockImplementation((target) => ({
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      ...(target === element.parentElement ? style : {}),
    }));
    const { page, screenshot } = browserBoundary();
    await expect(
      capturePreviewFocus(page, { selector: '#pricing' }, 'App.jsx', true),
    ).rejects.toThrow('not visible');
    expect(screenshot).not.toHaveBeenCalled();
  });

  it.each([
    { x: 0, y: 0, width: 0, height: 100 },
    { x: 0, y: 0, width: Number.NaN, height: 100 },
    { x: -1000, y: 0, width: 10, height: 100 },
    { x: 0, y: 0, width: 2100, height: 20 },
    { x: 0, y: 0, width: 1500, height: 1500 },
  ])('rejects invalid geometry or excess screenshot allocation %j', async (bounds) => {
    const { page, evaluate, screenshot } = browserBoundary();
    evaluate.mockResolvedValue({ tagName: 'section', text: '', outerHTML: '', bounds });
    await expect(
      capturePreviewFocus(page, { selector: '#pricing' }, 'App.jsx', true),
    ).rejects.toThrow(/area|outside|exceeds/);
    expect(screenshot).not.toHaveBeenCalled();
  });

  it('returns text-only context without capturing an image and bounds long DOM content', async () => {
    element.innerText = 'detail '.repeat(1000);
    element.outerHTML = `<section>${element.innerText}</section>`;
    const { page, screenshot } = browserBoundary();
    const result = await capturePreviewFocus(page, { selector: '#pricing' }, 'App.jsx', false);
    expect(result.focus?.text).toHaveLength(2000);
    expect(result.focus?.outerHTML).toHaveLength(4000);
    expect(result.screenshot).toBeUndefined();
    expect(screenshot).not.toHaveBeenCalled();
  });

  it('does not turn capture cancellation into successful metadata-only inspection', async () => {
    const controller = new AbortController();
    controller.abort();
    const { page, screenshot } = browserBoundary();
    await expect(
      capturePreviewFocus(page, { selector: '#pricing' }, 'App.jsx', true, controller.signal),
    ).rejects.toThrow('cancelled');
    expect(screenshot).not.toHaveBeenCalled();
  });

  it('preserves genuine screenshot errors', async () => {
    const { page, screenshot } = browserBoundary();
    screenshot.mockRejectedValue(new Error('Capture failed'));
    await expect(
      capturePreviewFocus(page, { selector: '#pricing' }, 'App.jsx', true),
    ).rejects.toThrow('Capture failed');
  });
});
