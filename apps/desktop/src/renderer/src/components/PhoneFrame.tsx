import type { ReactElement } from 'react';

interface PhoneFrameProps {
  children: ReactElement;
}

/**
 * Pure-data sizing contract for the iPhone-style bezel. Exported so unit
 * tests can verify the frame stays at iPhone-reference dimensions and
 * uses the correct design tokens without needing a DOM environment.
 */
export const PHONE_FRAME_SIZING = {
  screenWidthVar: '--size-preview-mobile-width',
  screenHeightVar: '--size-preview-mobile-height',
  bezelWidthVar: '--border-width-phone-bezel',
  bodyColorVar: '--color-phone-body',
  islandColorVar: '--color-phone-island',
  islandWidthVar: '--size-preview-mobile-island-width',
  islandHeightVar: '--size-preview-mobile-island-height',
  expectedScreenWidthPx: 375,
  expectedScreenHeightPx: 812,
  expectedBezelWidthPx: 3,
  get expectedFrameWidthPx(): number {
    return this.expectedScreenWidthPx + this.expectedBezelWidthPx * 2;
  },
  get expectedFrameHeightPx(): number {
    return this.expectedScreenHeightPx + this.expectedBezelWidthPx * 2;
  },
} as const;

export const PHONE_FRAME_TEST_IDS = {
  body: 'phone-frame-body',
  dynamicIsland: 'phone-frame-dynamic-island',
} as const;

/**
 * Renders an iPhone-style device shell around its child iframe.
 *
 * Single-layer body in deep space-gray (intentionally distinct from the
 * cream app background so the device reads as a physical object), a thin
 * bezel, and a centered Dynamic Island. The screen rounds inward by
 * (radius-phone − bezel) so artifact content isn't clipped at the corners.
 */
export function PhoneFrame({ children }: PhoneFrameProps): ReactElement {
  return (
    <div
      data-testid={PHONE_FRAME_TEST_IDS.body}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        position: 'relative',
        flexShrink: 0,
        boxSizing: 'content-box',
        padding: 'var(--border-width-phone-bezel)',
        borderRadius: 'var(--radius-phone)',
        background: 'var(--color-phone-body)',
        boxShadow: 'var(--shadow-elevated)',
      }}
    >
      {/* Screen — fixed dimensions; iframe child fills 100% */}
      <div
        style={{
          position: 'relative',
          width: 'var(--size-preview-mobile-width)',
          height: 'var(--size-preview-mobile-height)',
          flexShrink: 0,
          overflow: 'hidden',
          background: 'var(--color-artifact-bg)',
          borderRadius: 'calc(var(--radius-phone) - var(--border-width-phone-bezel))',
        }}
      >
        {children}
      </div>
      {/* Dynamic Island — pill, floats over the screen top */}
      <div
        data-testid={PHONE_FRAME_TEST_IDS.dynamicIsland}
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 'var(--space-2)',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'var(--size-preview-mobile-island-width)',
          height: 'var(--size-preview-mobile-island-height)',
          background: 'var(--color-phone-island)',
          borderRadius: 'var(--radius-full)',
          zIndex: 2,
          pointerEvents: 'none',
        }}
      />
      {/* Home indicator */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          bottom: 'var(--space-2)',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'var(--size-preview-mobile-home-indicator-width)',
          height: 'var(--size-preview-mobile-home-indicator-height)',
          background: 'var(--color-phone-island)',
          borderRadius: 'var(--radius-full)',
          opacity: 0.5,
          zIndex: 2,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
