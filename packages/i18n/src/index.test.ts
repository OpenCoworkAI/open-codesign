import { describe, expect, it } from 'vitest';
import { availableLocales, initI18n, isSupportedLocale, normalizeLocale, setLocale } from './index';

describe('normalizeLocale', () => {
  it('returns the value unchanged when it is supported', () => {
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('zh-CN')).toBe('zh-CN');
  });

  it('coalesces common Chinese variants to zh-CN', () => {
    expect(normalizeLocale('zh')).toBe('zh-CN');
    expect(normalizeLocale('zh-Hans')).toBe('zh-CN');
    expect(normalizeLocale('zh-Hans-CN')).toBe('zh-CN');
    expect(normalizeLocale('zh_CN')).toBe('zh-CN');
  });

  it('maps en-US / en-GB to en', () => {
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('en-GB')).toBe('en');
  });

  it('falls back to en for unsupported locales', () => {
    expect(normalizeLocale('fr-FR')).toBe('en');
    expect(normalizeLocale(undefined)).toBe('en');
    expect(normalizeLocale(null)).toBe('en');
  });
});

describe('isSupportedLocale', () => {
  it('matches exactly the available locales', () => {
    for (const code of availableLocales) {
      expect(isSupportedLocale(code)).toBe(true);
    }
    expect(isSupportedLocale('fr')).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
  });
});

describe('initI18n + setLocale', () => {
  it('boots and serves translated strings for both locales', async () => {
    const { i18n } = await import('./index');
    await initI18n('en');
    expect(i18n.t('chat.placeholder')).toBe('Describe what to design…');

    await setLocale('zh-CN');
    expect(i18n.t('chat.placeholder')).toBe('想设计什么？');
    expect(i18n.t('common.preAlpha')).toBe('预览版');
  });
});
