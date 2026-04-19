import type { ReactElement } from 'react';

interface PhoneFrameProps {
  children: ReactElement;
}

/**
 * Pure-data sizing contract for the iPhone-style bezel. Exported so unit
 * tests can verify the frame stays at iPhone-reference dimensions without
 * needing a DOM environment.
 */
export const PHONE_FRAME_SIZING = {
  screenWidthVar: '--size-preview-mobile-width',
  screenHeightVar: '--size-preview-mobile-height',
  borderWidthVar: '--border-width-strong',
  expectedScreenWidthPx: 375,
  expectedScreenHeightPx: 812,
  expectedBorderWidthPx: 8,
  get expectedFrameWidthPx(): number {
    return this.expectedScreenWidthPx + this.expectedBorderWidthPx * 2;
  },
  get expectedFrameHeightPx(): number {
    return this.expectedScreenHeightPx + this.expectedBorderWidthPx * 2;
  },
} as const;

/**
 * Renders an iPhone-style bezel around its child iframe.
 * All measurements are derived from design tokens (CSS custom properties).
 * No px or color hard-codes — see packages/ui/src/tokens.css.
 *
 * The screen area has fixed pixel dimensions; child iframes should fill
 * 100% of that area (do not set their own pixel width/height).
 */
export function PhoneFrame({ children }: PhoneFrameProps): ReactElement {
  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        position: 'relative',
        flexShrink: 0,
        boxSizing: 'content-box',
        borderRadius: 'var(--radius-phone)',
        border: 'var(--border-width-strong) solid var(--color-border-strong)',
        boxShadow: 'var(--shadow-elevated), var(--shadow-inset-soft)',
        background: 'var(--color-surface)',
        overflow: 'hidden',
      }}
    >
      {/* Notch */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'var(--size-preview-mobile-notch-width)',
          height: 'var(--size-preview-mobile-notch-height)',
          background: 'var(--color-border-strong)',
          borderBottomLeftRadius: 'var(--radius-lg)',
          borderBottomRightRadius: 'var(--radius-lg)',
          zIndex: 2,
          pointerEvents: 'none',
        }}
      />
      {/* Screen area — fixed dimensions; iframe child fills 100% */}
      <div
        style={{
          position: 'relative',
          width: 'var(--size-preview-mobile-width)',
          height: 'var(--size-preview-mobile-height)',
          flexShrink: 0,
          overflow: 'hidden',
          borderRadius: 'calc(var(--radius-phone) - var(--border-width-strong))',
        }}
      >
        {children}
      </div>
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
          background: 'var(--color-border-strong)',
          borderRadius: 'var(--radius-full)',
          opacity: 0.65,
          zIndex: 2,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
