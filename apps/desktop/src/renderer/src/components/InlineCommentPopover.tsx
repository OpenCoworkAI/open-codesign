import { useT } from '@open-codesign/i18n';
import type { ElementSelectionRect, SelectedElement } from '@open-codesign/shared';
import { Loader2, MessageSquareText, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getElementLabel } from '../lib/element-label';
import { useCodesignStore } from '../store';

const POPOVER_WIDTH = 360;
const POPOVER_GAP = 8;
const FALLBACK_HEIGHT = 220;

export function InlineCommentPopover() {
  const selectedElement = useCodesignStore((s) => s.selectedElement);
  if (!selectedElement) return null;
  return (
    <InlineCommentPopoverCard key={selectedElement.selector} selectedElement={selectedElement} />
  );
}

interface InlineCommentPopoverCardProps {
  selectedElement: SelectedElement;
}

function InlineCommentPopoverCard({ selectedElement }: InlineCommentPopoverCardProps) {
  const t = useT();
  const clearCanvasElement = useCodesignStore((s) => s.clearCanvasElement);
  const applyInlineComment = useCodesignStore((s) => s.applyInlineComment);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const [draft, setDraft] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [position, setPosition] = useState(() =>
    computeAnchoredPosition(selectedElement.rect, FALLBACK_HEIGHT, null, null),
  );

  const label = getElementLabel(selectedElement);
  const busy = isGenerating && submitted;

  useLayoutEffect(() => {
    const containerRect = cardRef.current?.parentElement?.getBoundingClientRect() ?? null;
    const containerHeight = containerRect?.height ?? null;
    const containerWidth = containerRect?.width ?? null;
    const cardHeight = cardRef.current?.offsetHeight ?? FALLBACK_HEIGHT;
    setPosition(
      computeAnchoredPosition(selectedElement.rect, cardHeight, containerHeight, containerWidth),
    );
    // Focus the textarea after mount; using a ref+effect avoids the biome
    // a11y/noAutofocus rule while preserving the keyboard-first feel.
    textareaRef.current?.focus();
  }, [selectedElement.rect]);

  useEffect(() => {
    if (!busy && submitted && !isGenerating) {
      // Apply succeeded — close. (If apply failed, applyInlineComment surfaces a
      // toast and selection clears; either way we close.)
      clearCanvasElement();
    }
  }, [busy, submitted, isGenerating, clearCanvasElement]);

  function handleSubmit(): void {
    if (!draft.trim() || isGenerating) return;
    setSubmitted(true);
    void applyInlineComment(draft);
  }

  return (
    <section
      ref={cardRef}
      className="absolute z-10 w-[360px] max-w-[calc(100%-3rem)] overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-elevated)]"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      aria-label={t('comment.target', { target: label.display })}
    >
      <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border-muted)] px-4 py-3">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 text-[12px] font-medium text-[var(--color-text-primary)]">
            <MessageSquareText className="h-4 w-4 text-[var(--color-accent)]" />
            <span className="truncate" title={label.display}>
              {t('comment.target', { target: label.display })}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={clearCanvasElement}
          className="rounded-[var(--radius-md)] p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          aria-label={t('inlineComment.closeComposer')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3 p-4">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('inlineComment.placeholder')}
          rows={3}
          disabled={busy}
          className="w-full resize-none rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-[13px] leading-[1.5] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] transition-[box-shadow,border-color] duration-150 focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-focus-ring)] focus:outline-none disabled:bg-[var(--color-surface-hover)] disabled:text-[var(--color-text-muted)]"
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={clearCanvasElement}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-[var(--radius-md)] px-3 py-2 text-[12px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-60 disabled:pointer-events-none transition-colors"
          >
            {t('comment.cancel')}
          </button>
          <button
            type="button"
            disabled={!draft.trim() || busy}
            onClick={handleSubmit}
            className="inline-flex items-center justify-center gap-1.5 min-w-[112px] rounded-[var(--radius-md)] bg-[var(--color-accent)] px-3 py-2 text-[12px] font-medium text-white shadow-[var(--shadow-soft)] transition-colors hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-text-muted)] disabled:text-white disabled:pointer-events-none"
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                <span>{t('comment.applyButtonBusy')}</span>
              </>
            ) : (
              <span>{t('comment.applyButton')}</span>
            )}
          </button>
        </div>
      </div>
    </section>
  );
}

interface AnchoredPosition {
  top: number;
  left: number;
}

/**
 * Compute popover position anchored to the clicked element rect.
 *
 * The popover renders inside the `.relative` container that wraps the
 * preview iframe; coordinates are local to that container. We place the
 * popover below the element when there is room, otherwise above. Horizontal
 * position centres on the element with a left/right safe margin and clamps
 * against the container's right edge so the card never overflows the viewport.
 */
export function computeAnchoredPosition(
  rect: ElementSelectionRect,
  cardHeight: number,
  containerHeight: number | null,
  containerWidth: number | null,
): AnchoredPosition {
  const elementBottom = rect.top + rect.height;
  const flipBelowToAbove =
    containerHeight !== null && elementBottom + cardHeight + POPOVER_GAP > containerHeight;
  const top = flipBelowToAbove
    ? Math.max(POPOVER_GAP, rect.top - cardHeight - POPOVER_GAP)
    : elementBottom + POPOVER_GAP;
  const desiredLeft = rect.left + rect.width / 2 - POPOVER_WIDTH / 2;
  const maxLeft =
    containerWidth === null
      ? Number.POSITIVE_INFINITY
      : Math.max(POPOVER_GAP, containerWidth - POPOVER_WIDTH - POPOVER_GAP);
  const left = Math.min(maxLeft, Math.max(POPOVER_GAP, desiredLeft));
  return { top, left };
}
