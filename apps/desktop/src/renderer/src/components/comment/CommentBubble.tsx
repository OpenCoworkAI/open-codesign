import { useT } from '@open-codesign/i18n';
import { Check, LoaderCircle, Send, X } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface CommentBubbleProps {
  anchorFrame?: HTMLIFrameElement | null | undefined;
  selector: string;
  tag: string;
  outerHTML: string;
  rect: { top: number; left: number; width: number; height: number };
  initialText?: string;
  /** Called on every keystroke so the host (PreviewPane) can persist an
   *  unsent draft keyed by anchor id. Without this, switching to a different
   *  chip / element silently discarded the current text. */
  onDraftChange?: (text: string) => void;
  onDismiss: () => void;
  onSaveAndClose: (text: string) => Promise<boolean> | boolean;
  onSaveAndSend: (text: string) => Promise<boolean> | boolean;
}

export function commentKeyAction(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  keyCode?: number;
}): 'send' | 'dismiss' | null {
  if (event.isComposing || event.keyCode === 229) return null;
  if (event.key === 'Escape') return 'dismiss';
  return event.key === 'Enter' && (event.ctrlKey || event.metaKey) ? 'send' : null;
}

export function commentBubblePosition(
  anchor: CommentBubbleProps['rect'],
  bubble: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const below = anchor.top + anchor.height + 8;
  const above = anchor.top - bubble.height - 8;
  return {
    top: Math.max(
      12,
      Math.min(
        below + bubble.height <= viewport.height - 12 || above < 12 ? below : above,
        viewport.height - bubble.height - 12,
      ),
    ),
    left: Math.max(12, Math.min(anchor.left, viewport.width - bubble.width - 12)),
  };
}

