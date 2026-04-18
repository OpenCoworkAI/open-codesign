import { useT } from '@open-codesign/i18n';

export interface EmptyStateProps {
  onPickStarter: (prompt: string) => void;
}

interface StarterCard {
  labelKey: string;
  promptKey: string;
}

const STARTER_CARDS: StarterCard[] = [
  {
    labelKey: 'emptyState.starters.landing',
    promptKey: 'starterPrompts.landing',
  },
  {
    labelKey: 'emptyState.starters.pitch',
    promptKey: 'starterPrompts.pitch',
  },
  {
    labelKey: 'emptyState.starters.mobile',
    promptKey: 'starterPrompts.mobile',
  },
  {
    labelKey: 'emptyState.starters.dashboard',
    promptKey: 'starterPrompts.dashboard',
  },
];

export function EmptyState({ onPickStarter }: EmptyStateProps) {
  const t = useT();

  return (
    <div className="h-full flex items-center justify-center px-8 py-12">
      <div className="w-full max-w-xl flex flex-col items-center gap-8">
        {/* Editorial heading block */}
        <div className="text-center space-y-3">
          <h1
            className="text-[var(--font-size-display-xl)] leading-[var(--leading-heading)] tracking-[var(--tracking-heading)] text-[var(--color-text-primary)]"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
          >
            {t('emptyState.heading')}
          </h1>
          <p className="text-[var(--font-size-body-lg)] text-[var(--color-text-secondary)] leading-[var(--leading-body)]">
            {t('emptyState.subline')}
          </p>
        </div>

        {/* 2×2 starter card grid */}
        <div className="w-full grid grid-cols-2 gap-3">
          {STARTER_CARDS.map((card) => (
            <button
              key={card.labelKey}
              type="button"
              onClick={() => onPickStarter(t(card.promptKey))}
              className="
                group text-left
                rounded-[var(--radius-md)] border border-[var(--color-border)]
                bg-[var(--color-background-secondary)]
                px-[var(--space-4)] py-[var(--space-4)]
                hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-elevated)]
                hover:-translate-y-[2px] hover:shadow-[var(--shadow-card)]
                active:translate-y-0 active:shadow-none
                transition-[border-color,background-color,transform,box-shadow]
                duration-[var(--duration-base)] ease-[var(--ease-out)]
              "
            >
              <span
                className="block text-[var(--font-size-body-sm)] font-medium leading-[var(--leading-ui)] text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)]"
                style={{ transition: 'color var(--duration-fast) var(--ease-out)' }}
              >
                {t(card.labelKey)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
