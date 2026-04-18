import { useT } from '@open-codesign/i18n';
import { Download, Moon, Plus, Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useCodesignStore } from '../store';

interface PaletteAction {
  id: string;
  label: string;
  hint: string;
  icon: typeof Plus;
  run: () => void;
}

export function CommandPalette() {
  const t = useT();
  const open = useCodesignStore((s) => s.commandPaletteOpen);
  const close = useCodesignStore((s) => s.closeCommandPalette);
  const setView = useCodesignStore((s) => s.setView);
  const toggleTheme = useCodesignStore((s) => s.toggleTheme);
  const pushToast = useCodesignStore((s) => s.pushToast);

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const actions: PaletteAction[] = useMemo(
    () => [
      {
        id: 'new-design',
        label: t('commands.items.newDesign'),
        hint: t('commands.hints.newDesign'),
        icon: Plus,
        run: () => {
          useCodesignStore.setState({
            messages: [],
            previewHtml: null,
            errorMessage: null,
            iframeErrors: [],
            selectedElement: null,
          });
          pushToast({ variant: 'info', title: t('commands.cleared') });
        },
      },
      {
        id: 'toggle-theme',
        label: t('commands.items.toggleTheme'),
        hint: t('commands.hints.toggleTheme'),
        icon: Moon,
        run: toggleTheme,
      },
      {
        id: 'open-settings',
        label: t('commands.items.openSettings'),
        hint: t('commands.hints.openSettings'),
        icon: SettingsIcon,
        run: () => setView('settings'),
      },
      {
        id: 'export',
        label: t('commands.items.export'),
        hint: t('commands.hints.export'),
        icon: Download,
        run: () =>
          pushToast({
            variant: 'info',
            title: t('commands.exportUseToolbarTitle'),
            description: t('commands.exportUseToolbarBody'),
          }),
      },
    ],
    [setView, pushToast, t, toggleTheme],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(
      (action) => action.label.toLowerCase().includes(q) || action.hint.toLowerCase().includes(q),
    );
  }, [actions, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setCursor(0);
    }
  }, [open]);

  useEffect(() => {
    if (cursor >= filtered.length) setCursor(0);
  }, [cursor, filtered.length]);

  if (!open) return null;

  function runAt(index: number) {
    const action = filtered[index];
    if (!action) return;
    action.run();
    close();
  }

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: native <dialog> top-layer rendering interferes with our overlay stack
      role="dialog"
      aria-modal="true"
      aria-label={t('commands.title')}
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-6 bg-[var(--color-overlay)] animate-[overlay-in_120ms_ease-out]"
      onClick={close}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
    >
      <div
        className="w-full max-w-lg rounded-[var(--radius-2xl)] bg-[var(--color-background)] border border-[var(--color-border)] shadow-[var(--shadow-elevated)] overflow-hidden animate-[panel-in_160ms_ease-out]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCursor((current) => Math.min(current + 1, filtered.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCursor((current) => Math.max(current - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            runAt(cursor);
          } else if (e.key === 'Escape') {
            close();
          }
        }}
        role="document"
      >
        <input
          // biome-ignore lint/a11y/noAutofocus: command palette is intentionally focused on open
          autoFocus
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          placeholder={t('commands.placeholder')}
          className="w-full px-5 h-12 bg-transparent border-b border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none"
        />
        <ul className="max-h-72 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <li className="px-5 py-3 text-[var(--text-sm)] text-[var(--color-text-muted)]">
              {t('commands.noMatches')}
            </li>
          ) : (
            filtered.map((action, index) => {
              const Icon = action.icon;
              const active = index === cursor;
              return (
                <li key={action.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => runAt(index)}
                    className={`w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors ${
                      active
                        ? 'bg-[var(--color-surface-active)]'
                        : 'hover:bg-[var(--color-surface-hover)]'
                    }`}
                  >
                    <Icon className="w-4 h-4 text-[var(--color-text-secondary)] shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[var(--text-sm)] text-[var(--color-text-primary)]">
                        {action.label}
                      </span>
                      <span className="block text-[var(--text-xs)] text-[var(--color-text-muted)]">
                        {action.hint}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
