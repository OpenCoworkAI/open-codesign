import { useT } from '@open-codesign/i18n';
import type { SelectedElement } from '@open-codesign/shared';
import { MessageSquareText, X } from 'lucide-react';
import { useState } from 'react';
import { useCodesignStore } from '../store';

export function InlineCommentComposer() {
  const selectedElement = useCodesignStore((s) => s.selectedElement);
  if (!selectedElement) return null;
  return (
    <InlineCommentComposerCard key={selectedElement.selector} selectedElement={selectedElement} />
  );
}

interface InlineCommentComposerCardProps {
  selectedElement: SelectedElement;
}

function InlineCommentComposerCard({ selectedElement }: InlineCommentComposerCardProps) {
  const t = useT();
  const clearCanvasElement = useCodesignStore((s) => s.clearCanvasElement);
  const applyInlineComment = useCodesignStore((s) => s.applyInlineComment);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const [draft, setDraft] = useState('');

  return (
    <div className="absolute bottom-10 right-10 z-10 w-[min(420px,calc(100%-3rem))] overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-elevated)]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border-muted)] px-4 py-3">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 text-[12px] font-medium text-[var(--color-text-primary)]">
            <MessageSquareText className="h-4 w-4 text-[var(--color-accent)]" />
            {t('inlineComment.title')} <code className="text-[11px]">{selectedElement.tag}</code>
          </div>
          <p
            className="mt-1 truncate text-[11px] text-[var(--color-text-muted)]"
            title={selectedElement.selector}
          >
            {selectedElement.selector}
          </p>
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
        <p className="text-[12px] leading-[1.5] text-[var(--color-text-secondary)]">
          {t('inlineComment.description')}
        </p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('inlineComment.placeholder')}
          rows={4}
          disabled={isGenerating}
          className="w-full resize-none rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-[13px] leading-[1.5] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] transition-[box-shadow,border-color] duration-150 focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-focus-ring)] focus:outline-none"
        />
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={clearCanvasElement}
            className="text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!draft.trim() || isGenerating}
            onClick={() => void applyInlineComment(draft)}
            className="inline-flex items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent)] px-3 py-2 text-[12px] font-medium text-white shadow-[var(--shadow-soft)] transition-colors hover:bg-[var(--color-accent-hover)] disabled:pointer-events-none disabled:opacity-40"
          >
            {isGenerating ? t('inlineComment.applying') : t('inlineComment.applyChange')}
          </button>
        </div>
      </div>
    </div>
  );
}
