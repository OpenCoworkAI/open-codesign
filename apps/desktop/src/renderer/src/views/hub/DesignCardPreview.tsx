import { buildPreviewDocument, requiresPreviewScripts } from '@open-codesign/runtime';
import type { Design } from '@open-codesign/shared';
import { DEFAULT_SOURCE_ENTRY } from '@open-codesign/shared';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  hasWorkspaceSourceReference,
  inferPreviewSourcePath,
  resolveDesignPreviewSource,
} from '../../preview/workspace-source';

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

// Two-tier cache: in-memory (hot path, survives tab switches in a single
// session) + localStorage (cold start after reopening the app). Keyed on
// designId + updatedAt so a fresh generate invalidates automatically.
const memCache = new Map<string, string>();
const CACHE_VERSION = 'v2';
const LS_PREFIX = `designCardPreview:${CACHE_VERSION}:`;
const LS_MAX_CHARS = 300_000; // ~ 300 KB per entry ceiling; skip caching huge sources
const LS_MAX_ENTRIES = 40;
const MEM_MAX_ENTRIES = 40;

function cacheKey(id: string, updatedAt: string): string {
  return `${CACHE_VERSION}:${id}:${updatedAt}`;
}

// Map preserves insertion order, so delete+set on access makes the eviction
// loop drop the least-recently-used key when the cache overflows.
function memCacheTouch(key: string, value: string): void {
  memCache.delete(key);
  memCache.set(key, value);
  while (memCache.size > MEM_MAX_ENTRIES) {
    const oldest = memCache.keys().next().value;
    if (oldest === undefined) break;
    memCache.delete(oldest);
  }
}

function readCache(key: string): string | null {
  const hit = memCache.get(key);
  if (hit !== undefined) {
    memCacheTouch(key, hit);
    return hit;
  }
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (raw !== null) memCacheTouch(key, raw);
    return raw;
  } catch {
    return null;
  }
}

function writeCache(key: string, source: string): void {
  memCacheTouch(key, source);
  if (typeof localStorage === 'undefined') return;
  if (source.length > LS_MAX_CHARS) return;
  try {
    // Best-effort eviction: if localStorage is near its quota, pruning the
    // oldest preview keys lets the new one fit. We cap total entries, too.
    pruneOldestCacheEntriesIfNeeded();
    localStorage.setItem(LS_PREFIX + key, source);
  } catch {
    // Quota exceeded or storage disabled — ignore, we still have in-memory.
  }
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

export function DesignCardPreview({ design }: DesignCardPreviewProps) {
  const [previewSource, setPreviewSource] = useState<string | null>(() =>
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
      { rootMargin: '240px 0px' },
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
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const h = entry.contentRect.height;
        if (w <= 0 || h <= 0) continue;
        const next = Math.max(w / 1280, h / 960);
        setScale((prev) => (Math.abs(prev - next) > 0.001 ? next : prev));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const key = cacheKey(design.id, design.updatedAt);
    const cached = readCache(key);
    if (cached !== null && !hasWorkspaceSourceReference(cached)) {
      setPreviewSource(cached);
      setFailed(false);
      return;
    }
    if (typeof window === 'undefined' || !window.codesign) return;
    let cancelled = false;
    void resolveDesignPreviewSource({
      designId: design.id,
      read: window.codesign.files?.read,
      listSnapshots: window.codesign.snapshots.list,
    })
      .then((result) => {
        if (cancelled || !mounted.current) return;
        if (result === null) {
          setFailed(true);
          return;
        }
        writeCache(key, result.content);
        setPreviewSource(result.content);
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled && mounted.current) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, design.id, design.updatedAt]);

  // JSX sources need the React+Babel runtime wrapper; HTML documents render directly.
  const previewSourcePath = useMemo(
    () => (previewSource ? inferPreviewSourcePath(previewSource) : DEFAULT_SOURCE_ENTRY),
    [previewSource],
  );
  const isJsx = useMemo(
    () => (previewSource ? needsJsxRuntime(previewSource, previewSourcePath) : false),
    [previewSource, previewSourcePath],
  );
  const srcDoc = useMemo(() => {
    if (!previewSource) return null;
    const base = buildPreviewDocument(previewSource, { path: previewSourcePath });
    return injectThumbnailStyle(base);
  }, [previewSource, previewSourcePath]);

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
            sandbox={isJsx ? 'allow-scripts' : ''}
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
