import { buildPreviewDocument, requiresPreviewScripts } from '@open-codesign/runtime';
import type { Design } from '@open-codesign/shared';
import { DEFAULT_SOURCE_ENTRY, SourceIdentityV1 } from '@open-codesign/shared';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { inferPreviewSourcePath, resolveDesignPreviewSource } from '../../preview/workspace-source';
import { useCodesignStore } from '../../store';

// Hub cards render many iframes in parallel; live CSS animations / transitions /
// autoplaying media in each one thrash compositor + GPU for no user value (the
// thumbnail is decorative). Inject a stylesheet that freezes motion so cards
// behave like static snapshots without requiring screenshotting infrastructure.
const THUMBNAIL_STYLE = `<style>
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
  scrollbar-width: none !important;
}
*::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
html, body { overflow: hidden !important; margin: 0 !important; }
video, audio { display: none !important; }
</style>`;

function injectThumbnailStyle(srcDoc: string): string {
  if (/<\/head>/i.test(srcDoc)) {
    return srcDoc.replace(/<\/head>/i, `${THUMBNAIL_STYLE}</head>`);
  }
  return THUMBNAIL_STYLE + srcDoc;
}

export function needsJsxRuntime(source: string, path?: string): boolean {
  return requiresPreviewScripts(source, path);
}

export interface DesignCardPreviewProps {
  design: Design;
}

interface PreviewCardSource {
  content: string;
  path: string;
  source?: SourceIdentityV1;
}

// Two-tier cache: in-memory (hot path, survives tab switches in a single
// session) + localStorage (cold start after reopening the app). Keyed on
// designId + updatedAt so a fresh generate invalidates automatically.
const memCache = new Map<string, PreviewCardSource>();
const CACHE_VERSION = 'v4';
const LEGACY_LS_PREFIX = 'designCardPreview:v2:';
const LS_PREFIX = `designCardPreview:${CACHE_VERSION}:`;
const LS_MAX_CHARS = 300_000; // ~ 300 KB per entry ceiling; skip caching huge sources
const LS_MAX_ENTRIES = 40;
const MEM_MAX_ENTRIES = 40;
const inflightReads = new Map<string, Promise<PreviewCardSource | null>>();

function cacheKey(id: string, updatedAt: string): string {
  return `${CACHE_VERSION}:${id}:${updatedAt}`;
}

function requestKey(id: string, updatedAt: string): string {
  return `${id}:${updatedAt}`;
}

// Map preserves insertion order, so delete+set on access makes the eviction
// loop drop the least-recently-used key when the cache overflows.
function memCacheTouch(key: string, value: PreviewCardSource): void {
  memCache.delete(key);
  memCache.set(key, value);
  while (memCache.size > MEM_MAX_ENTRIES) {
    const oldest = memCache.keys().next().value;
    if (oldest === undefined) break;
    memCache.delete(oldest);
  }
}

export function parseCachedPreview(raw: string): PreviewCardSource | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as Record<string, unknown>)['schemaVersion'] === 1 &&
      typeof (parsed as Record<string, unknown>)['content'] === 'string' &&
      typeof (parsed as Record<string, unknown>)['path'] === 'string'
    ) {
      return {
        content: (parsed as Record<string, string>)['content'] ?? '',
        path: (parsed as Record<string, string>)['path'] ?? DEFAULT_SOURCE_ENTRY,
        ...(SourceIdentityV1.safeParse((parsed as Record<string, unknown>)['source']).success
          ? { source: SourceIdentityV1.parse((parsed as Record<string, unknown>)['source']) }
          : {}),
      };
    }
  } catch {
    // Legacy v2 values were raw source strings.
  }
  return raw.trim().length > 0 ? { content: raw, path: inferPreviewSourcePath(raw) } : null;
}

