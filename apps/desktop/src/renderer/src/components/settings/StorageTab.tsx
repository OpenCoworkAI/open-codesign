import { useT } from '@open-codesign/i18n';
import { FolderOpen, Loader2, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppPaths, StorageKind } from '../../../../preload/index';
import { useCodesignStore } from '../../store';
import { cleanIpcError, PathRow, SectionTitle } from './primitives';

export function StorageTab() {
  const t = useT();
  const pushToast = useCodesignStore((s) => s.pushToast);
  const setView = useCodesignStore((s) => s.setView);
  const completeOnboarding = useCodesignStore((s) => s.completeOnboarding);
  const [paths, setPaths] = useState<AppPaths | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [choosing, setChoosing] = useState<StorageKind | null>(null);
  const [exporting, setExporting] = useState(false);
  const canChoose = choosing === null;

  useEffect(() => {
    if (!window.codesign) return;
    void window.codesign.settings
      .getPaths()
      .then(setPaths)
      .catch((err) => {
        pushToast({
          variant: 'error',
          title: t('settings.storage.pathsLoadFailed'),
          description: cleanIpcError(err) || t('settings.common.unknownError'),
        });
      });
  }, [pushToast, t]);

  async function openFolder(path: string) {
    try {
      await window.codesign?.settings.openFolder(path);
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.storage.openFolderFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
      });
    }
  }

  async function chooseStorageFolder(kind: StorageKind) {
    if (!window.codesign?.settings.chooseStorageFolder) return;
    setChoosing(kind);
    try {
      const next = await window.codesign.settings.chooseStorageFolder(kind);
      setPaths(next);
      pushToast({ variant: 'success', title: t('settings.storage.locationSavedToast') });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.storage.locationSaveFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
      });
    } finally {
      setChoosing(null);
    }
  }

  async function handleReset() {
    if (!window.codesign) return;
    await window.codesign.settings.resetOnboarding();
    const newState = await window.codesign.onboarding.getState();
    completeOnboarding(newState);
    setView('workspace');
    pushToast({ variant: 'info', title: t('settings.storage.onboardingResetToast') });
    setConfirmReset(false);
  }

  async function handleOpenLogFolder() {
    if (!window.codesign?.diagnostics?.openLogFolder) return;
    try {
      await window.codesign.diagnostics.openLogFolder();
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.storage.openFolderFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
      });
    }
  }

  async function handleOpenTemplatesFolder() {
    if (!window.codesign?.settings?.openTemplatesFolder) return;
    try {
      await window.codesign.settings.openTemplatesFolder();
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.storage.openFolderFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
      });
    }
  }

  async function handleExportDiagnostics() {
    if (!window.codesign?.diagnostics?.exportDiagnostics) return;
    setExporting(true);
    try {
      const zipPath = await window.codesign.diagnostics.exportDiagnostics();
      pushToast({
        variant: 'success',
        title: t('settings.storage.diagnosticsExported', { path: zipPath }),
      });
      void window.codesign.diagnostics.showItemInFolder?.(zipPath);
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.storage.diagnosticsExportFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      <SectionTitle>{t('settings.storage.pathsTitle')}</SectionTitle>
      <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] leading-[var(--leading-body)]">
        {t('settings.storage.restartHint')}
      </p>
      <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] leading-[var(--leading-body)]">
        {t('settings.storage.workspaceHint')}
      </p>

      {paths === null ? (
        <div className="flex items-center gap-2 py-4 text-[var(--text-sm)] text-[var(--color-text-muted)]">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('settings.common.loading')}
        </div>
      ) : (
        <div className="space-y-4">
          <PathRow
            label={t('settings.storage.config')}
            value={paths.config}
            onOpen={() => void openFolder(paths.configFolder)}
            {...(canChoose ? { onChoose: () => void chooseStorageFolder('config') } : {})}
          />
          <PathRow
            label={t('settings.storage.logs')}
            value={paths.logs}
            onOpen={() => void openFolder(paths.logsFolder)}
            {...(canChoose ? { onChoose: () => void chooseStorageFolder('logs') } : {})}
          />
          <PathRow
            label={t('settings.storage.data')}
            value={paths.data}
            onOpen={() => void openFolder(paths.data)}
            {...(canChoose ? { onChoose: () => void chooseStorageFolder('data') } : {})}
          />
        </div>
      )}

      <div className="pt-4 border-t border-[var(--color-border-subtle)]">
        <SectionTitle>{t('settings.storage.diagnosticsTitle')}</SectionTitle>
        <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-1 mb-3 leading-[var(--leading-body)]">
          {t('settings.storage.diagnosticsHint')}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleOpenLogFolder()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            {t('settings.storage.openLogFolder')}
          </button>
          <button
            type="button"
            onClick={() => void handleOpenTemplatesFolder()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            {t('settings.storage.openTemplatesFolder')}
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={() => void handleExportDiagnostics()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FolderOpen className="w-3.5 h-3.5" />
            )}
            {t('settings.storage.exportDiagnostics')}
          </button>
        </div>
      </div>

      <div className="pt-4 border-t border-[var(--color-border-subtle)]">
        <SectionTitle>{t('settings.storage.onboardingTitle')}</SectionTitle>
        <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-1 mb-3 leading-[var(--leading-body)]">
          {t('settings.storage.onboardingHint')}
        </p>

        {confirmReset ? (
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-xs)] text-[var(--color-text-secondary)]">
              {t('settings.storage.resetConfirm')}
            </span>
            <button
              type="button"
              onClick={handleReset}
              className="h-7 px-3 rounded-[var(--radius-sm)] bg-[var(--color-error)] text-[var(--color-on-accent)] text-[var(--text-xs)] font-medium hover:opacity-90 transition-opacity"
            >
              {t('settings.storage.reset')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              className="h-7 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--text-xs)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--color-error)] text-[var(--text-sm)] text-[var(--color-error)] hover:bg-[var(--color-error)] hover:text-[var(--color-on-accent)] transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {t('settings.storage.resetButton')}
          </button>
        )}
      </div>
    </div>
  );
}
