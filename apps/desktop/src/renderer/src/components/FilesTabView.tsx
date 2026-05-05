import { useT } from '@open-codesign/i18n';
import { buildPreviewDocument, isRenderablePath } from '@open-codesign/runtime';
import { DEFAULT_SOURCE_ENTRY, LEGACY_SOURCE_ENTRY } from '@open-codesign/shared';
import { FileCode2, Folder, FolderOpen } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { type DesignFileEntry, type DesignFileKind, useDesignFiles } from '../hooks/useDesignFiles';
import { workspacePathComparisonKey } from '../lib/workspace-path';
import {
  formatIframeError,
  handlePreviewMessage,
  isTrustedPreviewMessageSource,
  stablePreviewSourceKey,
} from '../preview/helpers';
import { LoadingState } from '../preview/LoadingState';
import { readWorkspacePreviewSource } from '../preview/workspace-source';
import { useCodesignStore } from '../store';

export { resolveReferencedWorkspacePreviewPath } from '../preview/workspace-source';

const TweakPanel = lazy(() => import('./TweakPanel').then((m) => ({ default: m.TweakPanel })));

function truncatePath(path: string, maxLength = 40): string {
  if (path.length <= maxLength) return path;
  const start = path.substring(0, maxLength / 2 - 2);
  const end = path.substring(path.length - maxLength / 2 + 2);
  return `${start}…${end}`;
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
            disabled={picking}
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

export function isRenderableDesignFileKind(kind: DesignFileKind | undefined): boolean {
  return kind === 'html' || kind === 'jsx' || kind === 'tsx';
}

export type FilePreviewKind =
  | 'runtime'
  | 'markdown'
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'unsupported';

const UNSUPPORTED_PREVIEW_EXTENSIONS = new Set([
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.rar',
  '.7z',
  '.dmg',
  '.pkg',
  '.app',
  '.exe',
  '.bin',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
]);

function extensionOf(path: string): string {
  const name = path.split('/').pop() ?? path;
  const index = name.lastIndexOf('.');
  return index <= 0 ? '' : name.slice(index).toLowerCase();
}

export function isMainDesignSourcePath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  return normalized === DEFAULT_SOURCE_ENTRY || normalized === LEGACY_SOURCE_ENTRY;
}

export function isMarkdownPreviewFile(path: string, kind: DesignFileKind | undefined): boolean {
  const lower = path.toLowerCase();
  return (
    kind === 'markdown' ||
    kind === 'design-system' ||
    lower.endsWith('.md') ||
    lower.endsWith('.markdown')
  );
}

export function previewKindForFile(
  path: string,
  kind: DesignFileKind | undefined,
): FilePreviewKind {
  if (isRenderableDesignFileKind(kind) || (kind === undefined && isRenderablePath(path))) {
    return 'runtime';
  }
  if (isMarkdownPreviewFile(path, kind)) return 'markdown';
  if (kind === 'image') return 'image';
  if (kind === 'video') return 'video';
  if (kind === 'audio') return 'audio';
  if (kind === 'pdf') return 'pdf';
  if (kind === 'text' || kind === 'css' || kind === 'js') return 'text';
  if (UNSUPPORTED_PREVIEW_EXTENSIONS.has(extensionOf(path))) return 'unsupported';
  return 'text';
}

export function shouldShowTweakPanelForFile(input: {
  path: string;
  previewKind: FilePreviewKind;
  hasPreviewSource: boolean;
}): boolean {
  return (
    input.hasPreviewSource && input.previewKind === 'runtime' && isMainDesignSourcePath(input.path)
  );
}

export function shouldGateUnverifiedGeneratingPreview(input: {
  previewKind: FilePreviewKind;
  currentDesignGenerating: boolean;
  currentSnapshotId: string | null;
}): boolean {
  return (
    input.previewKind === 'runtime' &&
    input.currentDesignGenerating &&
    input.currentSnapshotId === null
  );
}

