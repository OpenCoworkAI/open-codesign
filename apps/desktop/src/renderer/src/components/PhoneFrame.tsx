import type { ReactElement } from 'react';

interface PhoneFrameProps {
  children: ReactElement;
}

/**
 * Renders an iPhone-style bezel around its child iframe.
 * All measurements are derived from design tokens (CSS custom properties).
 * No px or color hard-codes — see packages/ui/src/tokens.css.
 */
export function PhoneFrame({ children }: PhoneFrameProps): ReactElement {
  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        position: 'relative',
        borderRadius: 'var(--radius-phone)',
        border: 'var(--border-width-strong) solid var(--color-border-strong)',
        boxShadow: 'var(--shadow-elevated)',
        background: 'var(--color-surface)',
        overflow: 'hidden',
        /* extra inner shadow mimicking the screen recess */
        outline: '1px solid var(--color-border)',
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
        }}
      />
      {/* Screen area */}
      <div
        style={{
          position: 'relative',
          width: 'var(--size-preview-mobile-width)',
          height: 'var(--size-preview-mobile-height)',
          overflow: 'hidden',
          borderRadius: 'calc(var(--radius-phone) - var(--border-width-strong))',
        }}
      >
        {children}
      </div>
    </div>
  );
}
