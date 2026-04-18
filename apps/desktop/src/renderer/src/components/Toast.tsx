import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
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

function ToastItem({ toast }: { toast: ToastModel }) {
  const dismiss = useCodesignStore((s) => s.dismissToast);
  const Icon = iconFor[toast.variant];
  return (
    <output className="flex items-start gap-3 w-80 px-4 py-3 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] shadow-[var(--shadow-elevated)] animate-[toast-in_180ms_ease-out]">
      <Icon className="w-5 h-5 mt-0.5 shrink-0" style={{ color: accentFor[toast.variant] }} />
      <div className="flex-1 min-w-0">
        <div className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)]">
          {toast.title}
        </div>
        {toast.description ? (
          <div className="text-[var(--text-xs)] text-[var(--color-text-secondary)] mt-0.5 break-words">
            {toast.description}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => dismiss(toast.id)}
        className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </output>
  );
}

export function ToastViewport() {
  const toasts = useCodesignStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2 items-end"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} />
        </div>
      ))}
    </div>
  );
}
