/**
 * Built-in demo prompts. Aligned with the eight Claude Design demos
 * we committed to replicate (see docs/VISION.md).
 *
 * Per-locale variants live under ./locales/. Use `getDemos(locale)` /
 * `getDemo(id, locale)` for new code; `BUILTIN_DEMOS` is kept as an
 * English alias for backward compatibility with pre-i18n callers.
 */

import { type Locale, availableLocales, normalizeLocale } from '@open-codesign/i18n';
import { enDemos } from './locales/en';
import { zhCNDemos } from './locales/zh-CN';

export { SYSTEM_PROMPTS, type SystemPromptId } from './system/index';

export interface DemoTemplate {
  id: string;
  title: string;
  description: string;
  prompt: string;
}

const REGISTRY: Record<Locale, DemoTemplate[]> = {
  en: enDemos,
  'zh-CN': zhCNDemos,
};

export function getDemos(locale: string | undefined): DemoTemplate[] {
  const target = normalizeLocale(locale);
  const demos = REGISTRY[target];
  if (!demos) {
    console.warn(
      `[templates] no demos registered for locale "${target}"; falling back to "en". ` +
        `Supported: ${availableLocales.join(', ')}`,
    );
    return enDemos;
  }
  return demos;
}

export function getDemo(id: string, locale?: string): DemoTemplate | undefined {
  return getDemos(locale).find((d) => d.id === id);
}

/**
 * @deprecated Use `getDemos(locale)`. Kept as an English-only alias so existing
 * imports do not break while the renderer migrates to the locale-aware API.
 */
export const BUILTIN_DEMOS: DemoTemplate[] = enDemos;
