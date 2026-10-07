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
  if (!api || document.hasFocus()) return;
  const prefs = await api.preferences.get();
  if (!prefs.systemNotifications) return;
  const design = state.designs.find((item) => item.id === designId);
  const notification = new Notification(design?.name ?? 'Open CoDesign', {
    body: i18n.t(BODY_KEYS[kind]),
  });
  notification.onclick = () => {
    void api.focusWindow();
    if (design) void state.switchDesign(design.id);
  };
}
