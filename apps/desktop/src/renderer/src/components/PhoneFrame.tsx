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
        borderRadius: 'var(--radius-phone, 44px)',
        border: '8px solid var(--color-border-strong)',
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
          width: '120px',
          height: '30px',
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
          width: '375px',
          height: '812px',
          overflow: 'hidden',
          borderRadius: 'calc(var(--radius-phone, 44px) - 8px)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
