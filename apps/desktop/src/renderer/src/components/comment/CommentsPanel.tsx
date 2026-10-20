import { useT } from '@open-codesign/i18n';
import type { CommentRow } from '@open-codesign/shared';
import { Send, Trash2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCodesignStore } from '../../store';

export function CommentsPanel() {
  const t = useT();
  const view = useCodesignStore((s) => s.view);
  const interactionMode = useCodesignStore((s) => s.interactionMode);
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const comments = useCodesignStore((s) => s.comments);
  const currentSnapshotId = useCodesignStore((s) => s.currentSnapshotId);
  const setInteractionMode = useCodesignStore((s) => s.setInteractionMode);
  const openCommentBubble = useCodesignStore((s) => s.openCommentBubble);
  const selectCanvasElement = useCodesignStore((s) => s.selectCanvasElement);
  const removeComment = useCodesignStore((s) => s.removeComment);
  const queueCommentForPrompt = useCodesignStore((s) => s.queueCommentForPrompt);
  const queuedCommentIds = useCodesignStore((s) => s.queuedCommentIds);
  const isGenerating = useCodesignStore(
    (s) => s.isGenerating && s.generatingDesignId === s.currentDesignId,
  );

  const active = view === 'workspace' && interactionMode === 'comment' && currentDesignId !== null;
  const [mounted, setMounted] = useState(active);
  const [visible, setVisible] = useState(false);
  const [headerBottom, setHeaderBottom] = useState(64);

  useLayoutEffect(() => {
    if (!mounted) return;
    const header = document.querySelector<HTMLElement>('[data-preview-header]');
    if (!header) return;
    const updatePosition = () => setHeaderBottom(header.getBoundingClientRect().bottom);
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    observer.observe(header);
    // The stage changes height when the app titlebar wraps above this header.
    if (header.parentElement) observer.observe(header.parentElement);
    window.addEventListener('resize', updatePosition);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
    };
  }, [mounted]);

  useEffect(() => {
    if (active) {
      setMounted(true);
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
    const to = setTimeout(() => setMounted(false), 200);
    return () => clearTimeout(to);
  }, [active]);

  if (!mounted) return null;
  if (typeof document === 'undefined') return null;

  const visibleComments = comments.filter((c) => {
    if (c.kind === 'edit' && c.status === 'pending') {
      return c.snapshotId === currentSnapshotId;
    }
    return true;
  });

  function handleOpen(c: CommentRow): void {
    const rect = c.rect;
    selectCanvasElement({
      selector: c.selector,
      tag: c.tag,
      outerHTML: c.outerHTML,
      ...(c.sourcePath ? { sourcePath: c.sourcePath } : {}),
      rect,
    });
    openCommentBubble({
      ...(c.sourcePath ? { sourcePath: c.sourcePath } : {}),
      selector: c.selector,
      tag: c.tag,
      outerHTML: c.outerHTML,
      rect,
      existingCommentId: c.id,
      initialText: c.text,
      ...(c.scope ? { initialScope: c.scope } : {}),
      ...(c.parentOuterHTML ? { parentOuterHTML: c.parentOuterHTML } : {}),
    });
  }

  function handleSend(c: CommentRow): void {
    if (c.kind !== 'edit' || c.status !== 'pending') return;
    queueCommentForPrompt(c.id);
  }

  return createPortal(
    <aside
      aria-label={t('comments.panel.title', { count: visibleComments.length })}
      style={{
        top: `calc(${headerBottom}px + var(--space-4))`,
        maxHeight: `max(0px, calc(100dvh - ${headerBottom}px - 2 * var(--space-4)))`,
        transform: visible ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
        opacity: visible ? 1 : 0,
        transition: 'transform 200ms ease-out, opacity 200ms ease-out',
      }}
      className="fixed right-[16px] z-40 w-[min(340px,calc(100vw-32px))] flex flex-col rounded-[var(--radius-xl)] border border-[var(--color-border-muted)] bg-[var(--color-surface-elevated)] shadow-[var(--shadow-elevated)] overflow-hidden"
    >
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between px-[16px] py-[12px] border-b border-[var(--color-border-muted)]">
        <div className="flex items-baseline gap-[6px]">
          <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
            {t('comments.panel.title', { count: visibleComments.length })}
          </span>
          <span
            className="text-[11px] tabular-nums text-[var(--color-text-muted)]"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {visibleComments.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setInteractionMode('default')}
          aria-label={t('comments.panel.close')}
          className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
        >
          <X className="w-[14px] h-[14px]" aria-hidden />
        </button>
      </header>

      {/* List */}
      <div className="min-h-0 overflow-y-auto">
        {visibleComments.length === 0 ? (
          <p className="px-[16px] py-[24px] text-[12.5px] text-[var(--color-text-muted)] leading-[1.6] text-center">
            {t('comments.panel.empty')}
          </p>
        ) : (
          <ul className="py-[6px]">
            {visibleComments.map((c, i) => (
              <CommentItem
                key={c.id}
                index={i + 1}
                comment={c}
                queued={queuedCommentIds.includes(c.id)}
                onOpen={() => handleOpen(c)}
                onSend={() => handleSend(c)}
                sendDisabled={isGenerating}
                onRemove={() => void removeComment(c.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>,
    document.body,
  );
}

interface CommentItemProps {
  index: number;
  comment: CommentRow;
  queued: boolean;
  onOpen: () => void;
  onSend: () => void;
  sendDisabled: boolean;
  onRemove: () => void;
}

function CommentItem({
  index,
  comment,
  queued,
  onOpen,
  onSend,
  sendDisabled,
  onRemove,
}: CommentItemProps) {
  const t = useT();
  const isEdit = comment.kind === 'edit';
  const isApplied = isEdit && comment.status === 'applied';
  const canSend = isEdit && comment.status === 'pending';
  const summary = comment.text.split('\n')[0] ?? '';

  // Status color — subtle dot indicator
  const statusColor = isApplied
    ? 'var(--color-text-muted)'
    : isEdit
      ? 'var(--color-accent)'
      : '#d4a017'; // warning yellow for notes

  return (
    <li className="flex items-start gap-[var(--space-1)] px-[var(--space-2)]">
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 flex items-start gap-[var(--space-2)] rounded-[var(--radius-md)] px-[var(--space-2)] py-[var(--space-2)] text-left hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
      >
        {/* Index badge */}
        <span
          className="shrink-0 inline-flex items-center justify-center w-[18px] h-[18px] mt-[1px] rounded-full text-[10px] font-semibold leading-none tabular-nums"
          style={{
            backgroundColor: isApplied ? 'transparent' : statusColor,
            border: isApplied ? `1.5px solid ${statusColor}` : 'none',
            color: isApplied ? statusColor : '#fff',
          }}
        >
          {index}
        </span>

        {/* Content — just the comment text, optionally striked when applied */}
        <div className="min-w-0 flex-1">
          <p
            className={`text-[var(--text-sm)] leading-[1.5] line-clamp-3 [overflow-wrap:anywhere] ${
              isApplied
                ? 'text-[var(--color-text-muted)] line-through'
                : 'text-[var(--color-text-primary)]'
            }`}
          >
            {summary || t('comments.panel.untitled')}
          </p>
          <p
            className="mt-[2px] text-[var(--text-xs)] text-[var(--color-text-muted)] truncate"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {comment.sourcePath ? `${comment.sourcePath} · <${comment.tag}>` : `<${comment.tag}>`}
          </p>
        </div>
      </button>

      {canSend ? (
        <button
          type="button"
          onClick={onSend}
          disabled={sendDisabled || queued}
          aria-label={queued ? t('comments.panel.addedToChat') : t('comments.panel.sendToChat')}
          title={queued ? t('comments.panel.addedToChat') : t('comments.panel.sendToChat')}
          className="mt-[var(--space-2)] flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-accent)] hover:bg-[var(--color-surface-active)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] disabled:opacity-40"
        >
          <Send className="w-[13px] h-[13px]" />
        </button>
      ) : null}

      {/* Delete — only on hover */}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('comments.panel.delete')}
        className="mt-[var(--space-2)] flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)] hover:text-[var(--color-error)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
      >
        <Trash2 className="w-[13px] h-[13px]" />
      </button>
    </li>
  );
}
