import { useT } from '@open-codesign/i18n';
import { FolderOpen, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { MemoryFileRead, Preferences } from '../../../../preload/index';
import { useCodesignStore } from '../../store';
import { cleanIpcError, Row } from './primitives';

const DEFAULT_PREFS: Preferences = {
  updateChannel: 'stable',
  generationTimeoutSec: 1200,
  checkForUpdatesOnStartup: false,
  dismissedUpdateVersion: '',
  diagnosticsLastReadTs: 0,
  memoryEnabled: true,
  workspaceMemoryAutoUpdate: true,
  userMemoryAutoUpdate: false,
  proxyUrl: '',
};

export function MemoryTab() {
  const t = useT();
  const pushToast = useCodesignStore((s) => s.pushToast);
  const [memory, setMemory] = useState<MemoryFileRead | null>(null);
  const [content, setContent] = useState('');
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!window.codesign) return;
    void Promise.all([window.codesign.memory.getUser(), window.codesign.preferences.get()])
      .then(([loadedMemory, loadedPrefs]) => {
        setMemory(loadedMemory);
        setContent(loadedMemory?.content ?? '');
        setPrefs(loadedPrefs);
      })
      .catch((err) => {
        pushToast({
          variant: 'error',
          title: t('settings.memory.loadFailed'),
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
        title: t('settings.memory.saveFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
      });
    }
  }

  async function saveMemory() {
    if (!window.codesign) return;
    setBusy(true);
    try {
      const next = await window.codesign.memory.updateUser(content);
      setMemory(next);
      setContent(next?.content ?? '');
      pushToast({ variant: 'success', title: t('settings.memory.saved') });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.memory.saveFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
      });
    } finally {
      setBusy(false);
    }
  }

  async function openMemory() {
    if (!window.codesign) return;
    try {
      await window.codesign.memory.openUserMemory();
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.memory.openFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
      });
    }
  }

  async function consolidateNow() {
    if (!window.codesign) return;
    setBusy(true);
    try {
      const result = await window.codesign.memory.consolidateUserMemoryNow();
      const next = await window.codesign.memory.getUser();
      setMemory(next);
      setContent(next?.content ?? '');
      pushToast({
        variant: 'success',
        title: result.updated ? t('settings.memory.updated') : t('settings.memory.noCandidates'),
      });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.memory.updateFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
      });
    } finally {
      setBusy(false);
    }
  }

  async function clearCandidates() {
    if (!window.codesign) return;
    try {
      await window.codesign.memory.clearUserMemoryCandidates();
      pushToast({ variant: 'success', title: t('settings.memory.candidatesCleared') });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.memory.clearFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
      });
    }
  }

  const buttonClass =
    'inline-flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-[var(--text-xs)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="space-y-1">
      <Row label={t('settings.memory.userFile')} hint={memory?.path ?? ''}>
        <div className="flex items-center gap-2">
          <button type="button" onClick={openMemory} className={buttonClass}>
            <FolderOpen className="h-3.5 w-3.5" />
            {t('settings.memory.open')}
          </button>
          <button type="button" onClick={consolidateNow} disabled={busy} className={buttonClass}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t('settings.memory.updateNow')}
          </button>
        </div>
      </Row>

      <Row label={t('settings.memory.enabled')} hint={t('settings.memory.enabledHint')}>
        <input
          type="checkbox"
          checked={prefs.memoryEnabled}
          onChange={(e) => void updatePref({ memoryEnabled: e.target.checked })}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
      </Row>

      <Row
        label={t('settings.memory.workspaceAutoUpdate')}
        hint={t('settings.memory.workspaceAutoUpdateHint')}
      >
        <input
          type="checkbox"
          checked={prefs.workspaceMemoryAutoUpdate}
          disabled={!prefs.memoryEnabled}
          onChange={(e) => void updatePref({ workspaceMemoryAutoUpdate: e.target.checked })}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
      </Row>

      <Row
        label={t('settings.memory.userAutoUpdate')}
        hint={t('settings.memory.userAutoUpdateHint')}
      >
        <input
          type="checkbox"
          checked={prefs.userMemoryAutoUpdate}
          disabled={!prefs.memoryEnabled}
          onChange={(e) => void updatePref({ userMemoryAutoUpdate: e.target.checked })}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
      </Row>

      <div className="pt-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[var(--text-sm)] font-medium text-[var(--color-text-secondary)]">
            {t('settings.memory.preview')}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={clearCandidates} className={buttonClass}>
              <Trash2 className="h-3.5 w-3.5" />
              {t('settings.memory.clearCandidates')}
            </button>
            <button type="button" onClick={saveMemory} disabled={busy} className={buttonClass}>
              <Save className="h-3.5 w-3.5" />
              {t('settings.memory.save')}
            </button>
          </div>
        </div>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          spellCheck={false}
          className="h-[22rem] w-full resize-none rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-[var(--text-xs)] leading-[var(--leading-body)] text-[var(--color-text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
        />
      </div>
    </div>
  );
}
