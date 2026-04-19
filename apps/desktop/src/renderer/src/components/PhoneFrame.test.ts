import { describe, expect, it } from 'vitest';
import { PHONE_FRAME_SIZING } from './PhoneFrame';

describe('PhoneFrame sizing contract', () => {
  it('uses iPhone-reference 375x812 screen dimensions', () => {
    expect(PHONE_FRAME_SIZING.expectedScreenWidthPx).toBe(375);
    expect(PHONE_FRAME_SIZING.expectedScreenHeightPx).toBe(812);
  });

  it('keeps total frame size near iPhone 396x844 (within 8px bezel)', () => {
    expect(PHONE_FRAME_SIZING.expectedFrameWidthPx).toBe(391);
    expect(PHONE_FRAME_SIZING.expectedFrameHeightPx).toBe(828);
  });

  it('references shared design tokens, not hard-coded pixels', () => {
    expect(PHONE_FRAME_SIZING.screenWidthVar).toBe('--size-preview-mobile-width');
    expect(PHONE_FRAME_SIZING.screenHeightVar).toBe('--size-preview-mobile-height');
    expect(PHONE_FRAME_SIZING.borderWidthVar).toBe('--border-width-strong');
  });
});
