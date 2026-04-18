import type { ReactNode } from 'react';

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
  if (!label) return <>{children}</>;
  return (
    <span className="relative inline-flex group">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute ${sideClass[side]} z-50 whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--color-text-primary)] px-2 py-1 text-[11px] font-medium text-[var(--color-background)] opacity-0 transition-opacity duration-150 delay-[400ms] group-hover:opacity-100 group-focus-within:opacity-100 shadow-[var(--shadow-card)]`}
      >
        {label}
      </span>
    </span>
  );
}
