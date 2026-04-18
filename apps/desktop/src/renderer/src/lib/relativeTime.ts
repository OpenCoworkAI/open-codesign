import { i18n } from '@open-codesign/i18n';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Format an ISO timestamp as a coarse relative string ("just now",
 * "5 minutes ago", "yesterday", "3 days ago"). Falls back to the local date
 * once we cross a week, where "X days ago" stops being readable.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = i18n.t.bind(i18n);
  const diff = Math.max(0, now - new Date(iso).getTime());
  if (diff < MINUTE) return t('projects.time.justNow') as string;
  if (diff < HOUR) {
    const minutes = Math.round(diff / MINUTE);
    return t('projects.time.minutesAgo', { count: minutes }) as string;
  }
  if (diff < DAY) {
    const hours = Math.round(diff / HOUR);
    return t('projects.time.hoursAgo', { count: hours }) as string;
  }
  if (diff < 2 * DAY) return t('projects.time.yesterday') as string;
  if (diff < 7 * DAY) {
    const days = Math.round(diff / DAY);
    return t('projects.time.daysAgo', { count: days }) as string;
  }
  return new Date(iso).toLocaleDateString();
}
