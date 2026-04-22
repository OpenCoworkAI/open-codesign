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
