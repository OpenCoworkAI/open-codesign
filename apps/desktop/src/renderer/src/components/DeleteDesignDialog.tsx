import { useT } from '@open-codesign/i18n';
import { useCodesignStore } from '../store';

export function DeleteDesignDialog() {
  const t = useT();
  const target = useCodesignStore((s) => s.designToDelete);
  const close = useCodesignStore((s) => s.requestDeleteDesign);
  const softDeleteDesign = useCodesignStore((s) => s.softDeleteDesign);

  if (!target) return null;

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: native <dialog> top-layer rendering interferes with our overlay stack
      role="dialog"
      aria-modal="true"
      aria-label={t('projects.delete.title')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] animate-[overlay-in_120ms_ease-out]"
      onClick={(e) => {
        if (e.target === e.currentTarget) close(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close(null);
      }}
    >
      <div
        role="document"
        className="w-full max-w-sm rounded-[var(--radius-2xl)] bg-[var(--color-background)] border border-[var(--color-border)] shadow-[var(--shadow-elevated)] p-5 space-y-4 animate-[panel-in_160ms_ease-out]"
      >
        <h3 className="text-[var(--text-md)] font-medium text-[var(--color-text-primary)]">
          {t('projects.delete.title')}
        </h3>
        <p className="text-[var(--text-sm)] text-[var(--color-text-secondary)] leading-[var(--leading-body)]">
          {t('projects.delete.body', { name: target.name })}
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => close(null)}
            className="h-9 px-3 rounded-[var(--radius-md)] text-[var(--text-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            {t('projects.delete.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void softDeleteDesign(target.id)}
            className="h-9 px-3 rounded-[var(--radius-md)] bg-[var(--color-error)] text-[var(--color-on-accent)] text-[var(--text-sm)] font-medium hover:opacity-90 transition-opacity"
          >
            {t('projects.delete.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
