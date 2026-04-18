/**
 * open-codesign brand wordmark.
 * Small terracotta diamond + word, optional pre-alpha pill.
 * Use anywhere the app needs to identify itself.
 */

interface WordmarkProps {
  badge?: string;
  size?: 'sm' | 'md';
}

export function Wordmark({ badge, size = 'md' }: WordmarkProps) {
  const markPx = size === 'sm' ? 14 : 16;
  // token-ok: brand wordmark uses 13/14 px to match diamond mark optical sizing; tokens are not granular enough here
  const wordSize = size === 'sm' ? 'text-[13px]' : 'text-[14px]';
  return (
    // token-ok: wordmark gap tuned to 10px to align with mark stroke width
    <span className="inline-flex items-center gap-[10px] leading-none">
      <Mark size={markPx} />
      <span
        className={`${wordSize} font-semibold text-[var(--color-text-primary)] tracking-[-0.01em]`}
      >
        open<span className="text-[var(--color-text-muted)] font-normal">/</span>codesign
      </span>
      {badge ? (
        <span
          // token-ok: brand badge pill is intentionally smaller than text-xs to read as a meta tag, not a label
          className="inline-flex items-center h-[18px] px-[6px] ml-[6px] rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--color-accent)]"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {badge}
        </span>
      ) : null}
    </span>
  );
}

function Mark({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="shrink-0"
    >
      <title>open-codesign mark</title>
      <path
        d="M8 1.2 14.8 8 8 14.8 1.2 8 8 1.2Z"
        stroke="var(--color-accent)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8 5.2 10.8 8 8 10.8 5.2 8 8 5.2Z" fill="var(--color-accent)" />
    </svg>
  );
}
