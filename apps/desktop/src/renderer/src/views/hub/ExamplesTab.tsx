import { getCurrentLocale, useT, useTranslation } from '@open-codesign/i18n';
import { type ExampleCategory, getExamples, type LocalizedExample } from '@open-codesign/templates';
import { useMemo, useState } from 'react';
import { ExampleCard } from './ExampleCard';

export interface ExamplesTabProps {
  /**
   * Called with the chosen example so the host (composer / hub) can fill the
   * prompt input and switch back to the workspace. PR-A wires this up; until
   * then PR-B can plug in any handler (App.tsx, Storybook, tests).
   */
  onUsePrompt: (example: LocalizedExample) => void;
}

type CategoryFilter = 'all' | ExampleCategory;

const FILTERS: CategoryFilter[] = [
  'all',
  'animation',
  'ui',
  'marketing',
  'document',
  'dashboard',
  'presentation',
  'email',
  'mobile',
];

/**
 * Top-level "Examples" hub tab.
 *
 * Self-contained: no store reads, no IPC. The only side effect is the
 * `onUsePrompt` callback. This makes the tab trivial to test and lets PR-A
 * mount it inside `HubView` without any wiring beyond a single prop.
 */
export function ExamplesTab({ onUsePrompt }: ExamplesTabProps) {
  const t = useT();
  const { i18n } = useTranslation();
  const [filter, setFilter] = useState<CategoryFilter>('all');

  const examples = useMemo(() => getExamples(i18n.language || getCurrentLocale()), [i18n.language]);

  const visible = filter === 'all' ? examples : examples.filter((e) => e.category === filter);

  return (
    <section className="flex flex-col gap-[var(--space-6)]">
      <header className="flex flex-col gap-[var(--space-2)]">
        <h1
          className="text-[var(--font-size-display-lg)] leading-[var(--leading-heading)] tracking-[var(--tracking-heading)] text-[var(--color-text-primary)]"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
        >
          {t('examples.title')}
        </h1>
        <p className="max-w-2xl text-[var(--font-size-body)] leading-[var(--leading-body)] text-[var(--color-text-secondary)]">
          {t('examples.subtitle')}
        </p>
      </header>

      <div
        role="tablist"
        aria-label={t('examples.title')}
        className="flex flex-wrap gap-[var(--space-2)]"
      >
        {FILTERS.map((id) => {
          const active = id === filter;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              type="button"
              onClick={() => setFilter(id)}
              className={`
                rounded-full border px-[var(--space-3)] py-[var(--space-1)]
                text-[var(--font-size-body-sm)] leading-[var(--leading-ui)]
                transition-[border-color,background-color,color]
                duration-[var(--duration-fast)] ease-[var(--ease-out)]
                ${
                  active
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-background)]'
                    : 'border-[var(--color-border)] bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)]'
                }
              `}
            >
              {t(`examples.categories.${id}`)}
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-[var(--space-4)] py-[var(--space-6)] text-center text-[var(--font-size-body-sm)] text-[var(--color-text-muted)]">
          {t('examples.empty')}
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-[var(--space-4)]">
          {visible.map((example) => (
            <ExampleCard key={example.id} example={example} onUsePrompt={onUsePrompt} />
          ))}
        </div>
      )}
    </section>
  );
}