export function commentRectInWindow(
  rect: CommentBubbleProps['rect'],
  frame: { top: number; left: number; width: number; height: number },
  viewport: { width: number; height: number },
): CommentBubbleProps['rect'] {
  const scaleX = viewport.width > 0 ? frame.width / viewport.width : 1;
  const scaleY = viewport.height > 0 ? frame.height / viewport.height : 1;
  return {
    top: frame.top + rect.top * scaleY,
    left: frame.left + rect.left * scaleX,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  };
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
  anchorFrame,
  tag,
  outerHTML,
  rect,
  initialText,
  onDraftChange,
  onDismiss,
  onSaveAndClose,
  onSaveAndSend,
}: CommentBubbleProps) {
  const t = useT();
  const [draft, setDraft] = useState(initialText ?? '');
  const [pendingAction, setPendingAction] = useState<'save' | 'send' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const pending = pendingAction !== null;
  const submittingRef = useRef(false);
  const composingRef = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [position, setPosition] = useState({ top: 12, left: 12 });

  useLayoutEffect(() => {
    const updatePosition = () => {
      const anchor = anchorFrame
        ? commentRectInWindow(rect, anchorFrame.getBoundingClientRect(), {
            width: anchorFrame.clientWidth,
            height: anchorFrame.clientHeight,
          })
        : rect;
      const bubble = rootRef.current?.getBoundingClientRect();
      const next = commentBubblePosition(
        anchor,
        { width: bubble?.width ?? 0, height: bubble?.height ?? 0 },
        { width: window.innerWidth, height: window.innerHeight },
      );
      setPosition((previous) =>
        previous.top === next.top && previous.left === next.left ? previous : next,
      );
    };
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition);
    if (rootRef.current) observer?.observe(rootRef.current);
    if (anchorFrame) observer?.observe(anchorFrame);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
      observer?.disconnect();
    };
  }, [anchorFrame, rect]);

  const runAction = useCallback(
    async (action: 'save' | 'send', handler: CommentBubbleProps['onSaveAndClose']) => {
      const text = draft.trim();
      if (!text || submittingRef.current || composingRef.current) return;
      submittingRef.current = true;
      setSaveError(null);
      setPendingAction(action);
      try {
        if ((await handler(text)) === false) setSaveError(t('notifications.commentCreateFailed'));
      } catch (error) {
        console.warn('[CommentBubble] save failed', error);
        setSaveError(
          error instanceof Error ? error.message : t('notifications.commentCreateFailed'),
        );
      } finally {
        submittingRef.current = false;
        setPendingAction(null);
      }
    },
    [draft, t],
  );

  const handleSaveAndClose = useCallback(async () => {
    await runAction('save', onSaveAndClose);
  }, [onSaveAndClose, runAction]);

  const handleSaveAndSend = useCallback(async () => {
    await runAction('send', onSaveAndSend);
  }, [onSaveAndSend, runAction]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (saveError && !pending) textareaRef.current?.focus();
  }, [saveError, pending]);

  const dismiss = useCallback(() => {
    if (submittingRef.current || composingRef.current) return;
    onDismiss();
    if (anchorFrame?.isConnected) anchorFrame.focus();
  }, [onDismiss, anchorFrame]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Keep the app-level Escape shortcut from leaving comment mode or
      // discarding an IME candidate while this composer owns the interaction.
      e.stopPropagation();
      if (composingRef.current || commentKeyAction(e) !== 'dismiss') return;
      e.preventDefault();
      dismiss();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [dismiss]);

  // Truncated element preview — just the tag + key attributes
  const tagPreview = (() => {
    const match = outerHTML.match(/^<(\w+)([^>]{0,60})/);
    if (!match) return `<${tag}>`;
    const attrs = match[2]?.trim();
    return attrs ? `<${match[1]} ${attrs}…>` : `<${match[1]}>`;
  })();

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-labelledby={titleId}
      aria-modal="false"
      aria-busy={pending}
      className="fixed z-[60] w-[min(360px,calc(100vw-24px))] max-h-[calc(100dvh-24px)] overflow-y-auto rounded-[var(--radius-xl)] border border-[var(--color-border-muted)] bg-[var(--color-surface-elevated)] shadow-[var(--shadow-elevated)]"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
    >
      <div className="flex items-center justify-between px-[var(--space-3)] py-[var(--space-2)] border-b border-[var(--color-border-muted)]">
        <span
          id={titleId}
          className="min-w-0 text-[var(--text-sm)] text-[var(--color-text-primary)] truncate"
          title={outerHTML.slice(0, 200)}
        >
          {t('commentBubble.title')} <code>{tagPreview}</code>
        </span>
        <button
          type="button"
          onClick={dismiss}
          disabled={pending}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] disabled:opacity-40"
          aria-label={t('commentBubble.close')}
        >
          <X className="w-[14px] h-[14px]" />
        </button>
      </div>

      <div className="space-y-[var(--space-3)] p-[var(--space-3)]">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            setSaveError(null);
            onDraftChange?.(next);
            const el = e.currentTarget;
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onKeyDown={(e) => {
            if (!composingRef.current && commentKeyAction(e.nativeEvent) === 'send') {
              e.preventDefault();
              e.stopPropagation();
              void handleSaveAndSend();
            }
          }}
          placeholder={t('commentBubble.placeholder')}
          aria-label={t('commentBubble.placeholder')}
          rows={3}
          disabled={pending}
          className="block min-h-[88px] max-h-[160px] w-full resize-none rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--text-sm)] leading-[1.5] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none focus:shadow-[0_0_0_3px_var(--color-focus-ring)]"
        />
        {saveError ? (
          <p
            role="alert"
            className="text-[var(--text-sm)] text-[var(--color-error)] [overflow-wrap:anywhere]"
          >
            {saveError} {t('commentBubble.retryHint')}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-[var(--space-2)]">
          <button
            type="button"
            onClick={() => void handleSaveAndClose()}
            disabled={!draft.trim() || pending}
            className="flex min-h-10 items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--color-border)] px-[var(--space-2)] py-[var(--space-2)] text-[var(--text-sm)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] disabled:opacity-40"
            aria-label={t('commentBubble.saveNote')}
            title={t('commentBubble.saveNote')}
          >
            {pendingAction === 'save' ? (
              <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
            ) : (
              <Check className="h-4 w-4 shrink-0" aria-hidden />
            )}
            {pendingAction === 'save' ? t('commentBubble.saving') : t('commentBubble.saveNote')}
          </button>
          <button
            type="button"
            onClick={() => void handleSaveAndSend()}
            disabled={!draft.trim() || pending}
            className="flex min-h-10 items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--color-accent)] px-[var(--space-2)] py-[var(--space-2)] text-[var(--text-sm)] text-white hover:bg-[var(--color-accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:opacity-40"
            aria-label={t('commentBubble.sendToChat')}
            title={t('commentBubble.sendToChat')}
          >
            {pendingAction === 'send' ? (
              <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
            ) : (
              <Send className="h-4 w-4 shrink-0" aria-hidden />
            )}
            {pendingAction === 'send' ? t('commentBubble.sending') : t('commentBubble.sendToChat')}
          </button>
        </div>
        <div className="flex items-center justify-between gap-[var(--space-2)] text-[var(--text-xs)] text-[var(--color-text-muted)]">
          <span>{t('commentBubble.keyboardHint')}</span>
          <button
            type="button"
            disabled={pending}
            onClick={dismiss}
            className="min-h-8 shrink-0 rounded-[var(--radius-md)] px-[var(--space-2)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] disabled:opacity-40"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
