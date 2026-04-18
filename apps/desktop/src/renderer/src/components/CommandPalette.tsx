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
  const open = useCodesignStore((s) => s.commandPaletteOpen);
  const close = useCodesignStore((s) => s.closeCommandPalette);
  const openSettings = useCodesignStore((s) => s.openSettings);
  const toggleTheme = useCodesignStore((s) => s.toggleTheme);
  const pushToast = useCodesignStore((s) => s.pushToast);

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const actions: PaletteAction[] = useMemo(
    () => [
      {
        id: 'new-design',
        label: 'New Design',
        hint: 'Clear chat and start fresh',
        icon: Plus,
        run: () => {
          useCodesignStore.setState({
            messages: [],
            previewHtml: null,
            errorMessage: null,
          });
          pushToast({ variant: 'info', title: 'Workspace cleared' });
        },
      },
      {
        id: 'toggle-theme',
        label: 'Toggle Theme',
        hint: 'Switch between light and dark',
        icon: Moon,
        run: toggleTheme,
      },
      {
        id: 'open-settings',
        label: 'Open Settings',
        hint: 'Models, appearance, storage',
        icon: SettingsIcon,
        run: openSettings,
      },
      {
        id: 'export',
        label: 'Export',
        hint: 'PDF and PPTX coming soon',
        icon: Download,
        run: () =>
          pushToast({
            variant: 'info',
            title: 'Export not available yet',
            description: 'PDF and PPTX exporters land in v0.2. HTML export is in the toolbar.',
          }),
      },
    ],
    [openSettings, toggleTheme, pushToast],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(
      (a) => a.label.toLowerCase().includes(q) || a.hint.toLowerCase().includes(q),
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

  function runAt(i: number) {
    const action = filtered[i];
    if (!action) return;
    action.run();
    close();
  }

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: native <dialog> top-layer rendering interferes with our overlay stack
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
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
            setCursor((c) => Math.min(c + 1, filtered.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCursor((c) => Math.max(c - 1, 0));
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
          placeholder="Type a command…"
          className="w-full px-5 h-12 bg-transparent border-b border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none"
        />
        <ul className="max-h-72 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <li className="px-5 py-3 text-[var(--text-sm)] text-[var(--color-text-muted)]">
              No matches.
            </li>
          ) : (
            filtered.map((a, i) => {
              const Icon = a.icon;
              const active = i === cursor;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => runAt(i)}
                    className={`w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors ${
                      active
                        ? 'bg-[var(--color-surface-active)]'
                        : 'hover:bg-[var(--color-surface-hover)]'
                    }`}
                  >
                    <Icon className="w-4 h-4 text-[var(--color-text-secondary)] shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[var(--text-sm)] text-[var(--color-text-primary)]">
                        {a.label}
                      </span>
                      <span className="block text-[var(--text-xs)] text-[var(--color-text-muted)]">
                        {a.hint}
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
