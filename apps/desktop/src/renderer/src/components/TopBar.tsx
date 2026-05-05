import { useT } from '@open-codesign/i18n';
import { IconButton, Wordmark } from '@open-codesign/ui';
import { AlertCircle, ArrowLeft, FolderOpen, Settings as SettingsIcon } from 'lucide-react';
import { type CSSProperties, useEffect } from 'react';
import { type HubTab, useCodesignStore } from '../store';
import { LanguageToggle } from './LanguageToggle';
import { ModelSwitcher } from './ModelSwitcher';
import { ThemeToggle } from './ThemeToggle';

export const TOPBAR_DRAG_SPACER_TEST_ID = 'topbar-drag-spacer';

export const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
export const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

const HUB_TABS: HubTab[] = ['recent', 'your', 'examples', 'designSystems'];

const topbarButtonClass =
  'inline-flex h-9 items-center rounded-[var(--radius-sm)] px-[var(--space-2_5)] text-[var(--text-sm)] leading-none whitespace-nowrap transition-colors duration-[var(--duration-faster)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]';

export function TopBar() {
  const t = useT();
  const setView = useCodesignStore((s) => s.setView);
  const view = useCodesignStore((s) => s.view);
  const previousView = useCodesignStore((s) => s.previousView);
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const designs = useCodesignStore((s) => s.designs);
  const currentDesign = designs.find((d) => d.id === currentDesignId);
  const hubTab = useCodesignStore((s) => s.hubTab);
  const setHubTab = useCodesignStore((s) => s.setHubTab);
  const unreadErrorCount = useCodesignStore((s) => s.unreadErrorCount);
  const refreshDiagnosticEvents = useCodesignStore((s) => s.refreshDiagnosticEvents);
  const openSettingsTab = useCodesignStore((s) => s.openSettingsTab);

  // Pull-based: refresh the diagnostic counter on mount so a page reload
  // surfaces errors recorded while the window was closed. No polling.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect
  useEffect(() => {
    void refreshDiagnosticEvents();
  }, []);

  return (
    <header
      className="h-[var(--size-titlebar-height)] shrink-0 flex items-center gap-[var(--space-3)] pr-[var(--space-5)] select-none"
      style={{
        ...dragStyle,
        paddingLeft: 'var(--size-titlebar-pad-left)',
        borderBottom: '1px solid oklch(0.22 0.025 50 / 0.08)',
        background: 'var(--color-background)',
      }}
    >
      <div className="flex items-center gap-[var(--space-6)] min-w-0 h-full">
        <div className="shrink-0">
          <Wordmark badge={`v${__APP_VERSION__}`} size="titlebar" />
        </div>

        {view === 'settings' ? (
          <div className="flex items-center gap-[var(--space-2)] min-w-0">
            <span style={{ color: 'oklch(0.22 0.025 50 / 0.2)' }}>/</span>
            <button
              type="button"
              onClick={() => setView(previousView === 'settings' ? 'hub' : previousView)}
              aria-label={t('topbar.closeSettings')}
              className={`${topbarButtonClass} gap-[6px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]`}
              style={{
                ...noDragStyle,
              }}
            >
              <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden />
              <span className="truncate">{t('topbar.settingsLabel')}</span>
            </button>
          </div>
        ) : view === 'hub' ? (
          <nav
            className="flex h-full min-w-max items-center gap-[var(--space-1)]"
            aria-label={t('hub.tabs.your')}
          >
            {HUB_TABS.map((tab) => {
              const active = tab === hubTab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setHubTab(tab)}
                  aria-current={active ? 'page' : undefined}
                  className={`${topbarButtonClass} relative font-medium`}
                  style={{
                    ...noDragStyle,
                    color: active ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                    background: active ? 'var(--color-accent-tint)' : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.color = 'var(--color-text-secondary)';
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.color = 'var(--color-text-muted)';
                  }}
                >
                  {t(`hub.tabs.${tab}`)}
                  {active ? (
                    <span
                      aria-hidden
                      className="absolute left-[var(--space-2_5)] right-[var(--space-2_5)] bottom-[-18px] h-[2px] rounded-full"
                      style={{ background: 'var(--color-accent)' }}
                    />
                  ) : null}
                </button>
              );
            })}
          </nav>
        ) : (
          <div className="flex items-center gap-[var(--space-2)] min-w-0">
            <span style={{ color: 'oklch(0.22 0.025 50 / 0.2)' }}>/</span>
            <button
              type="button"
              onClick={() => setView('hub')}
              aria-label={t('topbar.openMyDesigns')}
              className={`${topbarButtonClass} max-w-[520px] gap-[6px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]`}
              style={{
                ...noDragStyle,
              }}
            >
              <FolderOpen className="w-4 h-4 shrink-0" aria-hidden />
              <span className="truncate" title={currentDesign?.name ?? ''}>
                {currentDesign?.name ?? t('sidebar.noDesign')}
              </span>
            </button>
          </div>
        )}
      </div>

      <div
        data-testid={TOPBAR_DRAG_SPACER_TEST_ID}
        className="min-w-[24px] flex-1 self-stretch"
        style={dragStyle}
      />

      <div className="flex shrink-0 items-center gap-[var(--space-2)]">
        <div style={noDragStyle}>
          <ModelSwitcher variant="topbar" />
        </div>
        {unreadErrorCount > 0 ? (
          <button
            type="button"
            onClick={() => openSettingsTab('diagnostics')}
            aria-label={t('topbar.unreadErrors', { count: unreadErrorCount })}
            title={t('topbar.unreadErrors', { count: unreadErrorCount })}
            className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-error)]/30 bg-[var(--color-surface)] px-[var(--space-2_5)] text-[var(--color-error)] whitespace-nowrap transition-colors hover:bg-[var(--color-error)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
            style={noDragStyle}
          >
            <AlertCircle className="w-3.5 h-3.5" aria-hidden />
            <span className="text-[var(--text-xs)] font-semibold tabular-nums">
              {unreadErrorCount > 99 ? '99+' : unreadErrorCount}
            </span>
          </button>
        ) : null}
        <div className="flex items-center gap-[var(--space-1)]" style={noDragStyle}>
          <LanguageToggle />
          <ThemeToggle />
          <IconButton label={t('settings.title')} size="md" onClick={() => setView('settings')}>
            <SettingsIcon className="w-[18px] h-[18px]" />
          </IconButton>
        </div>
      </div>
    </header>
  );
}
