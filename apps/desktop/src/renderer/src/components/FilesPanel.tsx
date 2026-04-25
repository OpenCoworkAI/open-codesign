import { useT } from '@open-codesign/i18n';
import { FileCode2, Folder, FolderOpen, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatAbsoluteTime, formatRelativeTime, useDesignFiles } from '../hooks/useDesignFiles';
import { workspacePathComparisonKey } from '../lib/workspace-path';
import { useCodesignStore } from '../store';

function formatBytes(n: number | undefined): string {
  if (n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function truncatePath(path: string, maxLength = 50): string {
  if (path.length <= maxLength) return path;
  const start = path.substring(0, maxLength / 2 - 2);
  const end = path.substring(path.length - maxLength / 2 + 2);
  return `${start}…${end}`;
}

export function FilesPanel() {
  const t = useT();
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const designs = useCodesignStore((s) => s.designs);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const generatingDesignId = useCodesignStore((s) => s.generatingDesignId);
  const openFileTab = useCodesignStore((s) => s.openCanvasFileTab);
  const requestWorkspaceRebind = useCodesignStore((s) => s.requestWorkspaceRebind);
  const { files, loading } = useDesignFiles(currentDesignId);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [folderExists, setFolderExists] = useState<boolean | null>(null);

  const currentDesign = designs.find((d) => d.id === currentDesignId);
  const workspacePath = currentDesign?.workspacePath ?? null;
  const isCurrentDesignGenerating = isGenerating && generatingDesignId === currentDesignId;

  useEffect(() => {
    if (!workspacePath || !currentDesignId) {
      setFolderExists(null);
      return;
    }
    window.codesign?.snapshots
      .checkWorkspaceFolder?.(currentDesignId)
      .then((r) => setFolderExists(r.exists))
      .catch((err) => {
        setFolderExists(null);
        useCodesignStore.getState().pushToast({
          variant: 'error',
          title: t('canvas.workspace.updateFailed'),
          description: err instanceof Error ? err.message : t('errors.unknown'),
        });
      });
  }, [currentDesignId, workspacePath, t]);

  async function handlePickWorkspace() {
    if (!window.codesign?.snapshots.pickWorkspaceFolder) return;
    if (isCurrentDesignGenerating) {
      useCodesignStore.getState().pushToast({
        variant: 'info',
        title: t('canvas.workspace.busyGenerating'),
      });
      return;
    }
    try {
      setWorkspaceLoading(true);
      const path = await window.codesign.snapshots.pickWorkspaceFolder();
      if (path && currentDesign && currentDesignId) {
        if (
          currentDesign.workspacePath &&
          workspacePathComparisonKey(currentDesign.workspacePath) !==
            workspacePathComparisonKey(path)
        ) {
          requestWorkspaceRebind(currentDesign, path);
        } else if (!currentDesign.workspacePath) {
          await window.codesign.snapshots.updateWorkspace(currentDesignId, path, false);
          const updated = await window.codesign.snapshots.listDesigns();
          useCodesignStore.setState({ designs: updated });
        }
      }
    } catch (err) {
      useCodesignStore.getState().pushToast({
        variant: 'error',
        title: t('canvas.workspace.updateFailed'),
        description: err instanceof Error ? err.message : t('errors.unknown'),
      });
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function handleOpenWorkspace() {
    if (!currentDesignId || !window.codesign?.snapshots.openWorkspaceFolder) return;
    if (isCurrentDesignGenerating) {
      useCodesignStore.getState().pushToast({
        variant: 'info',
        title: t('canvas.workspace.busyGenerating'),
      });
      return;
    }
    try {
      setWorkspaceLoading(true);
      await window.codesign.snapshots.openWorkspaceFolder(currentDesignId);
    } catch (err) {
      useCodesignStore.getState().pushToast({
        variant: 'error',
        title: t('canvas.workspace.updateFailed'),
        description: err instanceof Error ? err.message : t('errors.unknown'),
      });
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function handleClearWorkspace() {
    if (!currentDesignId || !window.codesign?.snapshots.updateWorkspace) return;
    if (isCurrentDesignGenerating) {
      useCodesignStore.getState().pushToast({
        variant: 'info',
        title: t('canvas.workspace.busyGenerating'),
      });
      return;
    }
    try {
      setWorkspaceLoading(true);
      await window.codesign.snapshots.updateWorkspace(currentDesignId, null, false);
      const updated = await window.codesign.snapshots.listDesigns();
      useCodesignStore.setState({ designs: updated });
    } catch (err) {
      useCodesignStore.getState().pushToast({
        variant: 'error',
        title: t('canvas.workspace.updateFailed'),
        description: err instanceof Error ? err.message : t('errors.unknown'),
      });
    } finally {
      setWorkspaceLoading(false);
    }
  }

  if (!currentDesignId) {
    return (
      <div className="h-full flex items-center justify-center text-[var(--text-sm)] text-[var(--color-text-muted)]">
        {t('sidebar.noDesign')}
      </div>
    );
  }

  if (loading && files.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-[var(--text-sm)] text-[var(--color-text-muted)]">
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[720px] px-[var(--space-6)] py-[var(--space-8)]">
        <section className="mb-[var(--space-8)]">
          <header className="mb-[var(--space-4)] flex items-center gap-[var(--space-2)]">
            <h2 className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] font-medium m-0">
              {t('canvas.workspace.sectionTitle')}
            </h2>
          </header>

          <div className="space-y-2">
            <div className="flex items-center justify-between px-[var(--space-4)] py-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface)]">
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <span className="text-[var(--text-xs)] text-[var(--color-text-muted)] uppercase tracking-[var(--tracking-label)] font-medium">
                  {t('canvas.workspace.label')}
                </span>
                {workspacePath ? (
                  <>
                    <span
                      className="truncate text-[var(--text-sm)] text-[var(--color-text-primary)] font-mono"
                      title={workspacePath}
                    >
                      {truncatePath(workspacePath)}
                    </span>
                    {folderExists === false && (
                      <span className="text-[var(--text-xs)] text-[var(--color-text-warning,_theme(colors.amber.500))]">
                        {t('canvas.workspace.unavailable')}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-[var(--text-sm)] text-[var(--color-text-muted)]">
                    {t('canvas.workspace.default')}
                  </span>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handlePickWorkspace}
                disabled={workspaceLoading || isCurrentDesignGenerating}
                className="flex-1 h-8 px-3 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Folder className="w-3 h-3 inline mr-1" aria-hidden />
                {workspacePath ? t('canvas.workspace.change') : t('canvas.workspace.choose')}
              </button>

              {workspacePath && (
                <>
                  <button
                    type="button"
                    onClick={handleOpenWorkspace}
                    disabled={workspaceLoading || isCurrentDesignGenerating}
                    className="h-8 px-3 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <FolderOpen className="w-3 h-3" aria-hidden />
                  </button>

                  <button
                    type="button"
                    onClick={handleClearWorkspace}
                    disabled={workspaceLoading || isCurrentDesignGenerating}
                    className="h-8 px-3 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <X className="w-3 h-3" aria-hidden />
                  </button>
                </>
              )}
            </div>
          </div>
        </section>

        <section>
          <header className="mb-[var(--space-4)] flex items-center gap-[var(--space-2)]">
            <h2 className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] font-medium m-0">
              {t('canvas.files.sectionTitle')}
            </h2>
            <span
              className="inline-flex items-center justify-center min-w-[18px] h-[16px] px-[5px] rounded-[var(--radius-sm)] bg-[var(--color-background-secondary)] text-[10px] text-[var(--color-text-muted)]"
              style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}
            >
              {files.length}
            </span>
          </header>

          {files.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-[var(--space-3)] px-[var(--space-6)] text-center py-[var(--space-8)]">
              <div className="w-12 h-12 rounded-full border border-dashed border-[var(--color-border)] flex items-center justify-center">
                <FileCode2
                  className="w-5 h-5 text-[var(--color-text-muted)] opacity-70"
                  aria-hidden
                />
              </div>
              <p className="text-[var(--text-sm)] text-[var(--color-text-muted)] max-w-sm leading-[var(--leading-body)]">
                {t('canvas.files.empty')}
              </p>
            </div>
          ) : (
            <ul className="list-none p-0 m-0 flex flex-col gap-[var(--space-2)]">
              {files.map((f) => (
                <li key={f.path}>
                  <button
                    type="button"
                    onClick={() => openFileTab(f.path)}
                    className="group w-full flex items-center gap-[var(--space-3)] px-[var(--space-4)] h-[52px] text-left rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-[background-color,border-color,transform] duration-[var(--duration-faster)] active:scale-[var(--scale-press-down)]"
                  >
                    <FileCode2
                      className="w-[18px] h-[18px] shrink-0 text-[var(--color-text-secondary)]"
                      aria-hidden
                    />
                    <div className="flex-1 min-w-0 flex flex-col gap-[2px]">
                      <span className="truncate text-[var(--text-sm)] text-[var(--color-text-primary)] font-sans leading-[var(--leading-ui)]">
                        {f.path}
                      </span>
                      <span
                        className="text-[11px] text-[var(--color-text-muted)] leading-[var(--leading-ui)]"
                        title={formatAbsoluteTime(f.updatedAt)}
                        style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}
                      >
                        {formatBytes(f.size)} · {formatRelativeTime(f.updatedAt)}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
