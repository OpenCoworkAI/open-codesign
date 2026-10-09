import { i18n } from '@open-codesign/i18n';
import type { CodesignState } from '../store';

export type DesignNotificationKind = 'done' | 'failed' | 'ask';

const BODY_KEYS: Record<DesignNotificationKind, string> = {
  done: 'notifications.systemDesignReady',
  failed: 'notifications.systemGenerationFailed',
  ask: 'notifications.systemAskWaiting',
};

export async function notifyDesignInBackground(
  state: Pick<CodesignState, 'designs' | 'switchDesign'>,
  designId: string | undefined,
  kind: DesignNotificationKind,
): Promise<void> {
  const api = window.codesign;
  if (!api) return;
  const prefs = await api.preferences.get();
  // Focus is read after the setting so a user who returns meanwhile is not notified.
  if (!prefs.systemNotifications || document.hasFocus()) return;
  const design = state.designs.find((item) => item.id === designId);
  const notification = new Notification(design?.name ?? 'Open CoDesign', {
    body: i18n.t(BODY_KEYS[kind]),
  });
  notification.onclick = () => {
    Promise.all([api.focusWindow(), design ? state.switchDesign(design.id) : undefined]).catch(
      (error: unknown) => console.warn('[open-codesign] opening a notified design failed:', error),
    );
  };
}
