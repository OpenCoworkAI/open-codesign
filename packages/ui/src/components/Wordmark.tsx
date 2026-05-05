/**
 * open-codesign brand wordmark.
 * Logo icon + word, optional pre-alpha pill.
 * Use anywhere the app needs to identify itself.
 */

import logoSrc from '../assets/logo.png';

interface WordmarkProps {
  badge?: string;
  size?: 'sm' | 'md' | 'titlebar';
}

export function Wordmark({ badge, size = 'md' }: WordmarkProps) {
  const metrics = {
    sm: { markPx: 36, fontSize: '16px', badgeSize: '8px', gap: '8px', badgeMarginTop: '4px' },
    titlebar: {
      markPx: 56,
      fontSize: '24px',
      badgeSize: '9px',
      gap: '10px',
      badgeMarginTop: '6px',
    },
    md: { markPx: 88, fontSize: '30px', badgeSize: '10px', gap: '16px', badgeMarginTop: '10px' },
  }[size];
  return (
    <span className="inline-flex items-center leading-none" style={{ gap: metrics.gap }}>
      <img
        src={logoSrc}
        alt=""
        width={metrics.markPx}
        height={metrics.markPx}
        className="shrink-0"
        draggable={false}
      />
      <span className="flex flex-col">
        <span
          className="leading-none"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: metrics.fontSize,
            fontWeight: 600,
            letterSpacing: '0',
          }}
        >
          <span style={{ color: '#142d4c' }}>Open </span>
          <span style={{ color: '#b5441a' }}>CoDesign</span>
        </span>
        {badge ? (
          <span
            className="font-medium uppercase leading-none"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: metrics.badgeSize,
              letterSpacing: '0.12em',
              color: '#9a8a7c',
              marginTop: metrics.badgeMarginTop,
            }}
          >
            {badge}
          </span>
        ) : null}
      </span>
    </span>
  );
}
