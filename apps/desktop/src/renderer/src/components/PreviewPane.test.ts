import { describe, expect, it } from 'vitest';
import { isTrustedPreviewMessageSource, scaleRectForZoom } from './PreviewPane';

describe('isTrustedPreviewMessageSource', () => {
  it('accepts only messages from the active preview iframe window', () => {
    const previewWindow = {} as Window;
    const otherWindow = {} as Window;

    expect(isTrustedPreviewMessageSource(previewWindow, previewWindow)).toBe(true);
    expect(isTrustedPreviewMessageSource(otherWindow, previewWindow)).toBe(false);
    expect(isTrustedPreviewMessageSource(null, previewWindow)).toBe(false);
  });
});

describe('scaleRectForZoom', () => {
  const rect = { top: 100, left: 200, width: 300, height: 50 };

  it('returns identical coords at 100% zoom', () => {
    expect(scaleRectForZoom(rect, 100)).toEqual(rect);
  });

  it('halves coords and dimensions at 50% zoom', () => {
    expect(scaleRectForZoom(rect, 50)).toEqual({ top: 50, left: 100, width: 150, height: 25 });
  });

  it('doubles coords and dimensions at 200% zoom', () => {
    expect(scaleRectForZoom(rect, 200)).toEqual({ top: 200, left: 400, width: 600, height: 100 });
  });

  it('handles 75% zoom (the regression case)', () => {
    expect(scaleRectForZoom({ top: 80, left: 40, width: 100, height: 100 }, 75)).toEqual({
      top: 60,
      left: 30,
      width: 75,
      height: 75,
    });
  });
});
