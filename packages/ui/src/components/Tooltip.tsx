import { useId, type ReactNode } from 'react';

export interface TooltipProps {
  label: string | undefined;
  side?: 'top' | 'bottom';
  children: ReactNode;
}

const sideClass: Record<NonNullable<TooltipProps['side']>, string> = {
  top: 'bottom-full mb-1.5 left-1/2 -translate-x-1/2',
  bottom: 'top-full mt-1.5 left-1/2 -translate-x-1/2',
};

export function Tooltip({ label, side = 'bottom', children }: TooltipProps) {
  const tooltipId = useId();
  if (!label) return <>{children}</>;
  // Wrapper is focusable so keyboard users can land on it even when the
  // wrapped control is disabled (disabled buttons cannot receive focus).
  // aria-describedby points at the visible tooltip text so screen readers
  // announce the reason on focus.
  return (
    <span
      className="relative inline-flex group focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] rounded-[var(--radius-sm)]"
      tabIndex={0}
      aria-describedby={tooltipId}
    >
      {children}
      <span
        id={tooltipId}
        role="tooltip"
        className={`pointer-events-none absolute ${sideClass[side]} z-50 whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--color-text-primary)] px-2 py-1 text-[11px] font-medium text-[var(--color-background)] opacity-0 transition-opacity duration-150 delay-[400ms] group-hover:opacity-100 group-focus-within:opacity-100 group-focus:opacity-100 shadow-[var(--shadow-card)]`}
      >
        {label}
      </span>
    </span>
  );
}
