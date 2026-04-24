import { useT } from '@open-codesign/i18n';
import { FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { useCodesignStore } from '../store';

export function NewDesignDialog() {
  const t = useT();
  const open = useCodesignStore((s) => s.newDesignDialogOpen);
  const close = useCodesignStore((s) => s.closeNewDesignDialog);
  const createNewDesign = useCodesignStore((s) => s.createNewDesign);
  const setView = useCodesignStore((s) => s.setView);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);

  if (!open) return null;

  async function handlePickFolder() {
    if (!window.codesign?.snapshots?.pickWorkspaceFolder) return;
    setPicking(true);
    try {
      const picked = await window.codesign.snapshots.pickWorkspaceFolder();
      if (picked) setSelectedPath(picked);
    } finally {
      setPicking(false);
    }
  }

  async function handleCreate(withPath: string | null) {
    setCreating(true);
    try {
      const design = await createNewDesign(withPath);
      close();
      setSelectedPath(null);
      if (design) setView('workspace');
    } finally {
      setCreating(false);
    }
  }

  const busy = picking || creating;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('canvas.newDesignDialog.title')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] animate-[overlay-in_120ms_ease-out]"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) {
          close();
          setSelectedPath(null);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) {
          close();
          setSelectedPath(null);
        }
      }}
    >
      <div
        role="document"
        className="w-full max-w-sm rounded-[var(--radius-2xl)] bg-[var(--color-background)] border border-[var(--color-border)] shadow-[var(--shadow-elevated)] p-5 space-y-4 animate-[panel-in_160ms_ease-out]"
      >
        <div className="space-y-1">
          <h3 className="text-[var(--text-md)] font-medium text-[var(--color-text-primary)]">
            {t('canvas.newDesignDialog.title')}
          </h3>
          <p className="text-[var(--text-sm)] text-[var(--color-text-secondary)] leading-[var(--leading-body)]">
            {t('canvas.newDesignDialog.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
          <span className="flex-1 text-[var(--text-sm)] text-[var(--color-text-secondary)] font-mono truncate">
            {selectedPath ?? t('canvas.newDesignDialog.noWorkspace')}
          </span>
          <button
            type="button"
            onClick={() => void handlePickFolder()}
            disabled={busy}
            className="flex items-center gap-1.5 shrink-0 h-7 px-2.5 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <FolderOpen className="size-3.5" />
            {selectedPath ? t('canvas.workspace.change') : t('canvas.workspace.choose')}
          </button>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => void handleCreate(null)}
            disabled={busy}
            className="h-9 px-3 rounded-[var(--radius-md)] text-[var(--text-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t('canvas.newDesignDialog.skip')}
          </button>
          <button
            type="button"
            onClick={() => void handleCreate(selectedPath)}
            disabled={busy}
            className="h-9 px-3 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[var(--text-sm)] font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {t('canvas.newDesignDialog.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
