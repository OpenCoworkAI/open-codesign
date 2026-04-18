/**
 * Built-in demo prompts. Aligned with the eight Claude Design demos
 * we committed to replicate (see docs/VISION.md).
 *
 * Per-locale variants live under ./locales/.
 */

import { type Locale, availableLocales, normalizeLocale } from '@open-codesign/i18n';
import { enDemos } from './locales/en';
import { zhCNDemos } from './locales/zh-CN';

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
    return REGISTRY.en;
  }
  return demos;
}

export function getDemo(id: string, locale: string | undefined): DemoTemplate | undefined {
  return getDemos(locale).find((d) => d.id === id);
}
