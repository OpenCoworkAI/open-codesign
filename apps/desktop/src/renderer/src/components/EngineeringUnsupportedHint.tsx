import { useT } from '@open-codesign/i18n';
import { useCodesignStore } from '../store';

/**
 * Engineering-mode rejection dialog (U11).
 *
 * Renders when the user picks a non-React workspace for an engineering
 * session. The detector landed a stable `reason` string (e.g.
 * `detected-vue`, `missing-package-json`); this component branches on it
 * to show concrete, actionable copy instead of a generic toast.
 *
 * No row was written to the `designs` table by the time we render — closing
 * the dialog simply returns the user to the hub. The "Use generative mode
 * instead" affordance opens the existing NewDesignDialog so the user can
 * fall back without losing the picked workspace path.
 */
export function EngineeringUnsupportedHint() {
  const t = useT();
  const hint = useCodesignStore((s) => s.engineeringUnsupportedHint);
  const dismiss = useCodesignStore((s) => s.dismissEngineeringUnsupportedHint);
  const openNewDesignDialog = useCodesignStore((s) => s.openNewDesignDialog);

  if (!hint) return null;

  // Map detector `reason` codes onto user-facing labels. Unknown codes fall
  // through to the generic "non-React framework" message — we still want to
  // surface the raw reason for the user / a future bug report.
  const reasonLabel = (() => {
    const r = hint.reason;
    if (r === 'missing-package-json') return t('engineering.unsupported.reasonMissingPkg');
    if (r.startsWith('detected-')) {
      const fw = r.slice('detected-'.length);
      return t('engineering.unsupported.reasonDetectedFramework', { framework: fw });
    }
    return t('engineering.unsupported.reasonGeneric');
  })();

  function handleFallback() {
    dismiss();
    openNewDesignDialog();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('engineering.unsupported.title')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] animate-[overlay-in_120ms_ease-out]"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') dismiss();
      }}
    >
      <div
        role="document"
        className="w-full max-w-md rounded-[var(--radius-2xl)] bg-[var(--color-background)] border border-[var(--color-border)] shadow-[var(--shadow-elevated)] p-5 space-y-4 animate-[panel-in_160ms_ease-out]"
      >
        <div className="space-y-1">
          <h3 className="text-[var(--text-md)] font-medium text-[var(--color-text-primary)]">
            {t('engineering.unsupported.title')}
          </h3>
          <p className="text-[var(--text-sm)] text-[var(--color-text-secondary)] leading-[var(--leading-body)]">
            {t('engineering.unsupported.subtitle')}
          </p>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 space-y-1">
          <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] font-mono break-all">
            {hint.workspacePath}
          </p>
          <p className="text-[var(--text-xs)] text-[var(--color-text-secondary)]">{reasonLabel}</p>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => dismiss()}
            className="h-9 px-3 rounded-[var(--radius-md)] text-[var(--text-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            {t('engineering.unsupported.dismiss')}
          </button>
          <button
            type="button"
            onClick={handleFallback}
            className="h-9 px-3 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[var(--text-sm)] font-medium hover:opacity-90 transition-opacity"
          >
            {t('engineering.unsupported.useGenerative')}
          </button>
        </div>
      </div>
    </div>
  );
}
