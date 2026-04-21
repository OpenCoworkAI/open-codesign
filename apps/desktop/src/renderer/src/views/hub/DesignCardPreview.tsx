import { buildSrcdoc } from '@open-codesign/runtime';
import type { Design } from '@open-codesign/shared';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

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

// Lightweight JSX detection — mirrors runtime's isJsxArtifact without importing it.
// JSX markers take priority over HTML tags: our agent always emits
// `EDITMODE-BEGIN` (and often `ReactDOM.createRoot`) in JSX artifacts, and the
// JSX body itself commonly includes `<html>`/`<head>` tags inside a
// `function App(){ return <html>...</html> }` return. Checking HTML first made
// every JSX thumbnail render as raw source text in the hub grid.
export function needsJsxRuntime(source: string): boolean {
  const hasJsxMarker =
    /EDITMODE-BEGIN/.test(source) ||
    /ReactDOM\.createRoot\s*\(/.test(source) ||
    /^\s*function\s+App\s*\(/m.test(source);
  if (hasJsxMarker) return true;
  if (/<!doctype/i.test(source) || /<html[^>]*>/i.test(source)) return false;
  return false;
}

export interface DesignCardPreviewProps {
  design: Design;
}

// Two-tier cache: in-memory (hot path, survives tab switches in a single
// session) + localStorage (cold start after reopening the app). Keyed on
// designId + updatedAt so a fresh generate invalidates automatically.
const memCache = new Map<string, string>();
const LS_PREFIX = 'designCardPreview:';
const LS_MAX_CHARS = 300_000; // ~ 300 KB per entry ceiling; skip caching huge HTML
const LS_MAX_ENTRIES = 40;
const MEM_MAX_ENTRIES = 40;

function cacheKey(id: string, updatedAt: string): string {
  return `${id}:${updatedAt}`;
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

function writeCache(key: string, html: string): void {
  memCacheTouch(key, html);
  if (typeof localStorage === 'undefined') return;
  if (html.length > LS_MAX_CHARS) return;
  try {
    // Best-effort eviction: if localStorage is near its quota, pruning the
    // oldest preview keys lets the new one fit. We cap total entries, too.
    pruneOldestCacheEntriesIfNeeded();
    localStorage.setItem(LS_PREFIX + key, html);
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
  const [html, setHtml] = useState<string | null>(() =>
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
    if (cached !== null) {
      setHtml(cached);
      setFailed(false);
      return;
    }
    if (typeof window === 'undefined' || !window.codesign) return;
    let cancelled = false;
    void window.codesign.snapshots
      .list(design.id)
      .then((snaps) => {
        if (cancelled || !mounted.current) return;
        const latest = snaps[0];
        const source = latest?.artifactSource ?? '';
        if (source.trim().length === 0) {
          setFailed(true);
          return;
        }
        writeCache(key, source);
        setHtml(source);
      })
      .catch(() => {
        if (!cancelled && mounted.current) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, design.id, design.updatedAt]);

  // JSX artifacts need the React+Babel runtime wrapper; HTML artifacts render directly.
  const isJsx = useMemo(() => (html ? needsJsxRuntime(html) : false), [html]);
  const srcDoc = useMemo(() => {
    if (!html) return null;
    const base = isJsx ? buildSrcdoc(html) : html;
    return injectThumbnailStyle(base);
  }, [html, isJsx]);

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
