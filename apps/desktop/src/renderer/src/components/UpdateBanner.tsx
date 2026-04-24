import { useT } from '@open-codesign/i18n';
import { BRAND } from '@open-codesign/shared';
import { X } from 'lucide-react';
import type { StoreApi } from 'zustand';
import { useStore } from 'zustand';
import { shouldShowBanner, type UpdateState } from '../state/update-store';

export function UpdateBanner({ store }: { store: StoreApi<UpdateState> }) {
  const t = useT();
  const show = useStore(store, shouldShowBanner);
  const version = useStore(store, (s) => s.version);
  const releaseUrl = useStore(store, (s) => s.releaseUrl);
  const dismissFn = useStore(store, (s) => s.dismiss);

  if (!show) return null;

  // Persist FIRST, then update the store on success. If persist fails the
  // banner stays so the user can retry rather than silently losing the dismiss.
  const onDismiss = async () => {
    if (!window.codesign) {
      dismissFn();
      return;
    }
    try {
      await window.codesign.preferences.update({ dismissedUpdateVersion: version });
      dismissFn();
    } catch (err) {
      console.warn('[UpdateBanner] failed to persist dismissedUpdateVersion', err);
    }
  };

  const onViewRelease = async () => {
    if (!window.codesign) return;
    try {
      await window.codesign.openExternal(releaseUrl);
    } catch (err) {
      console.warn('[UpdateBanner] openExternal failed', err);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="flex items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] px-4 py-2 text-[var(--text-sm)] text-[var(--color-text-secondary)]"
    >
      <span>
        <strong className="text-[var(--color-text-primary)]">
          {t('updates.bannerAvailable', { appName: BRAND.appName, version })}
        </strong>{' '}
        <button
          type="button"
          className="underline underline-offset-2 hover:text-[var(--color-text-primary)] transition-colors"
          onClick={() => void onViewRelease()}
        >
          {t('updates.bannerViewRelease')}
        </button>
      </span>
      <button
        type="button"
        aria-label={t('updates.bannerDismissAria')}
        className="shrink-0 p-1 rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
        onClick={() => void onDismiss()}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
