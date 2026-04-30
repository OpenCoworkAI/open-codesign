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
    expect(normalizeLocale('ko')).toBe('ko');
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

  it('maps Korean variants to ko', () => {
    expect(normalizeLocale('ko-KR')).toBe('ko');
    expect(normalizeLocale('ko_kr')).toBe('ko');
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

    await setLocale('ko');
    expect(i18n.t('chat.placeholder')).toBe('무엇을 디자인할지 설명하세요…');
    expect(i18n.t('common.preAlpha')).toBe('프리 알파');

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

    await setLocale('ko');
    expect(getCurrentLocale()).toBe('ko');
    expect(i18n.t('common.send')).toBe('보내기');

    await setLocale('en');
    expect(getCurrentLocale()).toBe('en');
    expect(i18n.t('common.send')).toBe('Send');
  });
});

describe('onboarding i18n keys (Welcome / PasteKey / ChooseModel)', () => {
  it('returns correct English strings for all onboarding screens', async () => {
    const { i18n } = await import('./index');
    await initI18n('en');

    // Welcome
    expect(i18n.t('onboarding.welcome.title')).toBe('Design with any model.');
    expect(i18n.t('onboarding.welcome.tryFree')).toBe('Try free now');
    expect(i18n.t('onboarding.welcome.useKey')).toBe('Use my API key');
    expect(i18n.t('onboarding.welcome.whereToGetKey')).toBe('Where to get a key');

    // PasteKey
    expect(i18n.t('onboarding.paste.title')).toBe('Paste your API key');
    expect(i18n.t('onboarding.paste.back')).toBe('Back');
    expect(i18n.t('onboarding.paste.continue')).toBe('Continue');
    expect(i18n.t('onboarding.paste.connectionTest.button')).toBe('Test');
    expect(i18n.t('onboarding.paste.connectionTest.ok')).toBe('Connected');

    // ChooseModel
    expect(i18n.t('onboarding.choose.title')).toBe('Pick default models');
    expect(i18n.t('onboarding.choose.finish')).toBe('Finish');
    expect(i18n.t('onboarding.choose.back')).toBe('Back');
  });

  it('switches all onboarding strings to Korean when locale is ko', async () => {
    const { i18n } = await import('./index');
    await initI18n('en');
    await setLocale('ko');

    expect(i18n.t('onboarding.welcome.title')).toBe('어떤 모델로든 디자인하세요.');
    expect(i18n.t('onboarding.welcome.tryFree')).toBe('무료로 시작하기');
    expect(i18n.t('onboarding.welcome.useKey')).toBe('내 API 키 사용');
    expect(i18n.t('onboarding.welcome.whereToGetKey')).toBe('키를 받는 방법');

    expect(i18n.t('onboarding.paste.title')).toBe('API 키 붙여넣기');
    expect(i18n.t('onboarding.paste.back')).toBe('뒤로');
    expect(i18n.t('onboarding.paste.continue')).toBe('계속');
    expect(i18n.t('onboarding.paste.connectionTest.button')).toBe('테스트');
    expect(i18n.t('onboarding.paste.connectionTest.ok')).toBe('연결됨');

    expect(i18n.t('onboarding.choose.title')).toBe('기본 모델 선택');
    expect(i18n.t('onboarding.choose.finish')).toBe('완료');
    expect(i18n.t('onboarding.choose.back')).toBe('뒤로');

    await setLocale('en');
  });

  it('switches all onboarding strings to Chinese when locale is zh-CN', async () => {
    const { i18n } = await import('./index');
    await initI18n('en');
    await setLocale('zh-CN');

    // Welcome
    expect(i18n.t('onboarding.welcome.title')).toBe('选择你的设计模型。');
    expect(i18n.t('onboarding.welcome.tryFree')).toBe('免费试用');
    expect(i18n.t('onboarding.welcome.useKey')).toBe('使用我的 API Key');
    expect(i18n.t('onboarding.welcome.whereToGetKey')).toBe('在哪里获取 Key');

    // PasteKey
    expect(i18n.t('onboarding.paste.title')).toBe('粘贴你的 API Key');
    expect(i18n.t('onboarding.paste.back')).toBe('返回');
    expect(i18n.t('onboarding.paste.continue')).toBe('继续');
    expect(i18n.t('onboarding.paste.connectionTest.button')).toBe('测试连通');
    expect(i18n.t('onboarding.paste.connectionTest.ok')).toBe('连接成功');

    // ChooseModel
    expect(i18n.t('onboarding.choose.title')).toBe('选择默认模型');
    expect(i18n.t('onboarding.choose.finish')).toBe('完成设置');
    expect(i18n.t('onboarding.choose.back')).toBe('返回');

    // Reset to en for other tests
    await setLocale('en');
  });
});
