import { useT } from '@open-codesign/i18n';
import { ChevronRight, FileCode2, Folder, FolderOpen, Plus } from 'lucide-react';
import { type DragEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import {
  formatAbsoluteTime,
  formatRelativeTime,
  useLazyDesignFileTree,
} from '../hooks/useDesignFiles';
import {
  clipboardFilesToWorkspaceBlobs,
  dataTransferFilesToWorkspaceFiles,
} from '../lib/file-ingest';
import type { FileTreeNode } from '../lib/file-tree';
import { workspacePathComparisonKey } from '../lib/workspace-path';
import { useCodesignStore } from '../store';

export { buildFileTree } from '../lib/file-tree';

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
  const importFilesToWorkspace = useCodesignStore((s) => s.importFilesToWorkspace);
  const addImportedFileToPrompt = useCodesignStore((s) => s.useImportedFileInPrompt);
  const requestWorkspaceRebind = useCodesignStore((s) => s.requestWorkspaceRebind);
  const { files, tree: fileTree, loading, loadDirectory } = useLazyDesignFileTree(currentDesignId);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [folderExists, setFolderExists] = useState<boolean | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const expandedDesignRef = useRef<string | null>(currentDesignId);

  const currentDesign = designs.find((d) => d.id === currentDesignId);
  const workspacePath = currentDesign?.workspacePath ?? null;
  const isCurrentDesignGenerating = isGenerating && generatingDesignId === currentDesignId;

  useEffect(() => {
    if (expandedDesignRef.current === currentDesignId) return;
    expandedDesignRef.current = currentDesignId;
    setExpandedDirs(new Set());
  }, [currentDesignId]);

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

  async function handleDrop(e: DragEvent<HTMLDivElement>): Promise<void> {
    if (!workspacePath || isCurrentDesignGenerating) return;
    const files = dataTransferFilesToWorkspaceFiles(e.dataTransfer);
    const blobs = files.length === 0 ? await clipboardFilesToWorkspaceBlobs(e.dataTransfer) : null;
    if (files.length === 0 && (!blobs || (blobs.files.length === 0 && blobs.blobs.length === 0)))
      return;
    e.preventDefault();
    const input = {
      source: 'workspace',
      attach: false,
      ...(files.length > 0 ? { files } : {}),
      ...(files.length === 0 && blobs?.files.length ? { files: blobs.files } : {}),
      ...(blobs?.blobs.length ? { blobs: blobs.blobs } : {}),
    } as const;
    await importFilesToWorkspace(input);
  }

  function toggleDirectory(node: FileTreeNode) {
    if (node.type !== 'directory') return;
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(node.path)) {
        next.delete(node.path);
      } else {
        next.add(node.path);
        if (!node.loaded && !node.loading) void loadDirectory(node.path);
      }
      return next;
    });
  }

  function renderTreeNode(node: FileTreeNode, depth: number): ReactNode {
    if (node.type === 'directory') {
      const isExpanded = expandedDirs.has(node.path);
      return (
        <li key={node.path}>
          <button
            type="button"
            onClick={() => toggleDirectory(node)}
            aria-expanded={isExpanded}
            className="group flex h-9 w-full min-w-0 items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] px-[var(--space-2)] text-left text-[var(--text-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            style={{ paddingLeft: `calc(var(--space-2) + ${depth * 16}px)` }}
          >
            <ChevronRight
              className={`size-3.5 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              aria-hidden
            />
            {isExpanded ? (
              <FolderOpen className="size-4 shrink-0" aria-hidden />
            ) : (
              <Folder className="size-4 shrink-0" aria-hidden />
            )}
            <span className="min-w-0 flex-1 truncate font-medium" title={node.path}>
              {node.name}
            </span>
            <span
              className="shrink-0 text-[10px] text-[var(--color-text-muted)]"
              style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}
            >
              {node.fileCount ?? ''}
            </span>
          </button>
          {isExpanded && node.loading && (
            <div
              className="h-8 px-[var(--space-2)] text-[var(--text-xs)] text-[var(--color-text-muted)] flex items-center"
              style={{ paddingLeft: `calc(var(--space-2) + ${(depth + 1) * 16 + 20}px)` }}
            >
              {t('common.loading')}
            </div>
          )}
          {isExpanded && node.children.length > 0 && (
            <ul className="list-none p-0 m-0">
              {node.children.map((child) => renderTreeNode(child, depth + 1))}
            </ul>
          )}
        </li>
      );
    }

    const f = node.file;
    return (
      <li key={node.path}>
        <div className="group flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-hover)] transition-[background-color] duration-[var(--duration-faster)]">
          <button
            type="button"
            onClick={() => openFileTab(f.path)}
            className="flex min-w-0 flex-1 items-center gap-[var(--space-2)] h-9 pr-[var(--space-2)] text-left"
            style={{ paddingLeft: `calc(var(--space-2) + ${depth * 16 + 20}px)` }}
          >
            <FileCode2 className="size-4 shrink-0 text-[var(--color-text-secondary)]" aria-hidden />
            <span
              className="min-w-0 flex-1 truncate text-[var(--text-sm)] text-[var(--color-text-primary)] leading-[var(--leading-ui)]"
              title={f.path}
            >
              {node.name}
            </span>
            <span
              className="hidden shrink-0 text-[10px] text-[var(--color-text-muted)] sm:inline"
              title={formatAbsoluteTime(f.updatedAt)}
              style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}
            >
              {formatBytes(f.size)} - {formatRelativeTime(f.updatedAt)}
            </span>
          </button>
          <button
            type="button"
            onClick={() => addImportedFileToPrompt(f.path)}
            title="Use in next prompt"
            className="mr-[var(--space-1)] inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-active)] hover:text-[var(--color-text-primary)]"
          >
            <Plus className="size-4" aria-hidden />
            <span className="sr-only">Use in next prompt</span>
          </button>
        </div>
      </li>
    );
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
    <div
      className="h-full overflow-y-auto"
      onDrop={(e) => void handleDrop(e)}
      onDragOver={(e) => e.preventDefault()}
    >
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
                <button
                  type="button"
                  onClick={handleOpenWorkspace}
                  disabled={workspaceLoading}
                  className="h-8 px-3 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title={t('canvas.workspace.open')}
                >
                  <FolderOpen className="w-3 h-3" aria-hidden />
                </button>
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

          {files.length === 0 && fileTree.length === 0 ? (
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
          ) : fileTree.length > 0 ? (
            <ul className="list-none p-0 m-0 rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface)] py-[var(--space-1)]">
              {fileTree.map((node) => renderTreeNode(node, 0))}
            </ul>
          ) : (
            <ul className="list-none p-0 m-0 flex flex-col gap-[var(--space-2)]">
              {files.map((f) => (
                <li key={f.path}>
                  <div className="group flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-[background-color,border-color] duration-[var(--duration-faster)]">
                    <button
                      type="button"
                      onClick={() => openFileTab(f.path)}
                      className="flex min-w-0 flex-1 items-center gap-[var(--space-3)] px-[var(--space-4)] h-[52px] text-left"
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
                          {formatBytes(f.size)} - {formatRelativeTime(f.updatedAt)}
                        </span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => addImportedFileToPrompt(f.path)}
                      title="Use in next prompt"
                      className="mr-[var(--space-2)] inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                    >
                      <Plus className="size-4" aria-hidden />
                      <span className="sr-only">Use in next prompt</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
