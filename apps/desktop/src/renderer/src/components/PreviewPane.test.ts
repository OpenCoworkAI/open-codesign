import { describe, expect, it } from 'vitest';
import { isTrustedPreviewMessageSource } from './PreviewPane';

describe('isTrustedPreviewMessageSource', () => {
  it('accepts only messages from the active preview iframe window', () => {
    const previewWindow = {} as Window;
    const otherWindow = {} as Window;

    expect(isTrustedPreviewMessageSource(previewWindow, previewWindow)).toBe(true);
    expect(isTrustedPreviewMessageSource(otherWindow, previewWindow)).toBe(false);
    expect(isTrustedPreviewMessageSource(null, previewWindow)).toBe(false);
  });
});
