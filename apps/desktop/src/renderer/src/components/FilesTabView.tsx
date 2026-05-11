import { useT } from '@open-codesign/i18n';
import { buildPreviewDocument, isRenderablePath } from '@open-codesign/runtime';
import { DEFAULT_SOURCE_ENTRY, LEGACY_SOURCE_ENTRY, type PreviewMode } from '@open-codesign/shared';
import {
  ChevronRight,
  ExternalLink,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  Globe2,
  RefreshCw,
} from 'lucide-react';
import {
  type ChangeEvent,
  type KeyboardEvent,
  lazy,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { PreviewDetectResult, WorkspaceDocumentPreviewResult } from '../../../preload';
import {
  type DesignFileEntry,
  type DesignFileKind,
  type DesignFileSource,
  useDesignFiles,
  useLazyDesignFileTree,
} from '../hooks/useDesignFiles';
import type { FileTreeNode } from '../lib/file-tree';
import { workspacePathComparisonKey } from '../lib/workspace-path';
import {
  formatIframeError,
  handlePreviewMessage,
  isTrustedPreviewMessageSource,
  type PreviewMessageHandlers,
  postModeToPreviewWindow,
  scaleRectForZoom,
  stablePreviewSourceKey,
} from '../preview/helpers';
import {
  readWorkspacePreviewSource,
  resolveDesignPreviewSource,
} from '../preview/workspace-source';
import { useCodesignStore } from '../store';

export { resolveReferencedWorkspacePreviewPath } from '../preview/workspace-source';

const TweakPanel = lazy(() => import('./TweakPanel').then((m) => ({ default: m.TweakPanel })));

const FILE_BROWSER_WIDTH_STORAGE_KEY = 'open-codesign:file-browser-width';
const FILE_BROWSER_DEFAULT_WIDTH = 360;
const FILE_BROWSER_MIN_WIDTH = 260;
const FILE_BROWSER_MAX_WIDTH = 720;

export function clampFileBrowserWidth(width: number, viewportWidth = 1280): number {
  const maxWidth = Math.max(
    FILE_BROWSER_MIN_WIDTH,
    Math.min(FILE_BROWSER_MAX_WIDTH, Math.round(viewportWidth * 0.55)),
  );
  return Math.min(Math.max(Math.round(width), FILE_BROWSER_MIN_WIDTH), maxWidth);
}

function initialFileBrowserWidth(): number {
  if (typeof window === 'undefined') return FILE_BROWSER_DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(FILE_BROWSER_WIDTH_STORAGE_KEY);
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return clampFileBrowserWidth(
      Number.isFinite(parsed) ? parsed : FILE_BROWSER_DEFAULT_WIDTH,
      window.innerWidth,
    );
  } catch {
    return clampFileBrowserWidth(FILE_BROWSER_DEFAULT_WIDTH, window.innerWidth);
  }
}

function truncatePath(path: string, maxLength = 40): string {
  if (path.length <= maxLength) return path;
  const start = path.substring(0, maxLength / 2 - 2);
  const end = path.substring(path.length - maxLength / 2 + 2);
  return `${start}…${end}`;
}

const APP_WORKSPACE_ROOT_FILES = new Set([
  'angular.json',
  'astro.config.cjs',
  'astro.config.js',
  'astro.config.mjs',
  'astro.config.ts',
  'next.config.cjs',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'nuxt.config.js',
  'nuxt.config.mjs',
  'nuxt.config.ts',
  'parcel.config.js',
  'remix.config.js',
  'remix.config.ts',
  'svelte.config.js',
  'svelte.config.ts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.ts',
  'webpack.config.js',
  'webpack.config.ts',
]);

