import { useT } from '@open-codesign/i18n';
import { X } from 'lucide-react';
import { useCodesignStore } from '../store';

export function CanvasErrorBar() {
  const t = useT();
  const errors = useCodesignStore((s) => s.iframeErrors);
  const clear = useCodesignStore((s) => s.clearIframeErrors);
  if (errors.length === 0) return null;
  const latest = errors[errors.length - 1];
  if (!latest) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-3 px-4 py-2 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-error)_10%,var(--color-background))] text-[var(--color-text-primary)]"
    >
      <span className="mt-0.5 inline-block w-2 h-2 rounded-full bg-[var(--color-error)] shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-error)]">
          {t('preview.runtimeError')}
          {errors.length > 1 ? ` (${errors.length})` : ''}
        </div>
        <div className="text-sm text-[var(--color-text-primary)] truncate" title={latest}>
          {latest}
        </div>
      </div>
      <button
        type="button"
        onClick={clear}
        aria-label={t('preview.dismissErrors')}
        className="shrink-0 p-1 rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
