import { Button } from '@open-codesign/ui';
import { Cpu, FolderOpen, Palette, Settings as SettingsIcon, Sliders, X } from 'lucide-react';
import { useState } from 'react';
import { useCodesignStore } from '../store';

type Tab = 'models' | 'appearance' | 'storage' | 'advanced';

const TABS: ReadonlyArray<{ id: Tab; label: string; icon: typeof Cpu }> = [
  { id: 'models', label: 'Models', icon: Cpu },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'storage', label: 'Storage', icon: FolderOpen },
  { id: 'advanced', label: 'Advanced', icon: Sliders },
];

const CONFIG_PATH = '~/.config/open-codesign/config.toml';

function ModelsTab() {
  return (
    <div className="space-y-3">
      <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-text-primary)]">
        Providers
      </h3>
      <p className="text-[var(--text-sm)] text-[var(--color-text-secondary)] leading-[var(--leading-body)]">
        Provider key entry happens in the onboarding flow. To switch keys or add a new provider,
        edit the config file directly — a richer UI lands once we have multiple providers stored.
      </p>
      <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-4 text-[var(--text-sm)] text-[var(--color-text-muted)]">
        Coming soon: in-place provider management for Anthropic, OpenAI, Google, OpenRouter.
      </div>
    </div>
  );
}

function AppearanceTab() {
  const theme = useCodesignStore((s) => s.theme);
  const setTheme = useCodesignStore((s) => s.setTheme);
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-text-primary)]">
          Theme
        </h3>
        <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-1">
          Choice persists across restarts.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {(['light', 'dark'] as const).map((t) => {
          const active = theme === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTheme(t)}
              className={`text-left p-4 rounded-[var(--radius-lg)] border transition-colors ${
                active
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              <div className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)] capitalize">
                {t}
              </div>
              <div className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-1">
                {t === 'light' ? 'Warm beige, soft shadows' : 'Deep neutral, low glare'}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StorageTab() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-text-primary)]">
          Config file
        </h3>
        <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-1">
          All settings live in a single TOML file you can read or edit yourself.
        </p>
      </div>
      <code className="block px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] border border-[var(--color-border)] text-[var(--text-xs)] text-[var(--color-text-primary)]">
        {CONFIG_PATH}
      </code>
      <p className="text-[var(--text-xs)] text-[var(--color-text-secondary)]">
        Designs and history are stored locally in SQLite under the same directory.
      </p>
    </div>
  );
}

function AdvancedTab() {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-6 text-[var(--text-sm)] text-[var(--color-text-muted)]">
      Advanced options will appear here as the app grows. Nothing to configure yet.
    </div>
  );
}

export function Settings() {
  const open = useCodesignStore((s) => s.settingsOpen);
  const close = useCodesignStore((s) => s.closeSettings);
  const [tab, setTab] = useState<Tab>('appearance');
  if (!open) return null;
  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: native <dialog> top-layer rendering interferes with our overlay stack
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-[var(--color-overlay)] animate-[overlay-in_120ms_ease-out]"
      onClick={close}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
    >
      <div
        className="w-full max-w-3xl h-[32rem] rounded-[var(--radius-2xl)] bg-[var(--color-background)] border border-[var(--color-border)] shadow-[var(--shadow-elevated)] grid grid-cols-[12rem_1fr] overflow-hidden animate-[panel-in_160ms_ease-out]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="document"
      >
        <aside className="bg-[var(--color-background-secondary)] border-r border-[var(--color-border)] p-3">
          <div className="flex items-center gap-2 px-2 py-2 mb-2">
            <SettingsIcon className="w-4 h-4 text-[var(--color-text-secondary)]" />
            <span className="text-[var(--text-sm)] font-semibold text-[var(--color-text-primary)]">
              Settings
            </span>
          </div>
          <nav className="space-y-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-md)] text-[var(--text-sm)] transition-colors ${
                    active
                      ? 'bg-[var(--color-surface-active)] text-[var(--color-text-primary)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {t.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="flex flex-col">
          <header className="flex items-center justify-between px-5 h-12 border-b border-[var(--color-border)]">
            <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-text-primary)] capitalize">
              {tab}
            </h2>
            <Button variant="ghost" size="sm" onClick={close} aria-label="Close settings">
              <X className="w-4 h-4" />
            </Button>
          </header>
          <div className="flex-1 overflow-y-auto p-6">
            {tab === 'models' ? <ModelsTab /> : null}
            {tab === 'appearance' ? <AppearanceTab /> : null}
            {tab === 'storage' ? <StorageTab /> : null}
            {tab === 'advanced' ? <AdvancedTab /> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
