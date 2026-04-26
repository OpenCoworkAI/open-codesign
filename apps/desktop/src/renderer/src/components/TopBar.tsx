import { useT } from '@open-codesign/i18n';
import { IconButton, Wordmark } from '@open-codesign/ui';
import { AlertCircle, ArrowLeft, FolderOpen, Settings as SettingsIcon } from 'lucide-react';
import { type CSSProperties, useEffect } from 'react';
import { type HubTab, useCodesignStore } from '../store';
import { ModelSwitcher } from './ModelSwitcher';
import { WindowControls } from './WindowControls';

const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

const HUB_TABS: HubTab[] = ['recent', 'your', 'examples', 'designSystems'];

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect
  useEffect(() => {
    void refreshDiagnosticEvents();
  }, []);

  return (
    <header
      className="h-[var(--size-titlebar-height)] shrink-0 flex items-center justify-between select-none"
      style={{
        ...dragStyle,
        paddingLeft: 'var(--space-4)',
        paddingRight: '0px',
        borderBottom: '1px solid oklch(0.22 0.025 50 / 0.08)',
        background: 'var(--color-background)',
      }}
    >
      <div className="flex items-center gap-[var(--space-4)] min-w-0 h-full">
        <div style={dragStyle}>
          <Wordmark badge={`v${__APP_VERSION__}`} size="sm" />
        </div>

        <div style={noDragStyle}>
          {view === 'settings' ? (
            <div className="flex items-center gap-[var(--space-1)]">
              <span style={{ color: 'oklch(0.22 0.025 50 / 0.2)' }}>/</span>
              <button
                type="button"
                onClick={() => setView(previousView === 'settings' ? 'hub' : previousView)}
                aria-label={t('topbar.closeSettings')}
                className="inline-flex items-center gap-[4px] rounded-[var(--radius-sm)] px-[var(--space-1_5)] py-[var(--space-0_5)] transition-colors duration-[var(--duration-faster)]"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '14px',
                  letterSpacing: '-0.01em',
                  color: 'var(--color-text-secondary)',
                }}
              >
                <ArrowLeft className="w-3.5 h-3.5 shrink-0" aria-hidden />
                <span>{t('topbar.settingsLabel')}</span>
              </button>
            </div>
          ) : view === 'hub' ? (
            <nav
              className="flex items-center gap-[var(--space-4)] h-full"
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
                    className="relative h-full inline-flex items-center transition-colors duration-[var(--duration-faster)]"
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: '14px',
                      fontWeight: active ? 500 : 400,
                      color: active ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                      letterSpacing: '-0.01em',
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
                        className="absolute left-0 right-0 bottom-[-1px] h-[2px] rounded-full"
                        style={{ background: 'var(--color-accent)' }}
                      />
                    ) : null}
                  </button>
                );
              })}
            </nav>
          ) : (
            <div className="flex items-center gap-[var(--space-1)]">
              <span style={{ color: 'oklch(0.22 0.025 50 / 0.2)' }}>/</span>
              <button
                type="button"
                onClick={() => setView('hub')}
                aria-label={t('topbar.openMyDesigns')}
                className="inline-flex items-center gap-[4px] rounded-[var(--radius-sm)] px-[var(--space-1_5)] py-[var(--space-0_5)] transition-colors duration-[var(--duration-faster)] max-w-[400px]"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '14px',
                  letterSpacing: '-0.01em',
                  color: 'var(--color-text-secondary)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--color-text-primary)';
                  e.currentTarget.style.background = 'var(--color-surface-hover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--color-text-secondary)';
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <FolderOpen className="w-3.5 h-3.5 shrink-0" aria-hidden />
                <span className="truncate" title={currentDesign?.name ?? ''}>
                  {currentDesign?.name ?? t('sidebar.noDesign')}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center h-full" style={noDragStyle}>
        <div className="flex items-center gap-[var(--space-2)] px-[var(--space-3)]">
          <ModelSwitcher variant="topbar" />
          {unreadErrorCount > 0 ? (
            <button
              type="button"
              onClick={() => openSettingsTab('diagnostics')}
              aria-label={t('topbar.unreadErrors', { count: unreadErrorCount })}
              title={t('topbar.unreadErrors', { count: unreadErrorCount })}
              className="inline-flex items-center gap-1 h-6 px-1.5 rounded-[var(--radius-sm)] border border-[var(--color-error)]/30 text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors"
            >
              <AlertCircle className="w-3 h-3" aria-hidden />
              <span className="text-[10px] font-semibold">
                {unreadErrorCount > 99 ? '99+' : unreadErrorCount}
              </span>
            </button>
          ) : null}
          <IconButton label={t('settings.title')} size="sm" onClick={() => setView('settings')}>
            <SettingsIcon className="w-4 h-4" />
          </IconButton>
        </div>
        <WindowControls />
      </div>
    </header>
  );
}
