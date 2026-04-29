import { useT } from '@open-codesign/i18n';
import type { ComponentSelection } from '@open-codesign/shared';
import { Send, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface CommentBubbleProps {
  selector: string;
  tag: string;
  outerHTML: string;
  /** Engineering-mode (U9) — when present, the bubble surfaces the React
   *  component name and source path as the primary header instead of the
   *  raw tag preview. Optional so srcdoc / legacy callers stay unchanged. */
  componentSelection?: ComponentSelection | null;
  /** Iframe-relative, zoom-scaled rect of the anchored element. CommentBubble
   *  combines this with the iframe's window position to produce window-coord
   *  placement, so the bubble follows the element across page/iframe scroll
   *  and stays inside the visible viewport. */
  rect: { top: number; left: number; width: number; height: number };
  /** Ref to the preview iframe — its bounding rect supplies the offset that
   *  turns iframe-relative `rect` into window coords. Without it the bubble
   *  would render at iframe-relative coords inside `position: fixed` and
   *  drift wildly when the iframe is offset by sidebar/topbar/zoom.
   *  Optional only so existing tests / non-iframe callers stay valid; in
   *  that case the bubble falls back to treating `rect` as window-coords. */
  iframeRef?: React.RefObject<HTMLIFrameElement | null>;
  initialText?: string;
  /** Called on every keystroke so the host (PreviewPane) can persist an
   *  unsent draft keyed by anchor id. Without this, switching to a different
   *  chip / element silently discarded the current text. */
  onDraftChange?: (text: string) => void;
  onClose: () => void;
  onSendToClaude: (text: string) => Promise<void> | void;
}

/** English fallback text for each quick action id — sent to the LLM. */
export const QUICK_ACTION_TEXT: Readonly<Record<string, string>> = {
  'spacing-more': 'increase spacing on this element',
  'spacing-less': 'tighten spacing on this element',
  'contrast-more': 'increase color contrast',
  'contrast-less': 'soften the color contrast',
  'font-bigger': 'increase font size on this element',
  'font-smaller': 'decrease font size on this element',
  'radius-more': 'make corners more rounded',
  'radius-less': 'make corners sharper',
};

export function CommentBubble({
  tag,
  outerHTML,
  componentSelection,
  rect,
  iframeRef,
  initialText,
  onDraftChange,
  onClose,
  onSendToClaude,
}: CommentBubbleProps) {
  const t = useT();
  const [draft, setDraft] = useState(initialText ?? '');
  const [pending, setPending] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    // Esc + the × button are the only ways to close. The previous mousedown-
    // outside handler silently discarded the user's draft whenever they
    // clicked surrounding UI (toolbar, sidebar, preview) — the single most
    // frustrating failure mode. Explicit close mirrors how chat / dialog UIs
    // treat in-progress text.
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  async function handleSubmit() {
    const text = draft.trim();
    if (!text || pending) return;
    setPending(true);
    try {
      await onSendToClaude(text);
    } finally {
      setPending(false);
    }
  }

  // Truncated element preview — just the tag + key attributes
  const tagPreview = (() => {
    const match = outerHTML.match(/^<(\w+)([^>]{0,60})/);
    if (!match) return `<${tag}>`;
    const attrs = match[2]?.trim();
    return attrs ? `<${match[1]} ${attrs}…>` : `<${match[1]}>`;
  })();

  // U9: when the React inspector resolved a fiber, prefer
  // `<ComponentName>` (+ relative file path) over the raw HTML preview.
  // Falls through to `tagPreview` when no metadata is available.
  const componentHeader = componentSelection
    ? {
        primary: `<${componentSelection.componentName}>`,
        secondary: componentSelection.filePath ?? componentSelection.debugSource?.fileName ?? null,
        title:
          componentSelection.ownerChain.length > 0
            ? `${componentSelection.componentName} ← ${componentSelection.ownerChain.join(' ← ')}`
            : componentSelection.componentName,
      }
    : null;

  // Render off-screen on the very first paint, then snap to the clamped
  // window-coord position once the layout effect has run. This avoids a
  // flash at iframe-relative coords (which is wrong: bubble is
  // `position: fixed` and the iframe is offset by sidebar/topbar/zoom).
  const [pos, setPos] = useState<{ top: number; left: number; ready: boolean }>({
    top: -9999,
    left: -9999,
    ready: false,
  });

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const margin = 12;
    let rafHandle = 0;
    function clamp() {
      const node = rootRef.current;
      if (!node) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = node.offsetWidth;
      const h = node.offsetHeight;
      // Translate iframe-relative rect → window-coord rect. iframe rect can
      // shift on outer-pane scroll, window resize, viewport switch, or zoom.
      const iframe = iframeRef?.current;
      const off = iframe?.getBoundingClientRect();
      const offsetTop = off?.top ?? 0;
      const offsetLeft = off?.left ?? 0;
      const elTop = rect.top + offsetTop;
      const elLeft = rect.left + offsetLeft;
      // Vertical: prefer below the element; flip above if it would overflow
      // the bottom AND there's more room above. Hard-clamp into viewport.
      let top = elTop + rect.height + 8;
      const overflowsBottom = top + h > vh - margin;
      const roomAbove = elTop - 8 - margin;
      if (overflowsBottom && roomAbove >= h) {
        top = elTop - h - 8;
      }
      top = Math.min(Math.max(top, margin), Math.max(margin, vh - h - margin));
      // Horizontal: prefer left-aligned with the element; clamp into viewport.
      let left = elLeft;
      left = Math.min(Math.max(left, margin), Math.max(margin, vw - w - margin));
      setPos((prev) =>
        prev.ready && prev.top === top && prev.left === left ? prev : { top, left, ready: true },
      );
    }
    function scheduleClamp() {
      if (rafHandle) return;
      rafHandle = window.requestAnimationFrame(() => {
        rafHandle = 0;
        clamp();
      });
    }
    clamp();
    // Capture-phase scroll catches scrolls inside any nested overflow
    // container (preview pane, sidebar) — without `capture: true` the
    // scroll event never reaches window for inner scrollers.
    window.addEventListener('scroll', scheduleClamp, true);
    window.addEventListener('resize', scheduleClamp);
    // Re-clamp whenever the bubble itself grows or shrinks (textarea
    // auto-resize on user input). Without this, typing past one line could
    // push the bubble off the bottom of the viewport.
    const ro = new ResizeObserver(scheduleClamp);
    ro.observe(el);
    const iframe = iframeRef?.current;
    if (iframe) ro.observe(iframe);
    return () => {
      if (rafHandle) cancelAnimationFrame(rafHandle);
      window.removeEventListener('scroll', scheduleClamp, true);
      window.removeEventListener('resize', scheduleClamp);
      ro.disconnect();
    };
  }, [rect.top, rect.left, rect.height, iframeRef]);

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-labelledby={titleId}
      aria-modal="false"
      className="fixed z-[60] w-[min(320px,88vw)] overflow-hidden rounded-2xl border border-[var(--color-border-muted)] bg-[var(--color-surface-elevated)] shadow-[0_8px_32px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)]"
      style={{
        top: `${pos.top}px`,
        left: `${pos.left}px`,
        visibility: pos.ready ? 'visible' : 'hidden',
      }}
    >
      {/* Header — selected element + close */}
      <div className="flex items-center justify-between px-[var(--space-3)] py-[var(--space-2)] border-b border-[var(--color-border-muted)]">
        {componentHeader ? (
          <span
            id={titleId}
            className="flex min-w-0 flex-col text-[var(--color-text-muted)]"
            title={componentHeader.title}
          >
            <span className="truncate font-[var(--font-mono),ui-monospace,Menlo,monospace] text-[11px] text-[var(--color-text-primary)]">
              {componentHeader.primary}
            </span>
            {componentHeader.secondary !== null && componentHeader.secondary.length > 0 ? (
              <span className="truncate font-[var(--font-mono),ui-monospace,Menlo,monospace] text-[10px]">
                {componentHeader.secondary}
              </span>
            ) : null}
          </span>
        ) : (
          <span
            id={titleId}
            className="font-[var(--font-mono),ui-monospace,Menlo,monospace] text-[11px] text-[var(--color-text-muted)] truncate"
            title={outerHTML.slice(0, 200)}
          >
            {tagPreview}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-[3px] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          aria-label={t('commentBubble.close')}
        >
          <X className="w-[14px] h-[14px]" />
        </button>
      </div>

      {/* Input + submit */}
      <div className="p-[var(--space-3)]">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              const next = e.target.value;
              setDraft(next);
              onDraftChange?.(next);
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder={t('commentBubble.placeholder')}
            rows={2}
            disabled={pending}
            className="block w-full resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] px-[var(--space-3)] py-[var(--space-2)] pr-[40px] text-[13px] leading-[1.5] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none focus:shadow-[0_0_0_3px_var(--color-focus-ring)] transition-[border-color,box-shadow] duration-150"
          />
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!draft.trim() || pending}
            className="absolute right-[8px] bottom-[8px] rounded-lg bg-[var(--color-accent)] p-[6px] text-white shadow-sm transition-all duration-150 hover:bg-[var(--color-accent-hover)] hover:shadow-md active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
            aria-label={t('commentBubble.sendToClaude')}
          >
            <Send className="w-[14px] h-[14px]" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