export function defaultWorkspacePreviewPath(files: DesignFileEntry[]): string | null {
  return (
    files.find((f) => f.path === DEFAULT_SOURCE_ENTRY)?.path ??
    files.find((f) => f.path === LEGACY_SOURCE_ENTRY)?.path ??
    files.find((f) => f.path === 'index.jsx')?.path ??
    files.find((f) => f.path === 'index.tsx')?.path ??
    files.find((f) => isRenderableDesignFileKind(f.kind))?.path ??
    files[0]?.path ??
    null
  );
}

export function workspaceBaseHrefForFile(input: {
  designId: string | null | undefined;
  workspacePath: string | null | undefined;
  filePath: string | null | undefined;
}): string | undefined {
  if (!input.designId || !input.workspacePath) return undefined;
  const normalizedPath = (input.filePath ?? '').replaceAll('\\', '/');
  const slashIndex = normalizedPath.lastIndexOf('/');
  const dir = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex + 1) : '';
  const encodedDir = dir
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join('/');
  return `workspace://${input.designId}/${encodedDir}${encodedDir.length > 0 ? '/' : ''}`;
}

function workspaceUrlForFile(input: {
  designId: string | null | undefined;
  filePath: string | null | undefined;
}): string | undefined {
  if (!input.designId || !input.filePath) return undefined;
  const encodedPath = input.filePath
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join('/');
  if (!encodedPath) return undefined;
  return `workspace://${input.designId}/${encodedPath}`;
}

export type WorkspacePreviewSourceMode =
  | 'read-workspace'
  | 'preview-source-fallback'
  | 'unavailable';

export function chooseWorkspacePreviewSourceMode(input: {
  path: string;
  hasReadApi: boolean;
  hasPreviewSource: boolean;
  preferPreviewSource?: boolean;
}): WorkspacePreviewSourceMode {
  if (
    input.preferPreviewSource === true &&
    input.path === DEFAULT_SOURCE_ENTRY &&
    input.hasPreviewSource
  ) {
    return 'preview-source-fallback';
  }
  if (input.hasReadApi) return 'read-workspace';
  if (input.path === DEFAULT_SOURCE_ENTRY && input.hasPreviewSource)
    return 'preview-source-fallback';
  return 'unavailable';
}

function designFileRevisionKey(file: DesignFileEntry | null | undefined): string | null {
  if (!file) return null;
  return `${file.path}:${file.updatedAt}:${file.size ?? ''}`;
}

export function workspacePreviewDependencyKey(
  files: DesignFileEntry[],
  selectedPath: string,
  sourcePath: string | null | undefined,
): string | null {
  const selected = designFileRevisionKey(files.find((f) => f.path === selectedPath));
  const source =
    sourcePath && sourcePath !== selectedPath
      ? designFileRevisionKey(files.find((f) => f.path === sourcePath))
      : null;
  return [selected, source].filter((part): part is string => part !== null).join('|') || null;
}

interface WorkspaceFilePreviewProps {
  path: string;
  file?: DesignFileEntry | null | undefined;
  files?: DesignFileEntry[] | null | undefined;
}

interface WorkspacePreviewSource {
  content: string;
  path: string;
}

export function workspacePreviewSourceStableKey(source: WorkspacePreviewSource | null): string {
  if (!source) return '';
  return `${source.path}:${stablePreviewSourceKey(source.content)}`;
}

