import { useT } from '@open-codesign/i18n';
import type { CommentRow } from '@open-codesign/shared';
import { Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCodesignStore } from '../../store';

export function CommentsPanel() {
  const t = useT();
  const interactionMode = useCodesignStore((s) => s.interactionMode);
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const comments = useCodesignStore((s) => s.comments);
  const currentSnapshotId = useCodesignStore((s) => s.currentSnapshotId);
  const previewZoom = useCodesignStore((s) => s.previewZoom);
  const setInteractionMode = useCodesignStore((s) => s.setInteractionMode);
  const openCommentBubble = useCodesignStore((s) => s.openCommentBubble);
  const removeComment = useCodesignStore((s) => s.removeComment);
  const designs = useCodesignStore((s) => s.designs);
  const iframeUrlPathByDesign = useCodesignStore((s) => s.iframeUrlPathByDesign);

  const active = interactionMode === 'comment' && currentDesignId !== null;
  const [mounted, setMounted] = useState(active);
  const [visible, setVisible] = useState(false);

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

  const visibleComments = (() => {
    const currentDesign =
      currentDesignId !== null ? designs.find((d) => d.id === currentDesignId) : undefined;
    const isEngineering = currentDesign?.mode === 'engineering';
    const currentIframePath =
      currentDesignId !== null ? iframeUrlPathByDesign[currentDesignId] : undefined;
    if (isEngineering) {
      // Engineering URL-mode comments have snapshotId === null and are
      // scoped by urlPath (matches PinOverlay). Without this branch the
      // panel rendered "0 comments" even when pins were visible because
      // the legacy filter required snapshot match.
      return comments.filter((c) => {
        if (c.snapshotId !== null) return false;
        const stored = c.urlPath;
        if (typeof stored !== 'string' || stored.length === 0) return true;
        if (typeof currentIframePath !== 'string') return true;
        return stored === currentIframePath;
      });
    }
    return comments.filter((c) => {
      if (c.kind === 'edit' && c.status === 'pending') {
        return c.snapshotId === currentSnapshotId;
      }
      return true;
    });
  })();

  function handleOpen(c: CommentRow): void {
    const scale = previewZoom / 100;
    openCommentBubble({
      selector: c.selector,
      tag: c.tag,
      outerHTML: c.outerHTML,
      rect: {
        top: c.rect.top * scale,
        left: c.rect.left * scale,
        width: c.rect.width * scale,
        height: c.rect.height * scale,
      },
      existingCommentId: c.id,
      initialText: c.text,
      ...(c.scope ? { initialScope: c.scope } : {}),
      ...(c.parentOuterHTML ? { parentOuterHTML: c.parentOuterHTML } : {}),
    });
  }

  return createPortal(
    <aside
      aria-label={t('comments.panel.title', { count: visibleComments.length })}
      style={{
        transform: visible ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
        opacity: visible ? 1 : 0,
        transition: 'transform 200ms ease-out, opacity 200ms ease-out',
      }}
      className="fixed top-[80px] right-[16px] z-40 w-[300px] flex flex-col rounded-[14px] border border-[var(--color-border-muted)] bg-[var(--color-surface-elevated)] shadow-[0_12px_40px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)] max-h-[calc(100vh-120px)] overflow-hidden"
    >
      {/* Header */}
      <header className="flex items-center justify-between px-[16px] py-[12px] border-b border-[var(--color-border-muted)]">
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
          className="rounded-full p-[3px] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        >
          <X className="w-[14px] h-[14px]" aria-hidden />
        </button>
      </header>

      {/* List */}
      <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 200px)' }}>
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
                onOpen={() => handleOpen(c)}
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
  onOpen: () => void;
  onRemove: () => void;
}

function CommentItem({ index, comment, onOpen, onRemove }: CommentItemProps) {
  const t = useT();
  const isEdit = comment.kind === 'edit';
  const isApplied = isEdit && comment.status === 'applied';
  const summary = comment.text.split('\n')[0] ?? '';

  // Status color — subtle dot indicator
  const statusColor = isApplied
    ? 'var(--color-text-muted)'
    : isEdit
      ? 'var(--color-accent)'
      : '#d4a017'; // warning yellow for notes

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className="w-full flex items-start gap-[10px] px-[16px] py-[10px] text-left transition-colors hover:bg-[var(--color-surface-hover)]"
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
            className={`text-[13px] leading-[1.4] truncate ${
              isApplied
                ? 'text-[var(--color-text-muted)] line-through'
                : 'text-[var(--color-text-primary)]'
            }`}
          >
            {summary || t('comments.panel.untitled')}
          </p>
          {/* Element tag shown subtle, only when hovered */}
          <p
            className="mt-[2px] text-[10.5px] text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity duration-150 truncate"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {`<${comment.tag}>`}
          </p>
        </div>
      </button>

      {/* Delete — only on hover */}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('comments.panel.delete')}
        className="absolute right-[10px] top-[10px] rounded-md p-[4px] text-[var(--color-text-muted)] opacity-0 transition-opacity hover:bg-[var(--color-surface-active)] hover:text-[var(--color-error,#dc2626)] group-hover:opacity-100 focus:opacity-100"
      >
        <Trash2 className="w-[13px] h-[13px]" />
      </button>
    </li>
  );
}