function readCache(key: string): PreviewCardSource | null {
  const hit = memCache.get(key);
  if (hit !== undefined) {
    memCacheTouch(key, hit);
    return hit;
  }
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    const legacyRaw = raw ?? localStorage.getItem(LEGACY_LS_PREFIX + key);
    if (legacyRaw === null) return null;
    const parsed = parseCachedPreview(legacyRaw);
    if (parsed !== null) memCacheTouch(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(key: string, source: PreviewCardSource): void {
  memCacheTouch(key, source);
  if (typeof localStorage === 'undefined') return;
  const raw = JSON.stringify({ schemaVersion: 1, ...source });
  if (raw.length > LS_MAX_CHARS) return;
  try {
    // Best-effort eviction: if localStorage is near its quota, pruning the
    // oldest preview keys lets the new one fit. We cap total entries, too.
    pruneOldestCacheEntriesIfNeeded();
    localStorage.setItem(LS_PREFIX + key, raw);
  } catch {
    // Quota exceeded or storage disabled — ignore, we still have in-memory.
  }
}

export function clearPreviewCardCachesForTest(): void {
  memCache.clear();
  inflightReads.clear();
}

export function hubScrollRootForCard(el: HTMLElement): Element | null {
  return el.closest('[data-codesign-hub-scroll-root]');
}

export function workspaceBaseHrefForPreview(
  design: Pick<Design, 'id' | 'workspacePath'>,
  sourcePath: string,
): string | undefined {
  if (!design.workspacePath) return undefined;
  const slashIndex = sourcePath.replaceAll('\\', '/').lastIndexOf('/');
  const dir = slashIndex >= 0 ? sourcePath.slice(0, slashIndex + 1) : '';
  const encodedDir = dir
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join('/');
  return `workspace://${design.id}/${encodedDir}${encodedDir.length > 0 ? '/' : ''}`;
}

function pruneOldestCacheEntriesIfNeeded(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(LS_PREFIX)) keys.push(k);
    }
    if (keys.length < LS_MAX_ENTRIES) return;
    // Oldest-first via the updatedAt segment of the key; not perfectly LRU but
    // we don't need strict correctness — just bounded growth.
    keys.sort();
    for (let i = 0; i < keys.length - LS_MAX_ENTRIES + 1; i++) {
      const k = keys[i];
      if (k !== undefined) localStorage.removeItem(k);
    }
  } catch {
    /* noop */
  }
}

function previewCardSourceFromRaw(content: string): PreviewCardSource | null {
  return content.trim().length > 0 ? { content, path: inferPreviewSourcePath(content) } : null;
}

export function readPreviewSourceForCard(
  designId: string,
  updatedAt: string,
): Promise<PreviewCardSource | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  const key = requestKey(designId, updatedAt);
  const existing = inflightReads.get(key);
  if (existing !== undefined) return existing;

  const bridge = window.codesign;
  if (!bridge) return Promise.resolve(null);
  const read = resolveDesignPreviewSource({
    designId,
    read: bridge.files?.read,
    listSnapshots: bridge.snapshots.list,
    preferSnapshotSource: true,
    getSourceEntry: useCodesignStore.getState().refreshSourceEntry,
  }).finally(() => {
    inflightReads.delete(key);
  });
  inflightReads.set(key, read);
  return read;
}

