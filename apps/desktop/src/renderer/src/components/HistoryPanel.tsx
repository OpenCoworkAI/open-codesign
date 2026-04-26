import { buildSrcdoc } from '@open-codesign/runtime';
import type { DesignSnapshot } from '@open-codesign/shared';
import { Clock, RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useCodesignStore } from '../store';

interface HistoryPanelProps {
  onClose: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function HistoryPanel({ onClose }: HistoryPanelProps) {
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const setPreviewHtml = useCodesignStore((s) => s.setPreviewHtml);
  const pushToast = useCodesignStore((s) => s.pushToast);

  const [snapshots, setSnapshots] = useState<DesignSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DesignSnapshot | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!currentDesignId || !window.codesign) return;
    setLoading(true);
    window.codesign.snapshots
      .list(currentDesignId)
      .then((rows) => {
        setSnapshots(rows);
        setSelected(rows[0] ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentDesignId]);

  const previewSrc = useMemo(
    () => (selected ? buildSrcdoc(selected.artifactSource) : null),
    [selected],
  );

  async function handleRestore() {
    if (!selected || !currentDesignId || !window.codesign) return;
    setRestoring(true);
    try {
      await window.codesign.snapshots.create({
        designId: currentDesignId,
        parentId: selected.id,
        type: 'fork',
        prompt: selected.prompt,
        artifactType: selected.artifactType,
        artifactSource: selected.artifactSource,
      });
      setPreviewHtml(selected.artifactSource);
      pushToast({ variant: 'success', title: 'Restored to selected version' });
      onClose();
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Restore failed',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-[var(--color-background)] border-l border-[var(--color-border)]">
      {/* Header */}
      <div className="flex items-center gap-[var(--space-2)] px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--color-border)] shrink-0">
        <Clock className="w-[14px] h-[14px] text-[var(--color-text-muted)]" aria-hidden />
        <span className="text-[13px] font-medium text-[var(--color-text-primary)] flex-1">
          Version History
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close history"
          className="p-[var(--space-1)] rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Snapshot list */}
        <div className="w-[200px] shrink-0 border-r border-[var(--color-border)] overflow-y-auto">
          {loading ? (
            <div className="px-4 py-3 text-[12px] text-[var(--color-text-muted)]">Loading…</div>
          ) : snapshots.length === 0 ? (
            <div className="px-4 py-3 text-[12px] text-[var(--color-text-muted)]">
              No history yet.
            </div>
          ) : (
            snapshots.map((snap, i) => (
              <button
                key={snap.id}
                type="button"
                onClick={() => setSelected(snap)}
                className={`w-full text-left px-[var(--space-3)] py-[var(--space-2_5)] border-b border-[var(--color-border-muted)] transition-colors ${
                  selected?.id === snap.id
                    ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                    : 'hover:bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]'
                }`}
              >
                <div className="text-[11.5px] font-medium truncate">
                  {i === 0
                    ? 'Current'
                    : snap.type === 'fork'
                      ? 'Restored'
                      : `v${snapshots.length - i}`}
                </div>
                <div className="text-[10.5px] text-[var(--color-text-muted)] mt-[2px]">
                  {formatDate(snap.createdAt)}
                </div>
                {snap.prompt && (
                  <div className="text-[10.5px] text-[var(--color-text-muted)] mt-[1px] truncate">
                    {snap.prompt.slice(0, 40)}
                  </div>
                )}
              </button>
            ))
          )}
        </div>

        {/* Preview area */}
        <div className="flex-1 flex flex-col min-w-0">
          {previewSrc ? (
            <iframe
              title="history-preview"
              sandbox="allow-scripts"
              srcDoc={previewSrc}
              className="flex-1 w-full border-0 bg-white"
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-[12px] text-[var(--color-text-muted)]">
              Select a version to preview.
            </div>
          )}

          {selected && (
            <div className="shrink-0 flex items-center justify-end gap-[var(--space-2)] px-[var(--space-4)] py-[var(--space-2)] border-t border-[var(--color-border)] bg-[var(--color-background-secondary)]">
              <button
                type="button"
                onClick={handleRestore}
                disabled={restoring || snapshots[0]?.id === selected.id}
                className="inline-flex items-center gap-[var(--space-1_5)] px-[var(--space-3)] py-[var(--space-1_5)] rounded-[var(--radius-md)] bg-[var(--color-accent)] text-white text-[12px] font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                <RotateCcw className="w-[12px] h-[12px]" aria-hidden />
                {restoring
                  ? 'Restoring…'
                  : snapshots[0]?.id === selected.id
                    ? 'Current version'
                    : 'Restore this version'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
