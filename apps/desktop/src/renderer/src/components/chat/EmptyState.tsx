import { useT } from '@open-codesign/i18n';
import { ArrowUpRight } from 'lucide-react';

interface StarterCard {
  labelKey: string;
  descKey: string;
  promptKey: string;
}

const STARTER_CARDS: StarterCard[] = [
  {
    labelKey: 'emptyState.starters.landing',
    descKey: 'emptyState.starterDesc.landing',
    promptKey: 'starterPrompts.landing',
  },
  {
    labelKey: 'emptyState.starters.dashboard',
    descKey: 'emptyState.starterDesc.dashboard',
    promptKey: 'starterPrompts.dashboard',
  },
  {
    labelKey: 'emptyState.starters.mobile',
    descKey: 'emptyState.starterDesc.mobile',
    promptKey: 'starterPrompts.mobile',
  },
];

export interface EmptyStateProps {
  onPickStarter: (prompt: string) => void;
}

export function EmptyState({ onPickStarter }: EmptyStateProps) {
  const t = useT();
  return (
    <div className="h-full flex flex-col items-center justify-center px-[var(--space-2)] py-[var(--space-8)]">
      <div className="w-full max-w-[320px] flex flex-col items-center text-center">
        <h2 className="text-[var(--text-lg)] font-semibold leading-[var(--leading-heading)] tracking-[var(--tracking-normal)] text-[var(--color-text-primary)]">
          {t('sidebar.empty.title')}
        </h2>
        <p className="mt-[var(--space-2)] text-[var(--text-sm)] text-[var(--color-text-secondary)] leading-[var(--leading-body)]">
          {t('sidebar.empty.subtitle')}
        </p>

        <div
          className="mt-[var(--space-6)] mb-[var(--space-2_5)] text-[10px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] self-start pl-[var(--space-1)]"
          aria-hidden
        >
          {t('sidebar.empty.eyebrow')}
        </div>

        <div className="w-full flex flex-col gap-[var(--space-1_5)]">
          {STARTER_CARDS.map((card) => (
            <button
              key={card.labelKey}
              type="button"
              onClick={() => onPickStarter(t(card.promptKey))}
              className="group w-full text-left rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-[var(--space-3)] py-[var(--space-2_5)] hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-hover)] transition-colors duration-[var(--duration-faster)] ease-[var(--ease-out)]"
            >
              <div className="flex items-start gap-[var(--space-2)]">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-[var(--color-text-primary)] truncate">
                    {t(card.labelKey)}
                  </div>
                  <div className="text-[11.5px] text-[var(--color-text-muted)] truncate mt-[2px]">
                    {t(card.descKey)}
                  </div>
                </div>
                <ArrowUpRight
                  className="w-[14px] h-[14px] text-[var(--color-text-muted)] shrink-0 mt-[2px] opacity-0 -translate-x-0.5 group-hover:opacity-100 group-hover:translate-x-0 group-hover:text-[var(--color-accent)] transition-all duration-[var(--duration-faster)] ease-[var(--ease-out)]"
                  strokeWidth={2}
                  aria-hidden
                />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
