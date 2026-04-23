import { describe, expect, it, vi } from 'vitest';
import { applyLocaleChange } from './Settings';

vi.mock('@open-codesign/i18n', () => ({
  setLocale: vi.fn((locale: string) => Promise.resolve(locale)),
  useT: () => (key: string) => key,
}));

describe('applyLocaleChange', () => {
  it('calls locale IPC set, then applies the persisted locale via i18next', async () => {
    const { setLocale: mockSetLocale } = await import('@open-codesign/i18n');
    const mockLocaleApi = {
      set: vi.fn((_locale: string) => Promise.resolve('zh-CN')),
    };

    const result = await applyLocaleChange('zh-CN', mockLocaleApi);

    expect(mockLocaleApi.set).toHaveBeenCalledWith('zh-CN');
    expect(mockSetLocale).toHaveBeenCalledWith('zh-CN');
    expect(result).toBe('zh-CN');
  });

  it('applies the locale returned by the IPC bridge, not the requested locale', async () => {
    const { setLocale: mockSetLocale } = await import('@open-codesign/i18n');
    // Bridge normalises 'zh' → 'zh-CN'
    const mockLocaleApi = {
      set: vi.fn((_locale: string) => Promise.resolve('zh-CN')),
    };

    const result = await applyLocaleChange('zh', mockLocaleApi);

    expect(mockLocaleApi.set).toHaveBeenCalledWith('zh');
    expect(mockSetLocale).toHaveBeenCalledWith('zh-CN');
    expect(result).toBe('zh-CN');
  });
});

describe('CPA detection regex', () => {
  const CPA_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1):8317/;

  it('matches http://localhost:8317', () => {
    expect('http://localhost:8317').toMatch(CPA_REGEX);
  });

  it('matches https://127.0.0.1:8317', () => {
    expect('https://127.0.0.1:8317').toMatch(CPA_REGEX);
  });

  it('does not match other ports', () => {
    expect('http://localhost:8080').not.toMatch(CPA_REGEX);
    expect('https://example.com:8317').not.toMatch(CPA_REGEX);
  });
});

describe('CPA detection localStorage dismissal', () => {
  const KEY = 'cpa-detection-dismissed-v1';

  it('reads and writes dismissal flag', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    // Check initial read
    expect(window.localStorage.getItem(KEY)).toBeNull();

    // Simulate user dismissal
    window.localStorage.setItem(KEY, '1');
    expect(setItemSpy).toHaveBeenCalledWith(KEY, '1');

    // Verify we can read it back
    expect(window.localStorage.getItem(KEY)).toBe('1');

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });
});
