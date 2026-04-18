import { describe, expect, it, vi } from 'vitest';
import {
  availableLocales,
  getCurrentLocale,
  initI18n,
  isSupportedLocale,
  normalizeLocale,
  setLocale,
} from './index';

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

  it('falls back to en for unsupported locales and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normalizeLocale('fr-FR')).toBe('en');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('falls back to en for nullish input without warning', () => {
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
    expect(isSupportedLocale(null)).toBe(false);
    expect(isSupportedLocale('')).toBe(false);
  });
});

describe('initI18n + setLocale (live switching)', () => {
  it('boots and serves translated strings for both locales', async () => {
    const { i18n } = await import('./index');
    await initI18n('en');
    expect(i18n.t('chat.placeholder')).toBe('Describe what to design…');
    expect(i18n.t('common.send')).toBe('Send');

    await setLocale('zh-CN');
    expect(i18n.t('chat.placeholder')).toBe('想设计什么？');
    expect(i18n.t('common.preAlpha')).toBe('预览版');

    await setLocale('en');
    expect(i18n.t('common.send')).toBe('Send');
  });

  it('warns and surfaces a visible marker when a key is missing', async () => {
    const { i18n } = await import('./index');
    await initI18n('en');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const value = i18n.t('common.thisKeyDoesNotExist');
    // parseMissingKeyHandler in dev wraps with ⟦…⟧ brackets.
    expect(value).toContain('thisKeyDoesNotExist');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('setLocale updates getCurrentLocale and i18n.t() immediately (no restart needed)', async () => {
    const { i18n } = await import('./index');
    await initI18n('en');
    expect(getCurrentLocale()).toBe('en');
    expect(i18n.t('common.send')).toBe('Send');

    await setLocale('zh-CN');
    expect(getCurrentLocale()).toBe('zh-CN');
    expect(i18n.t('common.send')).toBe('发送');

    await setLocale('en');
    expect(getCurrentLocale()).toBe('en');
    expect(i18n.t('common.send')).toBe('Send');
  });
});
