import { useT } from '@open-codesign/i18n';
import type { Project } from '@open-codesign/shared';
import { useCodesignStore } from '../../store';

export interface ProjectGridProps {
  projects: Project[];
  emptyLabel: string;
}

export function ProjectGrid({ projects, emptyLabel }: ProjectGridProps) {
  const t = useT();
  const openProject = useCodesignStore((s) => s.openProject);

  if (projects.length === 0) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-text-muted)] leading-[var(--leading-body)] max-w-[var(--size-prose-narrow)]">
        {emptyLabel}
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(var(--size-card-min),1fr))] gap-[var(--space-4)] list-none p-0 m-0">
      {projects.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            onClick={() => openProject(p.id)}
            aria-label={t('hub.your.openAria', { name: p.name })}
            className="group w-full text-left flex flex-col rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)] hover:shadow-[var(--shadow-card)] hover:border-[var(--color-border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] transition-[box-shadow,border-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:-translate-y-[var(--lift-card-hover)]"
          >
            <div className="aspect-[4/3] rounded-t-[var(--radius-xl)] bg-[var(--color-background-secondary)] border-b border-[var(--color-border-subtle)] flex items-center justify-center text-[var(--color-text-muted)] text-[var(--text-xs)] uppercase tracking-[var(--tracking-label)]">
              {t(`hub.card.type.${p.type}`)}
            </div>
            <div className="p-[var(--space-4)] space-y-[var(--space-1)]">
              <div className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)] truncate">
                {p.name}
              </div>
              <div className="text-[var(--text-xs)] text-[var(--color-text-muted)]">
                {t('hub.card.createdAt', {
                  date: new Date(p.createdAt).toLocaleDateString(),
                })}
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
