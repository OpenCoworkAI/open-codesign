import { type ReactNode, isValidElement, useId } from 'react';

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
  // Only the wrapper needs to be keyboard-focusable when the wrapped control
  // is disabled (disabled buttons cannot receive focus). For enabled controls
  // the inner element is already in the tab order, so making the wrapper
  // focusable would create a redundant extra tab stop. aria-describedby stays
  // on the wrapper either way so screen readers announce the reason whether
  // focus lands on the wrapper or on the inner control.
  const childDisabled =
    isValidElement<{ disabled?: boolean }>(children) && Boolean(children.props.disabled);
  return (
    <span
      className="relative inline-flex group focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] rounded-[var(--radius-sm)]"
      tabIndex={childDisabled ? 0 : undefined}
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
