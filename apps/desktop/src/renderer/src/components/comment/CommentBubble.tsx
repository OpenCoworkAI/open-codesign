import { useT } from '@open-codesign/i18n';
import type { ComponentSelection } from '@open-codesign/shared';
import { Send, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface CommentBubbleProps {
  selector: string;
  tag: string;
  outerHTML: string;
  /** Engineering-mode (U9) — when present, the bubble surfaces the React
   *  component name and source path as the primary header instead of the
   *  raw tag preview. Optional so srcdoc / legacy callers stay unchanged. */
  componentSelection?: ComponentSelection | null;
  rect: { top: number; left: number; width: number; height: number };
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

  const anchorTop = Math.max(rect.top + rect.height + 8, 12);
  const anchorLeft = Math.max(rect.left, 12);

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-labelledby={titleId}
      aria-modal="false"
      className="fixed z-[60] w-[min(320px,88vw)] overflow-hidden rounded-2xl border border-[var(--color-border-muted)] bg-[var(--color-surface-elevated)] shadow-[0_8px_32px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)]"
      style={{ top: `${anchorTop}px`, left: `${anchorLeft}px` }}
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
