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

export function AdvancedTab() {
  const t = useT();
  const pushToast = useCodesignStore((s) => s.pushToast);
  const [prefs, setPrefs] = useState<Preferences>({
    updateChannel: 'stable',
    generationTimeoutSec: 1200,
    checkForUpdatesOnStartup: false,
    dismissedUpdateVersion: '',
    diagnosticsLastReadTs: 0,
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
