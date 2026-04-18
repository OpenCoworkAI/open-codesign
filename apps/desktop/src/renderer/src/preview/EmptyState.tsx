import { useT } from '@open-codesign/i18n';
import { Sparkles } from 'lucide-react';

export interface EmptyStateProps {
  onPickStarter: (prompt: string) => void;
}

const STARTERS = ['meditationApp', 'pitchDeck', 'caseStudy'] as const;

export function EmptyState({ onPickStarter }: EmptyStateProps) {
  const t = useT();

  return (
    <div className="h-full flex items-center justify-center px-6">
      <div className="text-center max-w-md flex flex-col items-center">
        <div className="relative w-20 h-20 mb-5">
          <div
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-[var(--color-accent-muted)] blur-xl opacity-70"
          />
          <div className="relative w-20 h-20 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center shadow-[var(--shadow-card)]">
            <Sparkles className="w-8 h-8 text-[var(--color-accent)]" />
          </div>
        </div>
        <h2 className="text-[var(--text-lg)] font-semibold text-[var(--color-text-primary)] tracking-[var(--tracking-heading)] mb-2">
          {t('preview.empty.title')}
        </h2>
        <p className="text-[var(--text-sm)] text-[var(--color-text-secondary)] leading-[var(--leading-body)] mb-4">
          {t('preview.empty.body')}
        </p>
        <div className="mb-3 text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
          {t('preview.empty.starterChip')}
        </div>
        <div className="flex flex-wrap gap-2 justify-center">
          {STARTERS.map((starterId) => (
            <button
              key={starterId}
              type="button"
              onClick={() => onPickStarter(t(`demos.${starterId}.prompt`))}
              className="px-3 py-1.5 rounded-[var(--radius-full)] text-[var(--text-xs)] font-medium bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)] transition-colors"
            >
              {t(`demos.${starterId}.title`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
