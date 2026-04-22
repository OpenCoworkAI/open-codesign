import { useT } from '@open-codesign/i18n';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useEffect } from 'react';
import { useCodesignStore } from '../store';
import type { Toast as ToastModel, ToastVariant } from '../store';

export function useToast() {
  const push = useCodesignStore((s) => s.pushToast);
  const dismiss = useCodesignStore((s) => s.dismissToast);
  return { push, dismiss };
}

const iconFor: Record<ToastVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

const accentFor: Record<ToastVariant, string> = {
  success: 'var(--color-toast-success)',
  error: 'var(--color-toast-error)',
  info: 'var(--color-accent)',
};

export const AUTO_DISMISS_MS: Record<ToastVariant, number | null> = {
  success: 5000,
  info: 5000,
  error: null,
};

export function scheduleAutoDismiss(
  variant: ToastVariant,
  onDismiss: () => void,
): (() => void) | null {
  const ms = AUTO_DISMISS_MS[variant];
  if (ms === null) return null;
  const id = setTimeout(onDismiss, ms);
  return () => {
    clearTimeout(id);
  };
}

function ToastItem({ toast }: { toast: ToastModel }) {
  const dismiss = useCodesignStore((s) => s.dismissToast);
  const t = useT();
  const Icon = iconFor[toast.variant];
  const isError = toast.variant === 'error';
  const autoMs = AUTO_DISMISS_MS[toast.variant];

  useEffect(() => {
    const cleanup = scheduleAutoDismiss(toast.variant, () => {
      dismiss(toast.id);
    });
    return cleanup ?? undefined;
  }, [toast.id, toast.variant, dismiss]);

  // Synchronous — the ReportableError was already registered in the store
  // when the toast was pushed, so Report opens instantly without an IPC
  // round-trip or DB lookup.
  function openReport(): void {
    const localId = toast.localId;
    if (!localId) return;
    useCodesignStore.getState().openReportDialog(localId);
  }

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className="relative overflow-hidden flex items-start gap-3 min-w-72 max-w-96 px-4 py-3 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] shadow-[var(--shadow-elevated)] animate-[toast-in_180ms_ease-out] motion-reduce:animate-none"
    >
      <Icon className="w-5 h-5 mt-0.5 shrink-0" style={{ color: accentFor[toast.variant] }} />
      <div className="flex-1 min-w-0">
        <div className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)] break-words">
          {toast.title}
        </div>
        {toast.description ? (
          <div className="text-[var(--text-xs)] text-[var(--color-text-secondary)] mt-0.5 break-words">
            {toast.description}
          </div>
        ) : null}
        {toast.action ? (
          <button
            type="button"
            onClick={() => {
              toast.action?.onClick();
              dismiss(toast.id);
            }}
            className="mt-2 inline-flex items-center h-6 px-2 rounded-[var(--radius-sm)] text-[var(--text-xs)] font-medium text-[var(--color-on-accent)] bg-[var(--color-accent)] hover:opacity-90 transition-opacity"
          >
            {toast.action.label}
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {isError && toast.localId ? (
          <button
            type="button"
            onClick={openReport}
            className="h-6 px-2 inline-flex items-center gap-1 rounded-[var(--radius-sm)] text-[var(--text-xs)] font-medium text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            {t('toast.error.report')}
          </button>
        ) : null}
        <button
          type="button"
          aria-label={t('common.dismissNotification')}
          onClick={() => {
            dismiss(toast.id);
          }}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {autoMs !== null ? (
        <div
          aria-hidden="true"
          className="absolute bottom-0 left-0 right-0 h-0.5 origin-left bg-[var(--color-text-muted)]/30 motion-safe:animate-[toast-countdown_linear_forwards]"
          style={{ animationDuration: `${autoMs}ms` }}
        />
      ) : null}
    </div>
  );
}

export function ToastViewport() {
  const toasts = useCodesignStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2 items-end">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} />
        </div>
      ))}
    </div>
  );
}
