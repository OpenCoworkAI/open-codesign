import { useT } from '@open-codesign/i18n';
import { useEffect, useState } from 'react';
import type { Preferences } from '../../../../preload/index';
import { useCodesignStore } from '../../store';
import { cleanIpcError, NativeSelect, Row, SegmentedControl } from './primitives';

/**
 * Canonical timeout choices. Default prefs value is 1200s (20 min); long
 * generations need 30-60 min, dropdown tops out at 2h. The old 60-300s
 * ceiling silently clamped the stored value when the UI couldn't represent it.
 */
export const TIMEOUT_OPTION_SECONDS = [60, 120, 180, 300, 600, 1200, 1800, 3600, 7200] as const;

/**
 * Returns the canonical list with `currentSec` merged in when it is a positive
 * finite value that isn't already present. Prevents a blank select and silent
 * downgrade on save.
 */
export function resolveTimeoutOptions(currentSec: number): number[] {
  const base: number[] = [...TIMEOUT_OPTION_SECONDS];
  if (Number.isFinite(currentSec) && currentSec > 0 && !base.includes(currentSec)) {
    base.push(currentSec);
    base.sort((a, b) => a - b);
  }
  return base;
}

/** Commit-on-blur input — avoids saving (and re-applying the proxy) on every
 *  keystroke while still updating the underlying preference when focus leaves
 *  the field or the user presses Enter. */
function ProxyUrlInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      placeholder="http://127.0.0.1:7890"
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      className="h-7 w-full max-w-md px-2.5 bg-[var(--color-background)] border border-[var(--color-border)] rounded-[var(--radius-sm)] text-[var(--text-sm)] text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] outline-none focus:border-[var(--color-accent)] transition-colors"
    />
  );
}

export function AdvancedTab() {
  const t = useT();
  const pushToast = useCodesignStore((s) => s.pushToast);
  const [prefs, setPrefs] = useState<Preferences>({
    updateChannel: 'stable',
    generationTimeoutSec: 1200,
    checkForUpdatesOnStartup: false,
    dismissedUpdateVersion: '',
    diagnosticsLastReadTs: 0,
    memoryEnabled: true,
    workspaceMemoryAutoUpdate: true,
    userMemoryAutoUpdate: false,
    proxyUrl: '',
  });

  useEffect(() => {
    if (!window.codesign) return;
    void window.codesign.preferences
      .get()
      .then(setPrefs)
      .catch((err) => {
        pushToast({
          variant: 'error',
          title: t('settings.advanced.prefsLoadFailed'),
          description: cleanIpcError(err) || t('settings.common.unknownError'),
        });
      });
  }, [pushToast, t]);

  async function updatePref(patch: Partial<Preferences>) {
    if (!window.codesign) return;
    try {
      const next = await window.codesign.preferences.update(patch);
      setPrefs(next);
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.advanced.prefsSaveFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
      });
    }
  }

  async function handleDevtools() {
    if (!window.codesign) return;
    try {
      await window.codesign.settings.toggleDevtools();
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.advanced.devtoolsFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
      });
    }
  }

  return (
    <div className="space-y-1">
      <Row
        label={t('settings.advanced.updateChannel')}
        hint={t('settings.advanced.updateChannelHint')}
      >
        <SegmentedControl
          options={[
            { value: 'stable', label: t('settings.advanced.stable') },
            { value: 'beta', label: t('settings.advanced.beta') },
          ]}
          value={prefs.updateChannel}
          onChange={(v) => void updatePref({ updateChannel: v })}
        />
      </Row>

      <Row
        label={t('settings.advanced.checkForUpdatesOnStartup')}
        hint={t('settings.advanced.checkForUpdatesOnStartupHint')}
      >
        <input
          type="checkbox"
          checked={prefs.checkForUpdatesOnStartup}
          onChange={(e) => void updatePref({ checkForUpdatesOnStartup: e.target.checked })}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
      </Row>

      <Row label={t('settings.advanced.timeout')} hint={t('settings.advanced.timeoutHint')}>
        <NativeSelect
          value={String(prefs.generationTimeoutSec)}
          onChange={(v) => void updatePref({ generationTimeoutSec: Number(v) })}
          options={resolveTimeoutOptions(prefs.generationTimeoutSec).map((sec) => ({
            value: String(sec),
            label: t('settings.advanced.timeoutSeconds', { value: sec }),
          }))}
        />
      </Row>

      <Row label={t('settings.advanced.proxy')} hint={t('settings.advanced.proxyHint')}>
        <ProxyUrlInput value={prefs.proxyUrl} onCommit={(v) => void updatePref({ proxyUrl: v })} />
      </Row>

      <Row label={t('settings.advanced.devtools')} hint={t('settings.advanced.devtoolsHint')}>
        <button
          type="button"
          onClick={handleDevtools}
          className="h-7 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--text-xs)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          {t('settings.advanced.toggleDevtools')}
        </button>
      </Row>
    </div>
  );
}