export function normalizeConnectedPreviewUrlInput(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const withScheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function looksLikeApplicationWorkspace(files: DesignFileEntry[]): boolean {
  return files.some((file) => {
    const normalized = file.path.replaceAll('\\', '/').toLowerCase();
    if (normalized.includes('/')) return false;
    return APP_WORKSPACE_ROOT_FILES.has(normalized);
  });
}

export function effectivePreviewModeForDesign(input: {
  previewMode?: PreviewMode | null | undefined;
  previewUrl?: string | null | undefined;
  files: DesignFileEntry[];
}): PreviewMode {
  const integratedBlocked = looksLikeApplicationWorkspace(input.files);
  if (integratedBlocked && input.previewMode === 'managed-file') return 'none';
  if (input.previewMode) return input.previewMode;
  if (input.previewUrl && input.previewUrl.trim().length > 0) return 'connected-url';
  if (integratedBlocked) return 'none';
  return 'managed-file';
}

const WORKSPACE_MODULE_SCRIPT_RE = /<script\b([^>]*)>/gi;
const MODULE_SCRIPT_TYPE_RE = /\btype\s*=\s*["']module["']/i;
const SCRIPT_SRC_RE = /\bsrc\s*=\s*["']([^"']+)["']/i;

export function htmlRequiresWorkspaceDevServer(source: string): boolean {
  for (const match of source.matchAll(WORKSPACE_MODULE_SCRIPT_RE)) {
    const attributes = match[1] ?? '';
    if (!MODULE_SCRIPT_TYPE_RE.test(attributes)) continue;
    const src = SCRIPT_SRC_RE.exec(attributes)?.[1]?.trim();
    if (!src) continue;
    const normalized = src.replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase();
    if (normalized.startsWith('/src/') || normalized.startsWith('src/')) return true;
  }
  return false;
}

function previewModeLabelKey(mode: PreviewMode): string {
  if (mode === 'connected-url') return 'canvas.workspace.preview.mode.connectedUrlShort';
  if (mode === 'external-app') return 'canvas.workspace.preview.mode.externalAppShort';
  if (mode === 'none') return 'canvas.workspace.preview.mode.offShort';
  return 'canvas.workspace.preview.mode.integratedShort';
}

export function previewModeSummary(input: {
  mode: PreviewMode;
  previewUrl?: string | null | undefined;
  integratedPreviewBlocked?: boolean;
}): { key: string; options?: Record<string, string> } {
  if (input.mode === 'connected-url') {
    const url = input.previewUrl?.trim();
    return url
      ? { key: 'canvas.workspace.preview.summary.connected', options: { url } }
      : { key: 'canvas.workspace.preview.summary.waitingUrl' };
  }
  if (input.mode === 'external-app') {
    const url = input.previewUrl?.trim();
    return url
      ? { key: 'canvas.workspace.preview.summary.externalWithUrl', options: { url } }
      : { key: 'canvas.workspace.preview.summary.external' };
  }
  if (input.mode === 'none') {
    return input.integratedPreviewBlocked
      ? { key: 'canvas.workspace.preview.summary.integratedBlocked' }
      : { key: 'canvas.workspace.preview.summary.off' };
  }
  return { key: 'canvas.workspace.preview.summary.integrated' };
}

export function detectedPreviewTarget(
  result: PreviewDetectResult,
): { mode: 'connected-url' | 'external-app'; url: string } | null {
  const nativeCandidate = result.candidates.find(
    (candidate) => candidate.status === 'native-runtime-required',
  );
  if (nativeCandidate) return { mode: 'external-app', url: nativeCandidate.url };
  if (result.found && result.url) return { mode: 'connected-url', url: result.url };
  return null;
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function WorkspaceSection({ files }: { files: DesignFileEntry[] }) {
  const t = useT();
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const designs = useCodesignStore((s) => s.designs);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const generatingDesignId = useCodesignStore((s) => s.generatingDesignId);
  const requestWorkspaceRebind = useCodesignStore((s) => s.requestWorkspaceRebind);
  const [picking, setPicking] = useState(false);
  const [folderExists, setFolderExists] = useState<boolean | null>(null);
  const [previewModeInput, setPreviewModeInput] = useState<PreviewMode>('managed-file');
  const [previewUrlInput, setPreviewUrlInput] = useState('');
  const [savingPreview, setSavingPreview] = useState(false);
  const [detectingPreview, setDetectingPreview] = useState(false);
  const [detectResult, setDetectResult] = useState<PreviewDetectResult | null>(null);
  const [previewOptionsOpen, setPreviewOptionsOpen] = useState(false);
  const autoDetectDesignRef = useRef<string | null>(null);

  const currentDesign = designs.find((d) => d.id === currentDesignId);
  const workspacePath = currentDesign?.workspacePath ?? null;
  const isCurrentDesignGenerating = isGenerating && generatingDesignId === currentDesignId;
  const disabled = picking || isCurrentDesignGenerating;
  const integratedPreviewBlocked = looksLikeApplicationWorkspace(files);
  const savedPreviewMode = currentDesign?.previewMode ?? null;
  const savedPreviewUrl = currentDesign?.previewUrl ?? '';
  const effectivePreviewMode = effectivePreviewModeForDesign({
    previewMode: savedPreviewMode,
    previewUrl: savedPreviewUrl,
    files,
  });
  const previewSummary = previewModeSummary({
    mode: effectivePreviewMode,
    previewUrl: savedPreviewUrl,
    integratedPreviewBlocked,
  });
  const previewSummaryText = t(previewSummary.key, previewSummary.options);
  const previewConfigured = Boolean(savedPreviewMode || savedPreviewUrl);
  const previewNeedsUrl =
    previewModeInput === 'connected-url' || previewModeInput === 'external-app';
  const normalizedPreviewUrl = normalizeConnectedPreviewUrlInput(previewUrlInput);
  const previewUrlInvalid =
    previewNeedsUrl && previewUrlInput.trim().length > 0 && !normalizedPreviewUrl;

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

  useEffect(() => {
    setPreviewModeInput(effectivePreviewMode);
    setPreviewUrlInput(savedPreviewUrl);
    setDetectResult(null);
  }, [effectivePreviewMode, savedPreviewUrl]);

  const refreshDesigns = useCallback(async () => {
    const updated = await window.codesign?.snapshots.listDesigns?.();
    if (updated) useCodesignStore.setState({ designs: updated });
  }, []);

  const savePreviewMode = useCallback(
    async (mode: PreviewMode, rawUrl = previewUrlInput, options: { quiet?: boolean } = {}) => {
      if (!currentDesignId || !window.codesign?.snapshots.updatePreview) return;
      const trimmedUrl = rawUrl.trim();
      const normalizedUrl =
        mode === 'connected-url' || mode === 'external-app'
          ? normalizeConnectedPreviewUrlInput(trimmedUrl)
          : null;
      if (mode === 'connected-url' && normalizedUrl === null) {
        if (!options.quiet) {
          useCodesignStore.getState().pushToast({
            variant: 'error',
            title: t('canvas.workspace.preview.saveFailed'),
            description: t('canvas.workspace.preview.urlRequired'),
          });
        }
        return;
      }
      if (mode === 'external-app' && trimmedUrl.length > 0 && normalizedUrl === null) {
        if (!options.quiet) {
          useCodesignStore.getState().pushToast({
            variant: 'error',
            title: t('canvas.workspace.preview.saveFailed'),
            description: t('canvas.workspace.preview.urlInvalid'),
          });
        }
        return;
      }
      try {
        setSavingPreview(true);
        await window.codesign.snapshots.updatePreview(currentDesignId, mode, normalizedUrl);
        await refreshDesigns();
      } catch (err) {
        if (!options.quiet) {
          useCodesignStore.getState().pushToast({
            variant: 'error',
            title: t('canvas.workspace.preview.saveFailed'),
            description: err instanceof Error ? err.message : t('errors.unknown'),
          });
        }
      } finally {
        setSavingPreview(false);
      }
    },
    [currentDesignId, previewUrlInput, refreshDesigns, t],
  );

  async function handlePreviewModeChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextMode = event.currentTarget.value as PreviewMode;
    const safeMode = nextMode === 'managed-file' && integratedPreviewBlocked ? 'none' : nextMode;
    setPreviewModeInput(safeMode);
    setDetectResult(null);
    if (safeMode === 'connected-url' && !normalizeConnectedPreviewUrlInput(previewUrlInput)) return;
    await savePreviewMode(safeMode, previewUrlInput);
  }

  async function handlePreviewUrlApply() {
    await savePreviewMode(previewModeInput, previewUrlInput);
  }

  async function handlePreviewUrlKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.currentTarget.blur();
    await handlePreviewUrlApply();
  }

  const handleDetectPreview = useCallback(
    async (options: { quiet?: boolean } = {}) => {
      if (!currentDesignId || !window.codesign?.snapshots.detectPreview) return;
      try {
        setDetectingPreview(true);
        if (!options.quiet) setDetectResult(null);
        const result = await window.codesign.snapshots.detectPreview(currentDesignId);
        if (!options.quiet) setDetectResult(result);
        const target = detectedPreviewTarget(result);
        if (target) {
          setPreviewModeInput(target.mode);
          setPreviewUrlInput(target.url);
          await savePreviewMode(target.mode, target.url, { quiet: options.quiet === true });
          return;
        }
        if (!options.quiet) {
          useCodesignStore.getState().pushToast({
            variant: 'info',
            title: t('canvas.workspace.preview.detectNone'),
            description: result.message,
          });
        }
      } catch (err) {
        if (!options.quiet) {
          useCodesignStore.getState().pushToast({
            variant: 'error',
            title: t('canvas.workspace.preview.detectFailed'),
            description: err instanceof Error ? err.message : t('errors.unknown'),
          });
        }
      } finally {
        setDetectingPreview(false);
      }
    },
    [currentDesignId, savePreviewMode, t],
  );

  useEffect(() => {
    if (!currentDesignId) return;
    if (!integratedPreviewBlocked) return;
    if (savedPreviewMode || savedPreviewUrl) return;
    if (autoDetectDesignRef.current === currentDesignId) return;
    autoDetectDesignRef.current = currentDesignId;
    void handleDetectPreview({ quiet: true });
  }, [
    currentDesignId,
    handleDetectPreview,
    integratedPreviewBlocked,
    savedPreviewMode,
    savedPreviewUrl,
  ]);

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
    <div className="border-b border-[var(--color-border-muted)] px-[var(--space-4)] py-[var(--space-3)]">
      <div className="flex min-w-0 items-center gap-[var(--space-2)]">
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)]">
          {t('canvas.workspace.sectionTitle')}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[10px] text-[var(--color-text-secondary)]"
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
        <div className="flex shrink-0 items-center gap-[var(--space-1)]">
          <button
            type="button"
            onClick={handlePickWorkspace}
            disabled={disabled}
            className="inline-flex h-6 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 text-[10px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            title={workspacePath ? t('canvas.workspace.change') : t('canvas.workspace.choose')}
          >
            <Folder className="h-3 w-3" aria-hidden />
            {workspacePath ? t('canvas.workspace.change') : t('canvas.workspace.choose')}
          </button>
          {workspacePath && (
            <button
              type="button"
              onClick={handleOpenWorkspace}
              disabled={picking}
              className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[10px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              title={t('canvas.workspace.open')}
            >
              <FolderOpen className="h-3 w-3" aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div className="mt-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-raised)]">
        <div className="flex min-w-0 items-center gap-[var(--space-2)] p-[var(--space-2)]">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-muted)] text-[var(--color-text-muted)]">
            <Globe2 className="h-3.5 w-3.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-[var(--space-1)]">
              <span className="text-[10px] font-medium uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)]">
                {t('canvas.workspace.preview.label')}
              </span>
              <span className="rounded-[var(--radius-pill)] border border-[var(--color-border-muted)] px-1.5 py-0.5 text-[9px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-secondary)]">
                {previewConfigured
                  ? t('canvas.workspace.preview.status.saved')
                  : t('canvas.workspace.preview.status.auto')}
                : {t(previewModeLabelKey(effectivePreviewMode))}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleDetectPreview()}
            disabled={disabled || savingPreview || detectingPreview || !workspacePath}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 text-[10px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            title={t('canvas.workspace.preview.detect')}
          >
            <RefreshCw
              className={`h-3 w-3 ${detectingPreview ? 'animate-spin' : ''}`}
              aria-hidden
            />
            {t('canvas.workspace.preview.detect')}
          </button>
          <button
            type="button"
            onClick={() => setPreviewOptionsOpen((open) => !open)}
            aria-expanded={previewOptionsOpen}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
            title={
              previewOptionsOpen
                ? t('canvas.workspace.preview.actions.hideOptions')
                : t('canvas.workspace.preview.actions.showOptions')
            }
          >
            <ChevronRight
              className={`h-3.5 w-3.5 transition-transform ${previewOptionsOpen ? 'rotate-90' : ''}`}
              aria-hidden
            />
          </button>
        </div>
        {previewOptionsOpen ? (
          <div className="border-t border-[var(--color-border-muted)] p-[var(--space-2)]">
            <div className="grid gap-[var(--space-2)]">
              <p
                className="m-0 text-[10px] leading-[var(--leading-body)] text-[var(--color-text-muted)]"
                title={detectResult?.message ?? previewSummaryText}
              >
                {detectingPreview
                  ? t('canvas.workspace.preview.summary.detecting')
                  : (detectResult?.message ?? previewSummaryText)}
              </p>
              <label className="grid gap-1 text-[10px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)]">
                {t('canvas.workspace.preview.mode.label')}
                <select
                  value={previewModeInput}
                  onChange={handlePreviewModeChange}
                  disabled={disabled || savingPreview}
                  className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-[11px] normal-case tracking-normal text-[var(--color-text-secondary)] outline-none transition-colors focus:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                  title={t(previewModeLabelKey(effectivePreviewMode))}
                >
                  <option value="managed-file" disabled={integratedPreviewBlocked}>
                    {t('canvas.workspace.preview.mode.integrated')}
                  </option>
                  <option value="connected-url">
                    {t('canvas.workspace.preview.mode.connectedUrl')}
                  </option>
                  <option value="external-app">
                    {t('canvas.workspace.preview.mode.externalApp')}
                  </option>
                  <option value="none">{t('canvas.workspace.preview.mode.off')}</option>
                </select>
              </label>
              {previewNeedsUrl ? (
                <label className="grid gap-1 text-[10px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)]">
                  {t('canvas.workspace.preview.urlLabel')}
                  <div className="flex min-w-0 items-center gap-[var(--space-1)]">
                    <input
                      value={previewUrlInput}
                      onChange={(event) => setPreviewUrlInput(event.currentTarget.value)}
                      onBlur={() => {
                        if (previewModeInput === 'external-app' || normalizedPreviewUrl) {
                          void handlePreviewUrlApply();
                        }
                      }}
                      onKeyDown={handlePreviewUrlKeyDown}
                      placeholder={t('canvas.workspace.preview.urlPlaceholder')}
                      disabled={disabled || savingPreview}
                      className={`h-8 min-w-0 flex-1 rounded-[var(--radius-sm)] border bg-[var(--color-background)] px-2 text-[11px] normal-case tracking-normal text-[var(--color-text-secondary)] outline-none transition-colors focus:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50 ${
                        previewUrlInvalid
                          ? 'border-[var(--color-danger)]'
                          : 'border-[var(--color-border)]'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={handlePreviewUrlApply}
                      disabled={disabled || savingPreview || previewUrlInvalid}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                      title={t('canvas.workspace.preview.apply')}
                    >
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                </label>
              ) : null}
              <p className="m-0 text-[10px] leading-[var(--leading-body)] text-[var(--color-text-muted)]">
                {integratedPreviewBlocked
                  ? t('canvas.workspace.preview.hint.appWorkspace')
                  : t('canvas.workspace.preview.hint.simpleWorkspace')}
              </p>
            </div>
          </div>
        ) : null}
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
  | 'document'
  | 'unsupported';

const DOCUMENT_PREVIEW_EXTENSIONS = new Set([
  '.doc',
  '.docx',
  '.key',
  '.numbers',
  '.pages',
  '.ppt',
  '.pptx',
  '.rtf',
  '.xls',
  '.xlsx',
]);

const TEXT_PREVIEW_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.csv',
  '.html',
  '.htm',
  '.js',
  '.json',
  '.jsx',
  '.log',
  '.md',
  '.markdown',
  '.mjs',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

const TEXT_PREVIEW_BASENAMES = new Set([
  '.env',
  '.gitattributes',
  '.gitignore',
  '.npmrc',
  '.nvmrc',
  'dockerfile',
  'license',
  'makefile',
  'notice',
  'readme',
]);

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

function basenameOf(path: string): string {
  return (path.split('/').pop() ?? path).toLowerCase();
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
  const ext = extensionOf(path);
  if (kind === 'document' || DOCUMENT_PREVIEW_EXTENSIONS.has(ext)) return 'document';
  if (isRenderableDesignFileKind(kind) || (kind === undefined && isRenderablePath(path))) {
    return 'runtime';
  }
  if (isMarkdownPreviewFile(path, kind)) return 'markdown';
  if (kind === 'image') return 'image';
  if (kind === 'video') return 'video';
  if (kind === 'audio') return 'audio';
  if (kind === 'pdf') return 'pdf';
  if (
    kind === 'text' ||
    kind === 'css' ||
    kind === 'js' ||
    TEXT_PREVIEW_EXTENSIONS.has(ext) ||
    TEXT_PREVIEW_BASENAMES.has(basenameOf(path))
  ) {
    return 'text';
  }
  if (UNSUPPORTED_PREVIEW_EXTENSIONS.has(ext)) return 'unsupported';
  return 'unsupported';
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

export function shouldUseDesignPreviewResolverForFile(input: {
  path: string;
  previewKind: FilePreviewKind;
  source?: DesignFileSource | undefined;
}): boolean {
  return (
    input.previewKind === 'runtime' &&
    isMainDesignSourcePath(input.path) &&
    input.source === 'preview-html'
  );
}

export function defaultWorkspacePreviewPath(files: DesignFileEntry[]): string | null {
  return (
    files.find((f) => f.path === DEFAULT_SOURCE_ENTRY)?.path ??
    files.find((f) => f.path === LEGACY_SOURCE_ENTRY)?.path ??
    files.find((f) => f.path === 'index.jsx')?.path ??
    files.find((f) => f.path === 'index.tsx')?.path ??
    files.find((f) => isRenderableDesignFileKind(f.kind))?.path ??
    files.find((f) => isMarkdownPreviewFile(f.path, f.kind))?.path ??
    files.find((f) => f.kind === 'document')?.path ??
    files.find((f) => f.kind === 'pdf')?.path ??
    files.find((f) => f.kind === 'image')?.path ??
    files.find((f) => f.kind === 'video')?.path ??
    files.find((f) => f.kind === 'audio')?.path ??
    files.find((f) => previewKindForFile(f.path, f.kind) === 'text')?.path ??
    files[0]?.path ??
    null
  );
}

export function externalAppManagedFallbackPath(input: {
  selectedPath: string | null;
  defaultPath: string | null;
  hasPersistedPreview: boolean;
}): string | null {
  return (
    input.selectedPath ??
    input.defaultPath ??
    (input.hasPersistedPreview ? DEFAULT_SOURCE_ENTRY : null)
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

export function isPreviewSourceUsableForSelectedPath(input: {
  selectedPath: string;
  previewSourcePath: string | null | undefined;
  selectedPreviewKind: FilePreviewKind;
}): boolean {
  const previewSourcePath = input.previewSourcePath;
  if (!previewSourcePath) return false;
  if (previewSourcePath === input.selectedPath) return true;
  return (
    input.selectedPreviewKind === 'runtime' &&
    isMainDesignSourcePath(input.selectedPath) &&
    previewKindForFile(previewSourcePath, undefined) === 'runtime'
  );
}

interface WorkspaceFilePreviewProps {
  path: string;
  file?: DesignFileEntry | null | undefined;
  files?: DesignFileEntry[] | null | undefined;
  interactive?: boolean | undefined;
}

interface WorkspaceFilePreviewMessageHandlerInput {
  previewZoom: number;
  selectCanvasElement: ReturnType<typeof useCodesignStore.getState>['selectCanvasElement'];
  openCommentBubble: ReturnType<typeof useCodesignStore.getState>['openCommentBubble'];
  applyLiveRects: ReturnType<typeof useCodesignStore.getState>['applyLiveRects'];
  pushIframeError: ReturnType<typeof useCodesignStore.getState>['pushIframeError'];
}

export function createWorkspaceFilePreviewMessageHandlers({
  previewZoom,
  selectCanvasElement,
  openCommentBubble,
  applyLiveRects,
  pushIframeError,
}: WorkspaceFilePreviewMessageHandlerInput): PreviewMessageHandlers {
  return {
    onElementSelected: (msg) => {
      const scaled = scaleRectForZoom(msg.rect, previewZoom);
      selectCanvasElement({
        selector: msg.selector,
        tag: msg.tag,
        outerHTML: msg.outerHTML,
        rect: scaled,
      });
      openCommentBubble({
        selector: msg.selector,
        tag: msg.tag,
        outerHTML: msg.outerHTML,
        rect: scaled,
        ...(typeof msg.parentOuterHTML === 'string' && msg.parentOuterHTML.length > 0
          ? { parentOuterHTML: msg.parentOuterHTML }
          : {}),
      });
    },
    onElementRects: (msg) => applyLiveRects(msg.entries),
    onIframeError: (msg) =>
      pushIframeError(formatIframeError(msg.kind, msg.message, msg.source, msg.lineno)),
  };
}

interface WorkspacePreviewSource {
  content: string;
  path: string;
}

export function workspacePreviewSourceStableKey(source: WorkspacePreviewSource | null): string {
  if (!source) return '';
  return `${source.path}:${stablePreviewSourceKey(source.content)}`;
}

export function splitMarkdownFrontmatter(content: string): {
  frontmatter: string | null;
  body: string;
} {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { frontmatter: null, body: content };
  const end = normalized.indexOf('\n---', 4);
  if (end < 0) return { frontmatter: null, body: content };
  const afterDelimiter = normalized.slice(end + 4);
  if (afterDelimiter.length > 0 && !afterDelimiter.startsWith('\n')) {
    return { frontmatter: null, body: content };
  }
  return {
    frontmatter: normalized.slice(4, end).trimEnd(),
    body: afterDelimiter.replace(/^\n/, ''),
  };
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
  const markdown = previewKind === 'markdown' ? splitMarkdownFrontmatter(content) : null;
  return (
    <div className="h-full overflow-auto bg-[var(--color-background)]">
      <div className="mx-auto w-full max-w-[860px] px-[var(--space-8)] py-[var(--space-7)]">
        {markdown ? (
          <article className="codesign-prose rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface)] px-[var(--space-6)] py-[var(--space-5)] text-[13px] leading-[var(--leading-body)] text-[var(--color-text-primary)] shadow-[var(--shadow-soft)]">
            {markdown.frontmatter ? (
              <details className="codesign-frontmatter">
                <summary>YAML frontmatter</summary>
                <pre>
                  <code>{markdown.frontmatter}</code>
                </pre>
              </details>
            ) : null}
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown.body}</ReactMarkdown>
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

function documentStatLabel(label: string, t: (key: string) => string): string {
  switch (label) {
    case 'Author':
      return t('canvas.documentPreview.stats.author');
    case 'Pages':
      return t('canvas.documentPreview.stats.pages');
    case 'Slides':
      return t('canvas.documentPreview.stats.slides');
    case 'Words':
      return t('canvas.documentPreview.stats.words');
    case 'Worksheets':
      return t('canvas.documentPreview.stats.worksheets');
    default:
      return label;
  }
}

function documentSectionTitle(title: string, t: (key: string) => string): string {
  if (title === 'Document') return t('canvas.documentPreview.section.document');
  if (title === 'Workbook') return t('canvas.documentPreview.section.workbook');
  return title;
}

function DocumentFilePreview({
  path,
  designId,
}: {
  path: string;
  designId: string | null | undefined;
}) {
  const t = useT();
  const [preview, setPreview] = useState<WorkspaceDocumentPreviewResult | null>(null);
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!designId) {
      setPreview(null);
      setThumbnailDataUrl(null);
      setError(t('canvas.documentPreview.unavailable'));
      return;
    }
    const previewApi = window.codesign?.files?.preview;
    if (!previewApi) {
      setPreview(null);
      setThumbnailDataUrl(null);
      setError(t('canvas.documentPreview.unavailable'));
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPreview(null);
    setThumbnailDataUrl(null);
    void previewApi(designId, path)
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        setThumbnailDataUrl(result.thumbnailDataUrl ?? null);
        setLoading(false);
        const thumbnailApi = window.codesign?.files?.thumbnail;
        if (!thumbnailApi) return;
        void thumbnailApi(designId, path)
          .then((thumbnail) => {
            if (cancelled) return;
            if (thumbnail.thumbnailDataUrl !== null) {
              setThumbnailDataUrl(thumbnail.thumbnailDataUrl);
            }
          })
          .catch(() => {
            // Text extraction is the cross-platform preview. Thumbnail failure
            // should not turn the whole document preview into an error state.
          });
      })
      .catch((err) => {
        if (cancelled) return;
        setPreview(null);
        setThumbnailDataUrl(null);
        setError(err instanceof Error ? err.message : t('canvas.documentPreview.unavailable'));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [designId, path, t]);

  if (loading && preview === null) {
    return (
      <div className="h-full flex items-center justify-center text-[var(--text-sm)] text-[var(--color-text-muted)]">
        {t('canvas.documentPreview.loading')}
      </div>
    );
  }

  if (preview === null) {
    return (
      <div className="h-full flex items-center justify-center text-[var(--text-sm)] text-[var(--color-text-muted)]">
        {error ?? t('canvas.documentPreview.unavailable')}
      </div>
    );
  }

  const hasText = preview.sections.some((section) => section.lines.length > 0);

  return (
    <div className="h-full overflow-hidden bg-[var(--color-background-secondary)]">
      <div className="grid h-full min-h-0 grid-cols-[minmax(320px,42%)_minmax(0,1fr)] max-[980px]:grid-cols-1">
        <aside className="min-h-0 overflow-auto border-r border-[var(--color-border-muted)] bg-[color-mix(in_srgb,var(--color-background)_92%,var(--color-surface))] max-[980px]:border-r-0 max-[980px]:border-b">
          <div className="flex min-h-full flex-col px-[var(--space-7)] py-[var(--space-6)]">
            <div className="mb-[var(--space-4)] flex items-center justify-between gap-[var(--space-3)]">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)]">
                  {preview.format.toUpperCase()}
                </div>
                <div
                  className="mt-1 truncate text-[12px] text-[var(--color-text-secondary)]"
                  style={{ fontFamily: 'var(--font-mono)' }}
                  title={preview.fileName}
                >
                  {preview.fileName}
                </div>
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface)] text-[var(--color-accent)] shadow-[var(--shadow-soft)]">
                <FileText className="h-5 w-5" aria-hidden />
              </div>
            </div>

            <div className="flex flex-1 items-start justify-center">
              <div className="w-full max-w-[560px]">
                <div className="relative mx-auto overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_18px_55px_color-mix(in_srgb,var(--color-text-primary)_15%,transparent)]">
                  <div className="aspect-[4/5] max-h-[calc(100vh-230px)] min-h-[360px] w-full max-[980px]:max-h-none max-[980px]:min-h-[300px]">
                    {thumbnailDataUrl ? (
                      <img
                        src={thumbnailDataUrl}
                        alt={t('canvas.documentPreview.thumbnailAlt', { name: preview.fileName })}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-[var(--space-4)] px-[var(--space-6)] text-center">
                        <div className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-background-secondary)] text-[var(--color-accent)]">
                          <FileText className="h-8 w-8" aria-hidden />
                        </div>
                        <div className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)]">
                          {preview.fileName}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {preview.stats.length > 0 ? (
                  <div className="mt-[var(--space-4)] grid grid-cols-3 gap-[var(--space-2)] max-[1180px]:grid-cols-2">
                    {preview.stats.slice(0, 6).map((stat) => (
                      <div
                        key={`${stat.label}:${stat.value}`}
                        className="min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border-muted)] bg-[var(--color-surface)] px-[var(--space-3)] py-[var(--space-2)]"
                      >
                        <div className="truncate text-[10px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)]">
                          {documentStatLabel(stat.label, t)}
                        </div>
                        <div
                          className="mt-[2px] truncate text-[12px] text-[var(--color-text-primary)]"
                          style={{ fontFamily: 'var(--font-mono)' }}
                          title={stat.value}
                        >
                          {stat.value}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </aside>

        <main className="min-h-0 overflow-auto bg-[var(--color-background)]">
          <article className="mx-auto w-full max-w-[860px] px-[var(--space-8)] py-[var(--space-7)]">
            <header className="mb-[var(--space-6)] border-b border-[var(--color-border-muted)] pb-[var(--space-5)]">
              <div className="mb-[var(--space-2)] text-[10px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)]">
                {t('canvas.documentPreview.previewLabel')}
              </div>
              <h3 className="m-0 text-[28px] leading-[1.16] text-[var(--color-text-primary)]">
                {preview.title}
              </h3>
            </header>

            {hasText ? (
              <div className="space-y-[var(--space-7)]">
                {preview.sections.map((section) => (
                  <section key={section.title} className="min-w-0">
                    <h4 className="m-0 mb-[var(--space-4)] text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)]">
                      {documentSectionTitle(section.title, t)}
                    </h4>
                    <div className="space-y-[var(--space-3)] text-[14px] leading-[1.82] text-[var(--color-text-primary)]">
                      {section.lines.map((line, index) => (
                        <p key={`${section.title}:${index}`} className="m-0 break-words">
                          {line}
                        </p>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface)] px-[var(--space-5)] py-[var(--space-4)] text-[13px] text-[var(--color-text-muted)] shadow-[var(--shadow-soft)]">
                {t('canvas.documentPreview.empty')}
              </div>
            )}
          </article>
        </main>
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
  if (kind === 'video') {
    return (
      <div className="h-full overflow-auto bg-[var(--color-background-secondary)] p-[var(--space-6)]">
        <div className="flex min-h-full items-center justify-center">
          {/* biome-ignore lint/a11y/useMediaCaption: workspace file previews cannot assume a caption track exists. */}
          <video
            src={url}
            controls
            className="max-h-full max-w-full rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-black shadow-[var(--shadow-soft)]"
          />
        </div>
      </div>
    );
  }
  if (kind === 'audio') {
    return (
      <div className="h-full bg-[var(--color-background-secondary)] p-[var(--space-6)]">
        <div className="flex min-h-full items-center justify-center">
          <div className="w-full max-w-[680px] rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface)] px-[var(--space-5)] py-[var(--space-4)] shadow-[var(--shadow-soft)]">
            <div
              className="mb-[var(--space-3)] truncate text-[12px] text-[var(--color-text-secondary)]"
              style={{ fontFamily: 'var(--font-mono)' }}
              title={path}
            >
              {path}
            </div>
            {/* biome-ignore lint/a11y/useMediaCaption: workspace file previews cannot assume a caption track exists. */}
            <audio src={url} controls className="w-full" />
          </div>
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

function ConnectedUrlPreview({ url }: { url: string }) {
  const t = useT();
  const [reloadKey, setReloadKey] = useState(0);

  const handleOpenExternal = useCallback(async () => {
    try {
      await window.codesign?.openExternal(url);
    } catch (err) {
      useCodesignStore.getState().pushToast({
        variant: 'error',
        title: t('canvas.workspace.preview.openFailed'),
        description: err instanceof Error ? err.message : t('errors.unknown'),
      });
    }
  }, [t, url]);

  return (
    <div className="relative h-full min-h-0 bg-[var(--color-background-secondary)]">
      <iframe
        key={`${url}:${reloadKey}`}
        title={`connected-preview-${url}`}
        src={url}
        sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
        className="block h-full w-full border-0 bg-white"
      />
      <div className="absolute right-[var(--space-3)] top-[var(--space-3)] flex items-center gap-[var(--space-1)]">
        <button
          type="button"
          onClick={() => setReloadKey((value) => value + 1)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] shadow-[var(--shadow-soft)] transition-colors hover:bg-[var(--color-surface-hover)]"
          title={t('canvas.workspace.preview.reload')}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={handleOpenExternal}
          className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] shadow-[var(--shadow-soft)] transition-colors hover:bg-[var(--color-surface-hover)]"
          title={t('canvas.workspace.preview.openConnected')}
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function NoPreviewPlaceholder() {
  const t = useT();
  return (
    <div className="flex h-full items-center justify-center bg-[var(--color-background-secondary)] px-[var(--space-8)] text-center">
      <div className="max-w-[360px] text-[13px] leading-[var(--leading-body)] text-[var(--color-text-muted)]">
        <Globe2 className="mx-auto mb-[var(--space-3)] h-6 w-6 text-[var(--color-text-muted)]" />
        {t('canvas.workspace.preview.placeholder.off')}
      </div>
    </div>
  );
}

function DevServerRequiredPlaceholder() {
  const t = useT();
  return (
    <div className="flex h-full items-center justify-center bg-[var(--color-background-secondary)] px-[var(--space-8)] text-center">
      <div className="max-w-[420px] text-[13px] leading-[var(--leading-body)] text-[var(--color-text-muted)]">
        <Globe2 className="mx-auto mb-[var(--space-3)] h-6 w-6 text-[var(--color-text-muted)]" />
        {t('canvas.workspace.preview.placeholder.devServerRequired')}
      </div>
    </div>
  );
}

function ExternalAppPreviewPlaceholder({ url }: { url: string | null }) {
  const t = useT();

  const handleOpenExternal = useCallback(async () => {
    if (!url) return;
    try {
      await window.codesign?.openExternal(url);
    } catch (err) {
      useCodesignStore.getState().pushToast({
        variant: 'error',
        title: t('canvas.workspace.preview.openFailed'),
        description: err instanceof Error ? err.message : t('errors.unknown'),
      });
    }
  }, [t, url]);

  return (
    <div className="flex h-full items-center justify-center bg-[var(--color-background-secondary)] px-[var(--space-8)] text-center">
      <div className="max-w-[420px] text-[13px] leading-[var(--leading-body)] text-[var(--color-text-muted)]">
        <ExternalLink className="mx-auto mb-[var(--space-3)] h-6 w-6 text-[var(--color-text-muted)]" />
        <p className="m-0">{t('canvas.workspace.preview.placeholder.external')}</p>
        {url ? (
          <button
            type="button"
            onClick={handleOpenExternal}
            className="mt-[var(--space-4)] inline-flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            {t('canvas.workspace.preview.openConnected')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function WorkspaceFilePreview({
  path,
  file,
  files,
  interactive = true,
}: WorkspaceFilePreviewProps) {
  const t = useT();
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const designs = useCodesignStore((s) => s.designs);
  const currentPreviewSource = useCodesignStore((s) => s.previewSource);
  const previewZoom = useCodesignStore((s) => s.previewZoom);
  const interactionMode = useCodesignStore((s) => s.interactionMode);
  const pushIframeError = useCodesignStore((s) => s.pushIframeError);
  const selectCanvasElement = useCodesignStore((s) => s.selectCanvasElement);
  const openCommentBubble = useCodesignStore((s) => s.openCommentBubble);
  const applyLiveRects = useCodesignStore((s) => s.applyLiveRects);
  const { files: observedFiles } = useDesignFiles(files ? null : currentDesignId);
  const workspaceFiles = files ?? observedFiles;
  const currentDesign = designs.find((d) => d.id === currentDesignId);
  const currentDesignUpdatedAt = currentDesign?.updatedAt;
  const effectiveFile = file ?? workspaceFiles.find((f) => f.path === path) ?? null;
  const prefersPreviewSource = effectiveFile?.source === 'preview-html';
  const previewKind = previewKindForFile(path, effectiveFile?.kind);
  const renderable = previewKind === 'runtime';
  const useDesignPreviewResolver = shouldUseDesignPreviewResolverForFile({
    path,
    previewKind,
    source: effectiveFile?.source,
  });
  const textPreview = previewKind === 'markdown' || previewKind === 'text';
  const documentPreview = previewKind === 'document';
  const nativePreview =
    previewKind === 'image' ||
    previewKind === 'video' ||
    previewKind === 'audio' ||
    previewKind === 'pdf';
  const [previewSource, setPreviewSource] = useState<WorkspacePreviewSource | null>(null);
  const showTweakPanel =
    interactive &&
    shouldShowTweakPanelForFile({
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
  const activePreviewSource = isPreviewSourceUsableForSelectedPath({
    selectedPath: path,
    previewSourcePath: previewSource?.path,
    selectedPreviewKind: previewKind,
  })
    ? previewSource
    : null;

  useEffect(() => {
    function onMessage(event: MessageEvent): void {
      if (!isTrustedPreviewMessageSource(event.source, iframeRef.current?.contentWindow)) return;
      handlePreviewMessage(
        event.data,
        createWorkspaceFilePreviewMessageHandlers({
          previewZoom,
          selectCanvasElement: (selection) => {
            if (interactive) selectCanvasElement(selection);
          },
          openCommentBubble: (bubble) => {
            if (interactive) openCommentBubble(bubble);
          },
          applyLiveRects: (entries) => {
            if (interactive) applyLiveRects(entries);
          },
          pushIframeError,
        }),
      );
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [
    pushIframeError,
    previewZoom,
    selectCanvasElement,
    openCommentBubble,
    applyLiveRects,
    interactive,
  ]);

  useEffect(() => {
    postModeToPreviewWindow(
      iframeRef.current?.contentWindow,
      interactive ? interactionMode : 'default',
      pushIframeError,
    );
  }, [interactionMode, pushIframeError, interactive]);

  useEffect(() => {
    // Re-read when the file watcher reports changed metadata for either the
    // selected file or an HTML placeholder's resolved JSX/TSX source.
    void currentDesignUpdatedAt;
    void previewDependencyKey;
    if ((!renderable && !textPreview) || !currentDesignId) {
      setPreviewSource(null);
      setReadError(null);
      return;
    }
    const read = window.codesign?.files?.read;
    if (useDesignPreviewResolver) {
      let cancelled = false;
      setPreviewSource(null);
      setReadError(null);
      void resolveDesignPreviewSource({
        designId: currentDesignId,
        read,
        snapshotSource: currentPreviewSource,
        listSnapshots: window.codesign?.snapshots.list,
        preferSnapshotSource: true,
      })
        .then((result) => {
          if (cancelled) return;
          setPreviewSource(result);
          if (result === null) setReadError(t('canvas.filesTabEmpty'));
        })
        .catch((err) => {
          if (cancelled) return;
          setPreviewSource(null);
          setReadError(err instanceof Error ? err.message : t('errors.unknown'));
        });
      return () => {
        cancelled = true;
      };
    }
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
    setPreviewSource(null);
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
    currentDesignUpdatedAt,
    previewDependencyKey,
    path,
    currentPreviewSource,
    renderable,
    textPreview,
    t,
    prefersPreviewSource,
    useDesignPreviewResolver,
  ]);

  const previewSourceStableKey = useMemo(
    () => workspacePreviewSourceStableKey(activePreviewSource),
    [activePreviewSource],
  );
  const workspaceDevServerRequired =
    Boolean(activePreviewSource?.path.toLowerCase().endsWith('.html')) &&
    htmlRequiresWorkspaceDevServer(activePreviewSource?.content ?? '');

  // biome-ignore lint/correctness/useExhaustiveDependencies: previewSourceStableKey intentionally masks EDITMODE-only token changes so live tweaks can update via postMessage without rebuilding the iframe.
  const srcDoc = useMemo(() => {
    if (!activePreviewSource || !renderable || workspaceDevServerRequired) return null;
    try {
      const baseHref = workspaceBaseHrefForFile({
        designId: currentDesignId,
        workspacePath: currentDesign?.workspacePath,
        filePath: activePreviewSource.path,
      });
      return buildPreviewDocument(activePreviewSource.content, {
        path: activePreviewSource.path,
        baseHref,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `<!doctype html><html><body style="font: 13px system-ui; color: #71717a; display: grid; place-items: center; min-height: 100vh; margin: 0;">${escapeHtmlText(message)}</body></html>`;
    }
  }, [
    currentDesign?.workspacePath,
    currentDesignId,
    activePreviewSource?.path,
    previewSourceStableKey,
    renderable,
    workspaceDevServerRequired,
  ]);

  if (nativePreview) {
    const url = workspaceUrlForFile({ designId: currentDesignId, filePath: path });
    if (url) return <NativeFilePreview kind={previewKind} path={path} url={url} />;
  }

  if (documentPreview) {
    return <DocumentFilePreview path={path} designId={currentDesignId} />;
  }

  if (previewKind === 'unsupported') {
    return (
      <div className="h-full flex items-center justify-center text-[var(--text-sm)] text-[var(--color-text-muted)]">
        {t('canvas.filesTabEmpty')}
      </div>
    );
  }

  if (workspaceDevServerRequired) {
    return <DevServerRequiredPlaceholder />;
  }

  if (!srcDoc) {
    if (activePreviewSource && textPreview) {
      return (
        <TextFilePreview
          content={activePreviewSource.content}
          previewKind={previewKind}
          path={path}
        />
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
          postModeToPreviewWindow(win, interactive ? interactionMode : 'default', pushIframeError);
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

export function FilesTabView({ activePath = null }: { activePath?: string | null }) {
  const t = useT();
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const designs = useCodesignStore((s) => s.designs);
  const openFileTab = useCodesignStore((s) => s.openCanvasFileTab);
  const setActiveCanvasTab = useCodesignStore((s) => s.setActiveCanvasTab);
  const currentPreviewSource = useCodesignStore((s) => s.previewSource);
  const { files, tree: fileTree, loadDirectory } = useLazyDesignFileTree(currentDesignId);

  const defaultPath = useMemo(() => defaultWorkspacePreviewPath(files), [files]);

  const [selectedPath, setSelectedPath] = useState<string | null>(activePath ?? defaultPath);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [fileBrowserWidth, setFileBrowserWidth] = useState(initialFileBrowserWidth);
  const [isFileBrowserResizing, setIsFileBrowserResizing] = useState(false);
  const expandedDesignRef = useRef<string | null>(currentDesignId);
  const isDedicatedFileTab = activePath !== null;
  const currentDesign = designs.find((d) => d.id === currentDesignId);
  const effectivePreviewMode = useMemo(
    () =>
      effectivePreviewModeForDesign({
        previewMode: currentDesign?.previewMode,
        previewUrl: currentDesign?.previewUrl,
        files,
      }),
    [currentDesign?.previewMode, currentDesign?.previewUrl, files],
  );
  const selectedFile = selectedPath ? (files.find((f) => f.path === selectedPath) ?? null) : null;
  const connectedPreviewUrl = normalizeConnectedPreviewUrlInput(currentDesign?.previewUrl ?? '');
  const externalFallbackPath = externalAppManagedFallbackPath({
    selectedPath,
    defaultPath,
    hasPersistedPreview:
      Boolean(currentPreviewSource?.trim()) ||
      Boolean(currentDesign?.thumbnailText && currentDesign.thumbnailText.length > 0),
  });
  const externalFallbackFile = externalFallbackPath
    ? (files.find((f) => f.path === externalFallbackPath) ?? null)
    : null;
  const usesExternalPreview =
    effectivePreviewMode === 'connected-url' || effectivePreviewMode === 'external-app';
  const showPreviewHeaderAction =
    (effectivePreviewMode === 'managed-file' && selectedPath !== null) ||
    (usesExternalPreview && connectedPreviewUrl !== null);

  const handleOpenPreviewTarget = useCallback(async () => {
    if (usesExternalPreview && connectedPreviewUrl) {
      try {
        await window.codesign?.openExternal(connectedPreviewUrl);
      } catch (err) {
        useCodesignStore.getState().pushToast({
          variant: 'error',
          title: t('canvas.workspace.preview.openFailed'),
          description: err instanceof Error ? err.message : t('errors.unknown'),
        });
      }
      return;
    }
    if (selectedPath) openFileTab(selectedPath);
  }, [connectedPreviewUrl, openFileTab, selectedPath, t, usesExternalPreview]);

  const handleFileTreeFileClick = useCallback(
    (path: string) => {
      setSelectedPath(path);
      if (isDedicatedFileTab) setActiveCanvasTab(0);
    },
    [isDedicatedFileTab, setActiveCanvasTab],
  );

  const handleFileBrowserResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = fileBrowserWidth;
      setIsFileBrowserResizing(true);

      const onMove = (moveEvent: MouseEvent) => {
        const nextWidth = clampFileBrowserWidth(
          startWidth + moveEvent.clientX - startX,
          window.innerWidth,
        );
        setFileBrowserWidth(nextWidth);
      };

      const onUp = () => {
        setIsFileBrowserResizing(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [fileBrowserWidth],
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(FILE_BROWSER_WIDTH_STORAGE_KEY, String(fileBrowserWidth));
    } catch {
      // Layout preference persistence is best-effort.
    }
  }, [fileBrowserWidth]);

  function renderPreviewPane() {
    if (effectivePreviewMode === 'connected-url') {
      return connectedPreviewUrl ? (
        <ConnectedUrlPreview url={connectedPreviewUrl} />
      ) : (
        <NoPreviewPlaceholder />
      );
    }
    if (effectivePreviewMode === 'external-app') {
      if (externalFallbackPath) {
        return (
          <WorkspaceFilePreview
            path={externalFallbackPath}
            file={externalFallbackFile}
            files={files}
            interactive={isDedicatedFileTab}
          />
        );
      }
      return <ExternalAppPreviewPlaceholder url={connectedPreviewUrl} />;
    }
    if (effectivePreviewMode === 'none') {
      if (
        selectedPath &&
        selectedFile &&
        previewKindForFile(selectedPath, selectedFile.kind) === 'runtime'
      ) {
        return (
          <WorkspaceFilePreview
            path={selectedPath}
            file={selectedFile}
            files={files}
            interactive={isDedicatedFileTab}
          />
        );
      }
      return <NoPreviewPlaceholder />;
    }
    if (selectedPath) {
      return (
        <WorkspaceFilePreview
          path={selectedPath}
          file={selectedFile}
          files={files}
          interactive={isDedicatedFileTab}
        />
      );
    }
    return (
      <div className="flex h-full items-center justify-center text-[var(--text-sm)] text-[var(--color-text-muted)]">
        {t('canvas.filesTabEmpty')}
      </div>
    );
  }

  useEffect(() => {
    if (activePath) {
      setSelectedPath(activePath);
      return;
    }
    if (!selectedPath || !files.find((f) => f.path === selectedPath)) {
      setSelectedPath(defaultPath);
    }
  }, [activePath, defaultPath, files, selectedPath]);

  useEffect(() => {
    if (expandedDesignRef.current === currentDesignId) return;
    expandedDesignRef.current = currentDesignId;
    setExpandedDirs(new Set());
  }, [currentDesignId]);

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

  function renderFileTreeNode(node: FileTreeNode, depth: number): ReactNode {
    if (node.type === 'directory') {
      const isExpanded = expandedDirs.has(node.path);
      return (
        <li key={node.path}>
          <button
            type="button"
            onClick={() => toggleDirectory(node)}
            aria-expanded={isExpanded}
            className="group flex h-9 w-full min-w-0 items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] px-[var(--space-2)] text-left text-[var(--text-sm)] text-[var(--color-text-secondary)] transition-colors duration-[var(--duration-faster)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
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
          {isExpanded && node.loading ? (
            <div
              className="flex h-8 items-center px-[var(--space-2)] text-[var(--text-xs)] text-[var(--color-text-muted)]"
              style={{ paddingLeft: `calc(var(--space-2) + ${(depth + 1) * 16 + 20}px)` }}
            >
              {t('common.loading')}
            </div>
          ) : null}
          {isExpanded && node.children.length > 0 ? (
            <ul className="list-none p-0 m-0">
              {node.children.map((child) => renderFileTreeNode(child, depth + 1))}
            </ul>
          ) : null}
        </li>
      );
    }

    const f = node.file;
    const isActive = f.path === selectedPath;
    return (
      <li key={node.path} className="relative">
        {isActive ? (
          <span
            aria-hidden
            className="absolute left-0 top-[6px] bottom-[6px] w-[2px] bg-[var(--color-accent)] rounded-r-full"
          />
        ) : null}
        <button
          type="button"
          onClick={() => handleFileTreeFileClick(f.path)}
          onDoubleClick={() => openFileTab(f.path)}
          title={f.path}
          aria-current={isActive ? 'page' : undefined}
          className={`group flex h-9 w-full items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] pr-[var(--space-2)] text-left transition-colors duration-[var(--duration-faster)] ${
            isActive
              ? 'bg-[var(--color-surface-active)] text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
          }`}
          style={{ paddingLeft: `calc(var(--space-2) + ${depth * 16 + 20}px)` }}
        >
          <FileCode2
            className={`size-4 shrink-0 ${
              isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'
            }`}
            aria-hidden
          />
          <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
            <span
              className="truncate text-[var(--text-sm)] leading-[var(--leading-ui)]"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {node.name}
            </span>
            <span
              className="text-[10px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)]"
              style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}
            >
              {formatBytes(f.size)}
            </span>
          </span>
        </button>
      </li>
    );
  }

  if (files.length === 0 && fileTree.length === 0) {
    return (
      <div className="relative flex h-full min-h-0">
        {isFileBrowserResizing ? <div className="absolute inset-0 z-20 cursor-col-resize" /> : null}
        <aside
          className="shrink-0 border-r border-[var(--color-border-muted)] bg-[var(--color-background)] overflow-y-auto flex flex-col"
          style={{ width: fileBrowserWidth }}
        >
          <WorkspaceSection files={files} />
          <div className="flex-1 flex items-center justify-center text-[var(--text-sm)] text-[var(--color-text-muted)] px-[var(--space-6)]">
            {t('canvas.filesTabEmpty')}
          </div>
        </aside>
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={handleFileBrowserResizeStart}
          className="relative z-10 w-[5px] shrink-0 cursor-col-resize bg-[var(--color-background)] transition-colors duration-100 hover:bg-[var(--color-accent)]/15 active:bg-[var(--color-accent)]/25"
          title="Resize files"
        />
        <div className="flex-1 min-w-0 h-full bg-[var(--color-background-secondary)]">
          {renderPreviewPane()}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0">
      {isFileBrowserResizing ? <div className="absolute inset-0 z-20 cursor-col-resize" /> : null}
      <aside
        className="shrink-0 border-r border-[var(--color-border-muted)] bg-[var(--color-background)] overflow-y-auto flex flex-col"
        style={{ width: fileBrowserWidth }}
      >
        <WorkspaceSection files={files} />
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
            {fileTree.map((node) => renderFileTreeNode(node, 0))}
          </ul>

          <p className="mt-[var(--space-6)] text-[11px] text-[var(--color-text-muted)] leading-[var(--leading-body)]">
            {t('canvas.previewHint')}
          </p>
        </div>
      </aside>
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={handleFileBrowserResizeStart}
        className="relative z-10 w-[5px] shrink-0 cursor-col-resize bg-[var(--color-background)] transition-colors duration-100 hover:bg-[var(--color-accent)]/15 active:bg-[var(--color-accent)]/25"
        title="Resize files"
      />
      <div className="flex-1 min-w-0 h-full bg-[var(--color-background-secondary)] flex flex-col min-h-0">
        {showPreviewHeaderAction ? (
          <div className="flex h-[36px] shrink-0 items-center justify-end border-b border-[var(--color-border-muted)] bg-[var(--color-background)] px-[var(--space-4)]">
            <button
              type="button"
              onClick={handleOpenPreviewTarget}
              className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-accent)]"
            >
              {usesExternalPreview
                ? t('canvas.workspace.preview.openConnected')
                : t('canvas.openInTab')}
            </button>
          </div>
        ) : null}
        <div className="flex-1 min-h-0 bg-[var(--color-background-secondary)]">
          {renderPreviewPane()}
        </div>
      </div>
    </div>
  );
}
