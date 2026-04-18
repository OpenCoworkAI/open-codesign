import { useT } from '@open-codesign/i18n';
import { Plus } from 'lucide-react';
import { type HubTab, useCodesignStore } from '../store';
import { CreateProjectModal } from './create/CreateProjectModal';
import { DesignSystemsTab } from './hub/DesignSystemsTab';
import { ExamplesTab } from './hub/ExamplesTab';
import { RecentTab } from './hub/RecentTab';
import { YourDesignsTab } from './hub/YourDesignsTab';

const TABS: HubTab[] = ['recent', 'your', 'examples', 'designSystems'];

export interface HubViewProps {
  onUseExamplePrompt?: (prompt: string) => void;
}

export function HubView({ onUseExamplePrompt }: HubViewProps = {}) {
  const t = useT();
  const hubTab = useCodesignStore((s) => s.hubTab);
  const setHubTab = useCodesignStore((s) => s.setHubTab);
  const openCreateProjectModal = useCodesignStore((s) => s.openCreateProjectModal);
  const createProjectModalOpen = useCodesignStore((s) => s.createProjectModalOpen);

  return (
    <div className="h-full flex flex-col bg-[var(--color-background)] overflow-hidden">
      <header className="px-[var(--space-8)] pt-[var(--space-8)] pb-[var(--space-4)] flex items-end justify-between gap-[var(--space-4)] border-b border-[var(--color-border-muted)]">
        <div className="flex items-end gap-[var(--space-8)]">
          <h1
            className="display text-[var(--text-2xl)] leading-[var(--leading-heading)] tracking-[var(--tracking-heading)] text-[var(--color-text-primary)] m-0"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {t('hub.tabs.your')}
          </h1>
          <nav className="flex items-center gap-[var(--space-1)]" aria-label={t('hub.tabs.your')}>
            {TABS.map((tab) => {
              const active = tab === hubTab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setHubTab(tab)}
                  aria-current={active ? 'page' : undefined}
                  className={`px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] text-[var(--text-sm)] transition-colors ${
                    active
                      ? 'bg-[var(--color-surface-active)] text-[var(--color-text-primary)] font-medium'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                  }`}
                >
                  {t(`hub.tabs.${tab}`)}
                </button>
              );
            })}
          </nav>
        </div>
        <button
          type="button"
          onClick={openCreateProjectModal}
          className="inline-flex items-center gap-[var(--space-2)] h-[var(--size-control-md)] px-[var(--space-4)] rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[var(--text-sm)] font-medium shadow-[var(--shadow-soft)] hover:bg-[var(--color-accent-hover)] hover:scale-[var(--scale-hover-up)] active:scale-[var(--scale-press-down)] transition-[transform,background-color] duration-[var(--duration-faster)] ease-[var(--ease-out)]"
        >
          <Plus className="w-[var(--size-icon-md)] h-[var(--size-icon-md)]" strokeWidth={2.4} />
          {t('hub.newDesign')}
        </button>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto px-[var(--space-8)] py-[var(--space-6)]">
        {hubTab === 'recent' ? <RecentTab /> : null}
        {hubTab === 'your' ? <YourDesignsTab /> : null}
        {hubTab === 'examples' ? (
          <ExamplesTab onUsePrompt={(example) => onUseExamplePrompt?.(example.prompt)} />
        ) : null}
        {hubTab === 'designSystems' ? <DesignSystemsTab /> : null}
      </main>

      {createProjectModalOpen ? <CreateProjectModal /> : null}
    </div>
  );
}
