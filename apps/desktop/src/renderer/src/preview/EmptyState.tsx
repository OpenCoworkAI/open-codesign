export interface EmptyStateProps {
  onPickStarter: (prompt: string) => void;
}

interface StarterCard {
  label: string;
  prompt: string;
}

const STARTER_CARDS: StarterCard[] = [
  {
    label: 'Landing page for an AI startup',
    prompt:
      'Design a modern marketing landing page for an AI startup. Include a bold hero section with tagline, three feature cards, social proof section, and a primary CTA. Use a warm neutral palette with confident typography.',
  },
  {
    label: 'Pitch deck — first 3 slides',
    prompt:
      'Design the first 3 slides of a startup pitch deck: (1) cover with company name and tagline, (2) problem slide with headline stat, (3) solution overview with product screenshot placeholder. Clean, investor-ready.',
  },
  {
    label: 'Mobile app onboarding (3 screens)',
    prompt:
      'Design 3 mobile onboarding screens shown in a phone frame: welcome splash, key benefit highlight, and permission request. Soft palette, generous white space, progress dots at bottom.',
  },
  {
    label: 'Data dashboard with 3 charts',
    prompt:
      'Design a data analytics dashboard with a top KPI strip (4 metrics) and 3 charts: a line chart for trend, a bar chart for comparison, and a donut chart for composition. Dark mode, dense but readable.',
  },
];

export function EmptyState({ onPickStarter }: EmptyStateProps) {
  return (
    <div className="h-full flex items-center justify-center px-8 py-12">
      <div className="w-full max-w-xl flex flex-col items-center gap-8">
        {/* Editorial heading block */}
        <div className="text-center space-y-3">
          <h1
            className="text-[var(--font-size-display-xl)] leading-[var(--leading-heading)] tracking-[var(--tracking-heading)] text-[var(--color-text-primary)]"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
          >
            Design with intent.
          </h1>
          <p className="text-[var(--font-size-body-lg)] text-[var(--color-text-secondary)] leading-[var(--leading-body)]">
            Describe what you want. Iterate with comments.
          </p>
        </div>

        {/* 2×2 starter card grid */}
        <div className="w-full grid grid-cols-2 gap-3">
          {STARTER_CARDS.map((card) => (
            <button
              key={card.label}
              type="button"
              onClick={() => onPickStarter(card.prompt)}
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
                {card.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