function TextFilePreview({
  content,
  previewKind,
  path,
}: {
  content: string;
  previewKind: FilePreviewKind;
  path: string;
}) {
  return (
    <div className="h-full overflow-auto bg-[var(--color-background)]">
      <div className="mx-auto w-full max-w-[860px] px-[var(--space-8)] py-[var(--space-7)]">
        {previewKind === 'markdown' ? (
          <article className="codesign-prose rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface)] px-[var(--space-6)] py-[var(--space-5)] text-[13px] leading-[var(--leading-body)] text-[var(--color-text-primary)] shadow-[var(--shadow-soft)]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </article>
        ) : (
          <pre
            className="min-h-full overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface)] px-[var(--space-5)] py-[var(--space-4)] text-[12px] leading-[1.65] text-[var(--color-text-primary)] shadow-[var(--shadow-soft)]"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}

function NativeFilePreview({
  kind,
  path,
  url,
}: {
  kind: FilePreviewKind;
  path: string;
  url: string;
}) {
  if (kind === 'image') {
    return (
      <div className="h-full overflow-auto bg-[var(--color-background-secondary)] p-[var(--space-6)]">
        <div className="flex min-h-full items-center justify-center">
          <img
            src={url}
            alt={path}
            className="max-h-full max-w-full rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface)] object-contain shadow-[var(--shadow-soft)]"
          />
        </div>
      </div>
    );
  }
  return (
    <iframe
      title={`file-preview-${path}`}
      src={url}
      className="h-full w-full border-0 bg-[var(--color-surface)]"
    />
  );
}

export function WorkspaceFilePreview({ path, file, files }: WorkspaceFilePreviewProps) {
  const t = useT();
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const designs = useCodesignStore((s) => s.designs);
  const currentPreviewSource = useCodesignStore((s) => s.previewSource);
  const currentSnapshotId = useCodesignStore((s) => s.currentSnapshotId);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const generatingDesignId = useCodesignStore((s) => s.generatingDesignId);
  const interactionMode = useCodesignStore((s) => s.interactionMode);
  const pushIframeError = useCodesignStore((s) => s.pushIframeError);
  const { files: observedFiles } = useDesignFiles(files ? null : currentDesignId);
  const workspaceFiles = files ?? observedFiles;
  const currentDesign = designs.find((d) => d.id === currentDesignId);
  const effectiveFile = file ?? workspaceFiles.find((f) => f.path === path) ?? null;
  const prefersPreviewSource = effectiveFile?.source === 'preview-html';
  const previewKind = previewKindForFile(path, effectiveFile?.kind);
  const renderable = previewKind === 'runtime';
  const currentDesignGenerating =
    currentDesignId !== null && isGenerating && generatingDesignId === currentDesignId;
  const gateUnverifiedPreview = shouldGateUnverifiedGeneratingPreview({
    previewKind,
    currentDesignGenerating,
    currentSnapshotId,
  });
  const textPreview = previewKind === 'markdown' || previewKind === 'text';
  const nativePreview =
    previewKind === 'image' ||
    previewKind === 'video' ||
    previewKind === 'audio' ||
    previewKind === 'pdf';
  const [previewSource, setPreviewSource] = useState<WorkspacePreviewSource | null>(null);
  const showTweakPanel = shouldShowTweakPanelForFile({
    path,
    previewKind,
    hasPreviewSource: previewSource !== null,
  });
  const previewDependencyKey = workspacePreviewDependencyKey(
    workspaceFiles,
    path,
    previewSource?.path,
  );
  const [readError, setReadError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent): void {
      if (!isTrustedPreviewMessageSource(event.source, iframeRef.current?.contentWindow)) return;
      handlePreviewMessage(event.data, {
        onElementSelected: () => {},
        onElementRects: () => {},
        onIframeError: (msg) =>
          pushIframeError(formatIframeError(msg.kind, msg.message, msg.source, msg.lineno)),
      });
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [pushIframeError]);

  useEffect(() => {
    // Re-read when the file watcher reports changed metadata for either the
    // selected file or an HTML placeholder's resolved JSX/TSX source.
    void previewDependencyKey;
    if ((!renderable && !textPreview) || !currentDesignId) {
      setPreviewSource(null);
      setReadError(null);
      return;
    }
    const read = window.codesign?.files?.read;
    const sourceMode = chooseWorkspacePreviewSourceMode({
      path,
      hasReadApi: typeof read === 'function',
      hasPreviewSource: Boolean(currentPreviewSource),
      preferPreviewSource: prefersPreviewSource,
    });
    if (sourceMode === 'preview-source-fallback' && currentPreviewSource) {
      setPreviewSource({ content: currentPreviewSource, path });
      setReadError(null);
      return;
    }
    if (sourceMode === 'unavailable' || !read) {
      setPreviewSource(null);
      setReadError(t('canvas.filesTabEmpty'));
      return;
    }
    let cancelled = false;
    setReadError(null);
    void readWorkspacePreviewSource({ designId: currentDesignId, path, read })
      .then((result) => {
        if (cancelled) return;
        setPreviewSource(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setPreviewSource(null);
        setReadError(err instanceof Error ? err.message : t('errors.unknown'));
      });
    return () => {
      cancelled = true;
    };
  }, [
    currentDesignId,
    previewDependencyKey,
    path,
    currentPreviewSource,
    renderable,
    textPreview,
    t,
    prefersPreviewSource,
  ]);

  const previewSourceStableKey = useMemo(
    () => workspacePreviewSourceStableKey(previewSource),
    [previewSource],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: previewSourceStableKey intentionally masks EDITMODE-only token changes so live tweaks can update via postMessage without rebuilding the iframe.
  const srcDoc = useMemo(() => {
    if (!previewSource || !renderable) return null;
    try {
      const baseHref = workspaceBaseHrefForFile({
        designId: currentDesignId,
        workspacePath: currentDesign?.workspacePath,
        filePath: previewSource.path,
      });
      return buildPreviewDocument(previewSource.content, { path: previewSource.path, baseHref });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `<!doctype html><html><body style="font: 13px system-ui; color: #71717a; display: grid; place-items: center; min-height: 100vh; margin: 0;">${escapeHtmlText(message)}</body></html>`;
    }
  }, [
    currentDesign?.workspacePath,
    currentDesignId,
    previewSource?.path,
    previewSourceStableKey,
    renderable,
  ]);

  if (gateUnverifiedPreview) {
    return <LoadingState />;
  }

  if (nativePreview) {
    const url = workspaceUrlForFile({ designId: currentDesignId, filePath: path });
    if (url) return <NativeFilePreview kind={previewKind} path={path} url={url} />;
  }

  if (previewKind === 'unsupported') {
    return (
      <div className="h-full flex items-center justify-center text-[var(--text-sm)] text-[var(--color-text-muted)]">
        {t('canvas.filesTabEmpty')}
      </div>
    );
  }

  if (!srcDoc) {
    if (previewSource && textPreview) {
      return (
        <TextFilePreview content={previewSource.content} previewKind={previewKind} path={path} />
      );
    }
    return (
      <div className="h-full flex items-center justify-center text-[var(--text-sm)] text-[var(--color-text-muted)]">
        {readError ?? t('canvas.filesTabEmpty')}
      </div>
    );
  }

  return (
    <>
      <iframe
        ref={iframeRef}
        title={`design-preview-${path}`}
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        onLoad={() => {
          const win = iframeRef.current?.contentWindow;
          if (!win) return;
          try {
            win.postMessage({ __codesign: true, type: 'SET_MODE', mode: interactionMode }, '*');
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            pushIframeError(`SET_MODE postMessage failed: ${reason}`);
          }
        }}
        className="w-full h-full bg-white border-0 block"
      />
      {showTweakPanel ? (
        <Suspense fallback={null}>
          <TweakPanel iframeRef={iframeRef} />
        </Suspense>
      ) : null}
    </>
  );
}

export function FilesTabView() {
  const t = useT();
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const openFileTab = useCodesignStore((s) => s.openCanvasFileTab);
  const { files } = useDesignFiles(currentDesignId);

  const defaultPath = useMemo(() => defaultWorkspacePreviewPath(files), [files]);

  const [selectedPath, setSelectedPath] = useState<string | null>(defaultPath);

  useEffect(() => {
    if (!selectedPath || !files.find((f) => f.path === selectedPath)) {
      setSelectedPath(defaultPath);
    }
  }, [defaultPath, files, selectedPath]);

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
          {selectedPath ? (
            <WorkspaceFilePreview path={selectedPath} file={selectedFile} files={files} />
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
