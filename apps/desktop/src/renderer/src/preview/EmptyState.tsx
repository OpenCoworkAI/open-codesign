import { Sparkles } from 'lucide-react';

export interface EmptyStateProps {
  onPickStarter: (prompt: string) => void;
}

const STARTERS: ReadonlyArray<{ label: string; prompt: string }> = [
  {
    label: 'Mobile meditation app',
    prompt:
      'Design a mobile app prototype for a meditation app called Calm Spaces. Show a phone frame containing a home screen with a meditation list, play button, and progress tracker.',
  },
  {
    label: 'B2B pitch deck',
    prompt:
      'Create a 6-slide B2B SaaS pitch deck for an AI workflow tool. Include problem, solution, market, demo screenshot, traction, and ask.',
  },
  {
    label: 'Case study one-pager',
    prompt:
      'Create a one-page client case study with hero metrics, a CEO quote, and a logo placeholder. Clean, minimal, dark theme.',
  },
];

export function EmptyState({ onPickStarter }: EmptyStateProps) {
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
          A blank canvas, ready when you are.
        </h2>
        <p className="text-[var(--text-sm)] text-[var(--color-text-secondary)] leading-[var(--leading-body)] mb-6">
          Describe what you want to build, or start from one of these:
        </p>
        <div className="flex flex-wrap gap-2 justify-center">
          {STARTERS.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => onPickStarter(s.prompt)}
              className="px-3 py-1.5 rounded-[var(--radius-full)] text-[var(--text-xs)] font-medium bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)] transition-colors"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
