import i18next from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

export const availableLocales = ['en', 'zh-CN'] as const;
export type Locale = (typeof availableLocales)[number];

const DEFAULT_LOCALE: Locale = 'en';

const resources = {
  en: { translation: en },
  'zh-CN': { translation: zhCN },
} as const;

export function isSupportedLocale(value: string | undefined | null): value is Locale {
  if (!value) return false;
  return (availableLocales as readonly string[]).includes(value);
}

export function normalizeLocale(value: string | undefined | null): Locale {
  if (!value) return DEFAULT_LOCALE;
  if (isSupportedLocale(value)) return value;
  // Map e.g. "zh", "zh-Hans", "zh-Hans-CN", "zh-TW" to zh-CN when reasonable.
  const lower = value.toLowerCase();
  if (lower === 'zh' || lower.startsWith('zh-hans') || lower === 'zh-cn' || lower === 'zh_cn') {
    return 'zh-CN';
  }
  if (lower.startsWith('en')) return 'en';
  console.warn(
    `[i18n] unsupported locale "${value}", falling back to "${DEFAULT_LOCALE}". Supported: ${availableLocales.join(
      ', ',
    )}`,
  );
  return DEFAULT_LOCALE;
}

let initialized = false;

export async function initI18n(locale: string | undefined): Promise<Locale> {
  const target = normalizeLocale(locale);
  if (initialized) {
    if (i18next.language !== target) {
      await i18next.changeLanguage(target);
    }
    return target;
  }

  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const isDev = proc?.env?.['NODE_ENV'] !== 'production';

  await i18next.use(initReactI18next).init({
    resources,
    lng: target,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...availableLocales],
    interpolation: { escapeValue: false },
    returnNull: false,
    saveMissing: true,
    missingKeyHandler: (lngs, ns, key) => {
      const lang = Array.isArray(lngs) ? lngs.join(',') : String(lngs);
      console.warn(
        `[i18n] missing translation key "${key}" in namespace "${ns}" for locale "${lang}"`,
      );
    },
    parseMissingKeyHandler: (key) => {
      if (isDev) return `⟦${key}⟧`;
      return key;
    },
    react: { useSuspense: false },
  });

  initialized = true;
  return target;
}

export async function setLocale(locale: string): Promise<Locale> {
  const target = normalizeLocale(locale);
  if (!initialized) {
    return initI18n(target);
  }
  await i18next.changeLanguage(target);
  return target;
}

export function getCurrentLocale(): Locale {
  return normalizeLocale(i18next.language);
}

export function useT(): (key: string, options?: Record<string, unknown>) => string {
  const { t } = useTranslation();
  return (key, options) => t(key, options ?? {}) as string;
}

export { i18next as i18n };
export { useTranslation } from 'react-i18next';
