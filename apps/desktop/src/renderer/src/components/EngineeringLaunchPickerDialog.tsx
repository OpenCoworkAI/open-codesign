import { useT } from '@open-codesign/i18n';
import type { LaunchEntry } from '@open-codesign/shared';
import { useMemo, useState } from 'react';
import { useCodesignStore } from '../store';

/**
 * Engineering-mode launch picker (U12).
 *
 * Renders between detect() and engine.session.create(): the user picks one
 * of the scanned scripts (or types a custom shell command) and may override
 * the ready URL — useful when the dev server runs behind a proxy or never
 * prints a parseable URL line.
 *
 * No persistence happens here. The store action `confirmEngineeringLaunch`
 * is what calls IPC; cancelling closes the dialog without writing a
 * `designs` row.
 */
export function EngineeringLaunchPickerDialog() {
  const t = useT();
  const picker = useCodesignStore((s) => s.engineeringLaunchPicker);
  const submitting = useCodesignStore((s) => s.engineeringLaunchSubmitting);
  const confirm = useCodesignStore((s) => s.confirmEngineeringLaunch);
  const cancel = useCodesignStore((s) => s.cancelEngineeringLaunch);

  // Picker mounts when picker state becomes non-null. Hooks below run on
  // every render so they need stable defaults; we key off picker.workspacePath
  // implicitly via the early return — when a *new* picker session opens, the
  // dialog is unmounted/remounted by the parent and gets fresh state.
  const initialEntries = picker?.launchEntries ?? [];
  const initialSelectedKey = useMemo(() => {
    if (initialEntries.length === 0) return 'custom';
    return entryKey(initialEntries[0] as LaunchEntry);
  }, [initialEntries]);

  const [selectedKey, setSelectedKey] = useState(initialSelectedKey);
  const [customCommand, setCustomCommand] = useState('');
  const [readyUrl, setReadyUrl] = useState(picker?.suggestedReadyUrl ?? '');
  const [readyUrlError, setReadyUrlError] = useState<string | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);

  if (picker === null) return null;

  const customSelected = selectedKey === 'custom';
  const trimmedCustom = customCommand.trim();
  const trimmedReady = readyUrl.trim();

  function validate(): { launchEntry: LaunchEntry | null; manualReadyUrl: string | null } | null {
    setCustomError(null);
    setReadyUrlError(null);

    let launchEntry: LaunchEntry | null = null;
    if (customSelected) {
      if (trimmedCustom === '') {
        setCustomError(t('engineering.launchPicker.errors.emptyCommand'));
        return null;
      }
      launchEntry = {
        schemaVersion: 1,
        kind: 'repo-local-command',
        value: trimmedCustom,
        confidence: 'medium',
        source: 'manual',
      };
    } else {
      const found = initialEntries.find((e) => entryKey(e) === selectedKey);
      if (found === undefined) {
        setCustomError(t('engineering.launchPicker.errors.noSelection'));
        return null;
      }
      launchEntry = found;
    }

    let manualReadyUrl: string | null = null;
    if (trimmedReady !== '') {
      if (!/^https?:\/\//.test(trimmedReady)) {
        setReadyUrlError(t('engineering.launchPicker.errors.invalidUrl'));
        return null;
      }
      manualReadyUrl = trimmedReady;
    }

    return { launchEntry, manualReadyUrl };
  }

  async function handleConfirm() {
    const result = validate();
    if (result === null || result.launchEntry === null) return;
    await confirm({
      launchEntry: result.launchEntry,
      manualReadyUrl: result.manualReadyUrl,
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('engineering.launchPicker.title')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] animate-[overlay-in_120ms_ease-out]"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) cancel();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !submitting) cancel();
      }}
    >
      <div
        role="document"
        className="w-full max-w-lg rounded-[var(--radius-2xl)] bg-[var(--color-background)] border border-[var(--color-border)] shadow-[var(--shadow-elevated)] p-5 space-y-4 animate-[panel-in_160ms_ease-out]"
      >
        <div className="space-y-1">
          <h3 className="text-[var(--text-md)] font-medium text-[var(--color-text-primary)]">
            {t('engineering.launchPicker.title')}
          </h3>
          <p className="text-[var(--text-sm)] text-[var(--color-text-secondary)] leading-[var(--leading-body)]">
            {t('engineering.launchPicker.subtitle')}
          </p>
          <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] font-mono break-all pt-1">
            {picker.workspacePath}
            {picker.packageManager !== null ? ` · ${picker.packageManager}` : ''}
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-text-muted)]">
            {t('engineering.launchPicker.scriptsLabel')}
          </p>
          <div className="max-h-60 overflow-y-auto space-y-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
            {initialEntries.length === 0 ? (
              <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] px-2 py-1">
                {t('engineering.launchPicker.noScripts')}
              </p>
            ) : (
              initialEntries.map((entry) => {
                const key = entryKey(entry);
                const checked = selectedKey === key;
                return (
                  <label
                    key={key}
                    className={`flex items-start gap-2 px-2 py-1.5 rounded-[var(--radius-sm)] cursor-pointer transition-colors ${checked ? 'bg-[var(--color-surface-hover)]' : 'hover:bg-[var(--color-surface-hover)]'}`}
                  >
                    <input
                      type="radio"
                      name="engineering-launch-entry"
                      checked={checked}
                      onChange={() => setSelectedKey(key)}
                      disabled={submitting}
                      className="mt-1"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)] truncate">
                          {entry.kind === 'package-script' ? entry.value : entry.value}
                        </span>
                        <span className="text-[var(--text-xs)] text-[var(--color-text-muted)] uppercase">
                          {entry.confidence}
                        </span>
                      </span>
                      {entry.label !== undefined && entry.label !== entry.value ? (
                        <span className="block text-[var(--text-xs)] text-[var(--color-text-secondary)] font-mono truncate">
                          {entry.label}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })
            )}

            <label
              className={`flex items-start gap-2 px-2 py-1.5 rounded-[var(--radius-sm)] cursor-pointer transition-colors ${customSelected ? 'bg-[var(--color-surface-hover)]' : 'hover:bg-[var(--color-surface-hover)]'}`}
            >
              <input
                type="radio"
                name="engineering-launch-entry"
                checked={customSelected}
                onChange={() => setSelectedKey('custom')}
                disabled={submitting}
                className="mt-1"
              />
              <span className="flex-1 min-w-0">
                <span className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)]">
                  {t('engineering.launchPicker.customLabel')}
                </span>
                <input
                  type="text"
                  value={customCommand}
                  onChange={(e) => {
                    setCustomCommand(e.target.value);
                    if (!customSelected) setSelectedKey('custom');
                  }}
                  onFocus={() => setSelectedKey('custom')}
                  disabled={submitting}
                  placeholder={t('engineering.launchPicker.customPlaceholder')}
                  className="mt-1 w-full h-8 px-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--text-sm)] font-mono text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
                />
                {customError !== null && customSelected ? (
                  <span className="block text-[var(--text-xs)] text-[var(--color-danger)] mt-1">
                    {customError}
                  </span>
                ) : null}
              </span>
            </label>
          </div>
        </div>

        <div className="space-y-1">
          <label
            htmlFor="engineering-manual-ready-url"
            className="text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-text-muted)]"
          >
            {t('engineering.launchPicker.readyUrlLabel')}
          </label>
          <input
            id="engineering-manual-ready-url"
            type="text"
            value={readyUrl}
            onChange={(e) => setReadyUrl(e.target.value)}
            disabled={submitting}
            placeholder={t('engineering.launchPicker.readyUrlPlaceholder')}
            className="w-full h-9 px-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--text-sm)] font-mono text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
          />
          <p className="text-[var(--text-xs)] text-[var(--color-text-muted)]">
            {t('engineering.launchPicker.readyUrlHint')}
          </p>
          {readyUrlError !== null ? (
            <p className="text-[var(--text-xs)] text-[var(--color-danger)]">{readyUrlError}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => cancel()}
            disabled={submitting}
            className="h-9 px-3 rounded-[var(--radius-md)] text-[var(--text-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={submitting}
            className="h-9 px-3 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[var(--text-sm)] font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {submitting
              ? t('engineering.launchPicker.confirming')
              : t('engineering.launchPicker.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Stable key for radio-group identity. Different LaunchEntry kinds with the
 *  same `value` (e.g. a package script named `start` and a manual command
 *  `start`) need distinct keys, so the kind is part of it. */
function entryKey(entry: LaunchEntry): string {
  return `${entry.kind}:${entry.source}:${entry.value}`;
}
