import { useT } from '@open-codesign/i18n';
import { useState } from 'react';
import { useCodesignStore } from '../store';

export function RebindWorkspaceDialog() {
  const t = useT();
  const pending = useCodesignStore((s) => s.workspaceRebindPending);
  const cancelRebind = useCodesignStore((s) => s.cancelWorkspaceRebind);
  const confirmRebind = useCodesignStore((s) => s.confirmWorkspaceRebind);
  const [isLoading, setIsLoading] = useState(false);

  if (!pending) return null;

  const { design, newPath } = pending;

  async function handleSwitchOnly() {
    setIsLoading(true);
    try {
      await confirmRebind(false);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSwitchAndCopy() {
    setIsLoading(true);
    try {
      await confirmRebind(true);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('canvas.workspace.rebindTitle')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] animate-[overlay-in_120ms_ease-out]"
      onClick={(e) => {
        if (e.target === e.currentTarget) cancelRebind();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') cancelRebind();
      }}
    >
      <div
        role="document"
        className="w-full max-w-sm rounded-[var(--radius-2xl)] bg-[var(--color-background)] border border-[var(--color-border)] shadow-[var(--shadow-elevated)] p-5 space-y-4 animate-[panel-in_160ms_ease-out]"
      >
        <h3 className="text-[var(--text-md)] font-medium text-[var(--color-text-primary)]">
          {t('canvas.workspace.rebindTitle')}
        </h3>
        <div className="space-y-2">
          <p className="text-[var(--text-sm)] text-[var(--color-text-secondary)] leading-[var(--leading-body)]">
            {t('canvas.workspace.rebindDescription')}
          </p>
          <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] font-mono break-all">
            {newPath}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => cancelRebind()}
            disabled={isLoading}
            className="h-9 px-3 rounded-[var(--radius-md)] text-[var(--text-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t('canvas.workspace.rebindCancel')}
          </button>
          <button
            type="button"
            onClick={() => void handleSwitchOnly()}
            disabled={isLoading}
            className="h-9 px-3 rounded-[var(--radius-md)] text-[var(--text-sm)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t('canvas.workspace.rebindSwitchOnly')}
          </button>
          <button
            type="button"
            onClick={() => void handleSwitchAndCopy()}
            disabled={isLoading}
            className="h-9 px-3 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[var(--text-sm)] font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {t('canvas.workspace.rebindSwitchAndCopy')}
          </button>
        </div>
      </div>
    </div>
  );
}
