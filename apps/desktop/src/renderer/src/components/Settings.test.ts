import { describe, expect, it, vi } from 'vitest';
import { applyLocaleChange, applyValidateResult, canSaveProvider } from './Settings';

vi.mock('@open-codesign/i18n', () => ({
  setLocale: vi.fn((locale: string) => Promise.resolve(locale)),
  useT: () => (key: string) => key,
}));

describe('canSaveProvider', () => {
  it('requires a validated API key before enabling save', () => {
    expect(
      canSaveProvider({
        apiKey: 'sk-test',
        validated: false,
        validating: false,
      }),
    ).toBe(false);
  });

  it('stays disabled while validation is still in progress', () => {
    expect(
      canSaveProvider({
        apiKey: 'sk-test',
        validated: true,
        validating: true,
      }),
    ).toBe(false);
  });

  it('allows saving only after validation succeeds', () => {
    expect(
      canSaveProvider({
        apiKey: 'sk-test',
        validated: true,
        validating: false,
      }),
    ).toBe(true);
  });
});

describe('applyValidateResult', () => {
  const baseForm = {
    provider: 'anthropic' as const,
    apiKey: 'sk-ant-original',
    baseUrl: '',
    modelPrimary: 'claude-sonnet-4-6',
    modelFast: 'claude-haiku-3',
    validating: true,
    error: null,
    errorCode: null,
    validated: false,
  };

  const matchingSnapshot = {
    provider: 'anthropic' as const,
    apiKey: 'sk-ant-original',
    baseUrl: '',
  };

  it('marks form validated when the snapshot still matches the current form', () => {
    const next = applyValidateResult(baseForm, matchingSnapshot, true, undefined);
    expect(next.validated).toBe(true);
    expect(next.validating).toBe(false);
  });

  it('sets error when validation fails and the snapshot matches', () => {
    const next = applyValidateResult(baseForm, matchingSnapshot, false, 'Invalid API key');
    expect(next.error).toBe('Invalid API key');
    expect(next.validated).toBe(false);
    expect(next.validating).toBe(false);
  });

  it('discards the result when the API key changed while awaiting', () => {
    const changedKeyForm = { ...baseForm, apiKey: 'sk-ant-changed' };
    const next = applyValidateResult(changedKeyForm, matchingSnapshot, true, undefined);
    // Should return the unchanged form — validated must not flip to true.
    expect(next).toBe(changedKeyForm);
    expect(next.validated).toBe(false);
  });

  it('discards the result when the provider changed while awaiting', () => {
    const changedProviderForm = { ...baseForm, provider: 'openai' as const };
    const next = applyValidateResult(changedProviderForm, matchingSnapshot, true, undefined);
    expect(next).toBe(changedProviderForm);
    expect(next.validated).toBe(false);
  });
});

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
