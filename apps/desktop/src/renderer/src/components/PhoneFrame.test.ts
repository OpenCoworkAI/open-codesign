import { describe, expect, it } from 'vitest';
import { PHONE_FRAME_SIZING, PHONE_FRAME_TEST_IDS } from './PhoneFrame';

describe('PhoneFrame sizing contract', () => {
  it('uses iPhone-reference 375x812 screen dimensions', () => {
    expect(PHONE_FRAME_SIZING.expectedScreenWidthPx).toBe(375);
    expect(PHONE_FRAME_SIZING.expectedScreenHeightPx).toBe(812);
  });

  it('uses a thin bezel so artifacts are not visually clipped', () => {
    expect(PHONE_FRAME_SIZING.expectedBezelWidthPx).toBe(3);
    expect(PHONE_FRAME_SIZING.expectedFrameWidthPx).toBe(381);
    expect(PHONE_FRAME_SIZING.expectedFrameHeightPx).toBe(818);
  });

  it('references shared design tokens, not hard-coded pixels', () => {
    expect(PHONE_FRAME_SIZING.screenWidthVar).toBe('--size-preview-mobile-width');
    expect(PHONE_FRAME_SIZING.screenHeightVar).toBe('--size-preview-mobile-height');
    expect(PHONE_FRAME_SIZING.bezelWidthVar).toBe('--border-width-phone-bezel');
  });

  it('paints the body with a dedicated phone-body token, not the app surface', () => {
    expect(PHONE_FRAME_SIZING.bodyColorVar).toBe('--color-phone-body');
    expect(PHONE_FRAME_SIZING.bodyColorVar).not.toBe('--color-surface');
    expect(PHONE_FRAME_SIZING.bodyColorVar).not.toBe('--color-background');
  });

  it('exposes a dynamic island element via tokens and a stable test id', () => {
    expect(PHONE_FRAME_SIZING.islandWidthVar).toBe('--size-preview-mobile-island-width');
    expect(PHONE_FRAME_SIZING.islandHeightVar).toBe('--size-preview-mobile-island-height');
    expect(PHONE_FRAME_SIZING.islandColorVar).toBe('--color-phone-island');
    expect(PHONE_FRAME_TEST_IDS.dynamicIsland).toBe('phone-frame-dynamic-island');
  });
});
