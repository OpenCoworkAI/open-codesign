import { useT } from '@open-codesign/i18n';
import { buildSrcdoc } from '@open-codesign/runtime';
import { FileCode2, Folder, FolderOpen } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDesignFiles } from '../hooks/useDesignFiles';
import { workspacePathComparisonKey } from '../lib/workspace-path';
import { useCodesignStore } from '../store';

function truncatePath(path: string, maxLength = 40): string {
  if (path.length <= maxLength) return path;
  const start = path.substring(0, maxLength / 2 - 2);
  const end = path.substring(path.length - maxLength / 2 + 2);
  return `${start}…${end}`;
}

function WorkspaceSection() {
  const t = useT();
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const designs = useCodesignStore((s) => s.designs);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const generatingDesignId = useCodesignStore((s) => s.generatingDesignId);
  const requestWorkspaceRebind = useCodesignStore((s) => s.requestWorkspaceRebind);
  const [picking, setPicking] = useState(false);
  const [folderExists, setFolderExists] = useState<boolean | null>(null);

  const currentDesign = designs.find((d) => d.id === currentDesignId);
  const workspacePath = currentDesign?.workspacePath ?? null;
  const isCurrentDesignGenerating = isGenerating && generatingDesignId === currentDesignId;
  const disabled = picking || isCurrentDesignGenerating;

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
      useCodesignStore
        .getState()
        .pushToast({ variant: 'info', title: t('canvas.workspace.busyGenerating') });
      return;
    }
    try {
      setPicking(true);
      const path = await window.codesign.snapshots.pickWorkspaceFolder();
      if (path && currentDesign && currentDesignId) {
        if (
          currentDesign.workspacePath &&
          workspacePathComparisonKey(currentDesign.workspacePath) !==
            workspacePathComparisonKey(path)
        ) {
          requestWorkspaceRebind(currentDesign, path);
        } else if (!currentDesign.workspacePath) {
          try {
            await window.codesign.snapshots.updateWorkspace(currentDesignId, path, false);
            const updated = await window.codesign.snapshots.listDesigns();
            useCodesignStore.setState({ designs: updated });
          } catch (err) {
            useCodesignStore.getState().pushToast({
              variant: 'error',
              title: t('canvas.workspace.updateFailed'),
              description: err instanceof Error ? err.message : t('errors.unknown'),
            });
          }
        }
      }
    } finally {
      setPicking(false);
    }
  }

  async function handleOpenWorkspace() {
    if (!currentDesignId || !window.codesign?.snapshots.openWorkspaceFolder) return;
    if (isCurrentDesignGenerating) {
      useCodesignStore
        .getState()
        .pushToast({ variant: 'info', title: t('canvas.workspace.busyGenerating') });
      return;
    }
    try {
      await window.codesign.snapshots.openWorkspaceFolder(currentDesignId);
    } catch (err) {
      useCodesignStore.getState().pushToast({
        variant: 'error',
        title: t('canvas.workspace.updateFailed'),
        description: err instanceof Error ? err.message : t('errors.unknown'),
      });
    }
  }

  return (
    <div className="flex items-center gap-[var(--space-2)] px-[var(--space-4)] py-[var(--space-2)] border-b border-[var(--color-border-muted)] min-w-0">
      <span className="text-[10px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] font-medium shrink-0">
        {t('canvas.workspace.sectionTitle')}
      </span>
      <span
        className="flex-1 min-w-0 truncate text-[10px] text-[var(--color-text-secondary)]"
        title={workspacePath ?? undefined}
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        {workspacePath ? (
          <>
            {truncatePath(workspacePath)}
            {folderExists === false && (
              <span className="ml-1 text-[var(--color-text-warning,_theme(colors.amber.500))]">
                !
              </span>
            )}
          </>
        ) : (
          <span className="text-[var(--color-text-muted)] not-italic">
            {t('canvas.workspace.default')}
          </span>
        )}
      </span>
      <div className="flex items-center gap-[var(--space-1)] shrink-0">
        <button
          type="button"
          onClick={handlePickWorkspace}
          disabled={disabled}
          className="h-6 px-2 rounded-[var(--radius-sm)] text-[10px] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1"
          title={workspacePath ? t('canvas.workspace.change') : t('canvas.workspace.choose')}
        >
          <Folder className="w-3 h-3" aria-hidden />
          {workspacePath ? t('canvas.workspace.change') : t('canvas.workspace.choose')}
        </button>
        {workspacePath && (
          <button
            type="button"
            onClick={handleOpenWorkspace}
            disabled={isCurrentDesignGenerating}
            className="h-6 px-2 rounded-[var(--radius-sm)] text-[10px] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={t('canvas.workspace.open')}
          >
            <FolderOpen className="w-3 h-3" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

function formatBytes(n: number | undefined): string {
  if (n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function FilesTabView() {
  const t = useT();
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const previewHtml = useCodesignStore((s) => s.previewHtml);
  const openFileTab = useCodesignStore((s) => s.openCanvasFileTab);
  const interactionMode = useCodesignStore((s) => s.interactionMode);
  const pushIframeError = useCodesignStore((s) => s.pushIframeError);
  const { files } = useDesignFiles(currentDesignId);

  const defaultPath = useMemo(() => {
    if (files.find((f) => f.path === 'index.html')) return 'index.html';
    return files[0]?.path ?? null;
  }, [files]);

  const [selectedPath, setSelectedPath] = useState<string | null>(defaultPath);

  useEffect(() => {
    if (!selectedPath || !files.find((f) => f.path === selectedPath)) {
      setSelectedPath(defaultPath);
    }
  }, [defaultPath, files, selectedPath]);

  const selectedSource = selectedPath === 'index.html' ? previewHtml : null;
  const srcDoc = useMemo(
    () => (selectedSource ? buildSrcdoc(selectedSource) : null),
    [selectedSource],
  );

  const iframeRef = useRef<HTMLIFrameElement>(null);

  if (files.length === 0) {
    return (
      <div className="flex h-full min-h-0">
        <aside className="w-[35%] shrink-0 border-r border-[var(--color-border-muted)] bg-[var(--color-background)] overflow-y-auto flex flex-col">
          <WorkspaceSection />
          <div className="flex-1 flex items-center justify-center text-[var(--text-sm)] text-[var(--color-text-muted)] px-[var(--space-6)]">
            {t('canvas.filesTabEmpty')}
          </div>
        </aside>
        <div className="flex-1 min-w-0 h-full bg-[var(--color-background-secondary)] flex items-center justify-center text-[var(--text-sm)] text-[var(--color-text-muted)]">
          {t('canvas.filesTabEmpty')}
        </div>
      </div>
    );
  }

  const selectedFile = selectedPath ? (files.find((f) => f.path === selectedPath) ?? null) : null;

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-[35%] shrink-0 border-r border-[var(--color-border-muted)] bg-[var(--color-background)] overflow-y-auto flex flex-col">
        <WorkspaceSection />
        <div className="px-[var(--space-6)] py-[var(--space-6)]">
          <div className="mb-[var(--space-4)] flex items-center gap-[var(--space-2)]">
            <h2 className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] font-medium m-0">
              {t('canvas.files.sectionTitle')}
            </h2>
            <span
              className="inline-flex items-center justify-center min-w-[18px] h-[16px] px-[5px] rounded-[var(--radius-sm)] bg-[var(--color-background-secondary)] text-[10px] text-[var(--color-text-muted)]"
              style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}
            >
              {files.length}
            </span>
          </div>

          <ul className="list-none p-0 m-0 flex flex-col gap-[var(--space-1)]">
            {files.map((f) => {
              const isActive = f.path === selectedPath;
              const segments = f.path.split('/');
              const name = segments[segments.length - 1] ?? f.path;
              return (
                <li key={f.path} className="relative">
                  {isActive ? (
                    <span
                      aria-hidden
                      className="absolute left-0 top-[6px] bottom-[6px] w-[2px] bg-[var(--color-accent)] rounded-r-full"
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setSelectedPath(f.path)}
                    onDoubleClick={() => openFileTab(f.path)}
                    title={f.path}
                    className={`group w-full flex items-center gap-[var(--space-3)] h-[44px] pl-[var(--space-4)] pr-[var(--space-3)] text-left rounded-[var(--radius-md)] transition-colors duration-[var(--duration-faster)] ${
                      isActive
                        ? 'bg-[var(--color-surface-active)] text-[var(--color-text-primary)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
                    }`}
                  >
                    <FileCode2
                      className={`w-[16px] h-[16px] shrink-0 ${
                        isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'
                      }`}
                      aria-hidden
                    />
                    <span className="flex-1 min-w-0 flex flex-col gap-[1px]">
                      <span
                        className="truncate text-[var(--text-sm)] leading-[var(--leading-ui)]"
                        style={{ fontFamily: 'var(--font-mono)' }}
                      >
                        {name}
                      </span>
                      <span
                        className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-[var(--tracking-label)]"
                        style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}
                      >
                        {formatBytes(f.size)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <p className="mt-[var(--space-6)] text-[11px] text-[var(--color-text-muted)] leading-[var(--leading-body)]">
            {t('canvas.previewHint')}
          </p>
        </div>
      </aside>
      <div className="flex-1 min-w-0 h-full bg-[var(--color-background-secondary)] flex flex-col min-h-0">
        <div className="shrink-0 h-[36px] px-[var(--space-4)] flex items-center justify-between gap-[var(--space-3)] border-b border-[var(--color-border-muted)] bg-[var(--color-background)]">
          <span
            className="truncate text-[12px] text-[var(--color-text-secondary)]"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {selectedFile?.path ?? selectedPath ?? ''}
          </span>
          <button
            type="button"
            onClick={() => selectedPath && openFileTab(selectedPath)}
            className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
          >
            {t('canvas.openInTab')}
          </button>
        </div>
        <div className="flex-1 min-h-0 bg-[var(--color-background-secondary)]">
          {srcDoc ? (
            <iframe
              ref={iframeRef}
              title={`design-preview-${selectedPath ?? ''}`}
              sandbox="allow-scripts"
              srcDoc={srcDoc}
              onLoad={() => {
                const win = iframeRef.current?.contentWindow;
                if (!win) return;
                try {
                  win.postMessage(
                    { __codesign: true, type: 'SET_MODE', mode: interactionMode },
                    '*',
                  );
                } catch (err) {
                  const reason = err instanceof Error ? err.message : String(err);
                  pushIframeError(`SET_MODE postMessage failed: ${reason}`);
                }
              }}
              className="w-full h-full bg-white border-0 block"
            />
          ) : (
            <div className="h-full flex items-center justify-center text-[var(--text-sm)] text-[var(--color-text-muted)]">
              {t('canvas.filesTabEmpty')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