export function DesignCardPreview({ design }: DesignCardPreviewProps) {
  const livePreviewSource = useCodesignStore((s) => s.previewSourceByDesign[design.id]);
  const identity = useCodesignStore((s) => s.previewIdentityByDesign[design.id]);
  const isGenerating = useCodesignStore((s) => s.generationByDesign[design.id] !== undefined);
  const [previewSource, setPreviewSource] = useState<PreviewCardSource | null>(() =>
    readCache(cacheKey(design.id, design.updatedAt)),
  );
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [scale, setScale] = useState(0.22);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const key = cacheKey(design.id, design.updatedAt);
    const liveSource =
      typeof livePreviewSource === 'string'
        ? identity
          ? { content: livePreviewSource, path: identity.path, source: identity }
          : previewCardSourceFromRaw(livePreviewSource)
        : null;
    if (liveSource !== null) {
      writeCache(key, liveSource);
      setPreviewSource(liveSource);
      setFailed(false);
      return;
    }
    const hostOwnsSource = Boolean(window.codesign?.sourceEntry);
    const cached = hostOwnsSource ? null : readCache(key);
    setPreviewSource((current) => (hostOwnsSource ? null : (cached ?? current)));
    setFailed(false);
  }, [design.id, design.updatedAt, livePreviewSource, identity]);

  useEffect(() => {
    if (isGenerating) setFailed(false);
  }, [isGenerating]);

  // Mount the iframe only after the card has scrolled into (or near) the
  // viewport. Stops every card in the grid from paying the iframe-creation
  // cost on tab switch.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.disconnect();
            break;
          }
        }
      },
      // Pre-mount a little above/below the viewport so scrolling feels instant.
      { root: hubScrollRootForCard(el), rootMargin: '320px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Keep the iframe scaled to fully cover the card so cream/white strips never
  // peek through on the right or bottom edges. Pick max(W/1280, H/960) so the
  // shorter axis still fills.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let scheduled: { kind: 'raf' | 'timeout'; id: number } | null = null;
    const updateScale = () => {
      const rect = el.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w <= 0 || h <= 0) return;
      const next = Math.max(w / 1280, h / 960);
      setScale((prev) => (Math.abs(prev - next) > 0.001 ? next : prev));
    };
    const scheduleScaleUpdate = () => {
      if (scheduled !== null) return;
      const flush = () => {
        scheduled = null;
        updateScale();
      };
      if (typeof window.requestAnimationFrame === 'function') {
        scheduled = { kind: 'raf', id: window.requestAnimationFrame(flush) };
      } else {
        scheduled = { kind: 'timeout', id: window.setTimeout(flush, 0) };
      }
    };
    const cancelScheduledScaleUpdate = () => {
      if (scheduled === null) return;
      if (scheduled.kind === 'raf') window.cancelAnimationFrame(scheduled.id);
      else window.clearTimeout(scheduled.id);
      scheduled = null;
    };
    updateScale();
    const ro = new ResizeObserver(scheduleScaleUpdate);
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelScheduledScaleUpdate();
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const key = cacheKey(design.id, design.updatedAt);
    const cached = readCache(key);
    if (cached !== null && !window.codesign?.sourceEntry) {
      setPreviewSource(cached);
      setFailed(false);
      return;
    }
    if (typeof window === 'undefined' || !window.codesign) return;
    let cancelled = false;
    void readPreviewSourceForCard(design.id, design.updatedAt)
      .then((result) => {
        if (cancelled || !mounted.current) return;
        if (result === null) {
          setPreviewSource(null);
          memCache.delete(key);
          setFailed(!isGenerating);
          return;
        }
        writeCache(key, result);
        setPreviewSource(result);
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled && mounted.current) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, design.id, design.updatedAt, isGenerating]);

  // JSX sources need the React+Babel runtime wrapper; HTML documents render directly.
  const previewSourcePath = previewSource?.path ?? DEFAULT_SOURCE_ENTRY;
  const isJsx = useMemo(
    () => (previewSource ? needsJsxRuntime(previewSource.content, previewSourcePath) : false),
    [previewSource, previewSourcePath],
  );
  const srcDoc = useMemo(() => {
    if (!previewSource) return null;
    const base = buildPreviewDocument(previewSource.content, {
      path: previewSourcePath,
      ...(previewSource.source ? { runtimeMode: previewSource.source.runtimeMode } : {}),
      baseHref: workspaceBaseHrefForPreview(design, previewSourcePath),
    });
    return injectThumbnailStyle(base);
  }, [design, previewSource, previewSourcePath]);

  return (
    <div ref={rootRef} className="absolute inset-0 overflow-hidden bg-white">
      {srcDoc ? (
        // Scale wrapper → iframe strategy: Chromium may defer script execution
        // for iframes with a direct CSS `transform: scale(...)` when the
        // post-transform visible size is tiny (hub thumbnails post-scale look
        // like ~280x211). Putting transform on a PARENT and letting the iframe
        // keep its natural 1280x960 matches PreviewPane's layout and lets the
        // renderer treat the iframe as full-size for execution scheduling.
        <div
          style={{
            width: '1280px',
            height: '960px',
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <iframe
            title={design.name}
            srcDoc={srcDoc}
            sandbox={
              previewSource?.source?.runtimeMode === 'native-html' || isJsx ? 'allow-scripts' : ''
            }
            className="pointer-events-none border-0"
            style={{ width: '1280px', height: '960px' }}
          />
        </div>
      ) : failed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-[var(--space-2)] bg-[var(--color-background-secondary)] text-[var(--color-text-muted)]">
          <Plus className="w-5 h-5 opacity-40" strokeWidth={1.5} aria-hidden />
          <span
            className="text-[15px] italic opacity-70"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Untitled
          </span>
        </div>
      ) : (
        <div className="absolute inset-0 bg-[linear-gradient(110deg,var(--color-background-secondary)_0%,rgba(0,0,0,0.03)_40%,var(--color-background-secondary)_80%)] animate-pulse" />
      )}
    </div>
  );
}
