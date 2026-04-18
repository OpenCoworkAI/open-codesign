import { useT } from '@open-codesign/i18n';
import { useEffect, useRef, useState } from 'react';
import { useCodesignStore } from '../store';

export function RenameDesignDialog() {
  const t = useT();
  const target = useCodesignStore((s) => s.designToRename);
  const close = useCodesignStore((s) => s.requestRenameDesign);
  const renameDesign = useCodesignStore((s) => s.renameDesign);

  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (target) {
      setValue(target.name);
      requestAnimationFrame(() => {
        inputRef.current?.select();
      });
    } else {
      setValue('');
    }
  }, [target]);

  if (!target) return null;

  const trimmed = value.trim();
  const canSave = trimmed.length > 0 && trimmed !== target.name;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!target || !canSave) return;
    void renameDesign(target.id, trimmed);
  }

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: native <dialog> top-layer rendering interferes with our overlay stack
      role="dialog"
      aria-modal="true"
      aria-label={t('projects.rename.title')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] animate-[overlay-in_120ms_ease-out]"
      onClick={(e) => {
        if (e.target === e.currentTarget) close(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close(null);
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-[var(--radius-2xl)] bg-[var(--color-background)] border border-[var(--color-border)] shadow-[var(--shadow-elevated)] p-5 space-y-4 animate-[panel-in_160ms_ease-out]"
      >
        <h3 className="text-[var(--text-md)] font-medium text-[var(--color-text-primary)]">
          {t('projects.rename.title')}
        </h3>
        <label className="block space-y-1.5">
          <span className="text-[var(--text-xs)] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] font-medium">
            {t('projects.rename.label')}
          </span>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('projects.rename.placeholder')}
            className="w-full h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[var(--text-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-focus-ring)] transition-[box-shadow,border-color] duration-150"
          />
        </label>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => close(null)}
            className="h-9 px-3 rounded-[var(--radius-md)] text-[var(--text-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            {t('projects.rename.cancel')}
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="h-9 px-3 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[var(--text-sm)] font-medium hover:bg-[var(--color-accent-hover)] disabled:opacity-30 disabled:hover:bg-[var(--color-accent)] transition-colors"
          >
            {t('projects.rename.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
