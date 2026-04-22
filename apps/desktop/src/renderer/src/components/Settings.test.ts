import { describe, expect, it, vi } from 'vitest';
import {
  TIMEOUT_OPTION_SECONDS,
  applyLocaleChange,
  computeModelOptions,
  resolveTimeoutOptions,
} from './Settings';

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
describe('computeModelOptions', () => {
  const suffix = '(active, not in provider list)';

  it('returns null while the list is still loading', () => {
    expect(
      computeModelOptions({ models: null, activeModelId: 'opus-4-7', notInListSuffix: suffix }),
    ).toBeNull();
  });

  it('returns null when the provider returned an empty list', () => {
    expect(
      computeModelOptions({ models: [], activeModelId: 'opus-4-7', notInListSuffix: suffix }),
    ).toBeNull();
  });

  it('returns the fetched list unchanged when the active model is in it', () => {
    const result = computeModelOptions({
      models: ['haiku', 'sonnet', 'opus-4-7'],
      activeModelId: 'opus-4-7',
      notInListSuffix: suffix,
    });
    expect(result).toEqual([
      { value: 'haiku', label: 'haiku' },
      { value: 'sonnet', label: 'sonnet' },
      { value: 'opus-4-7', label: 'opus-4-7' },
    ]);
  });

  it('pins the active model at the top when it is not in the fetched list (issue #136)', () => {
    const result = computeModelOptions({
      models: ['haiku', 'sonnet'],
      activeModelId: 'opus-4-7',
      notInListSuffix: suffix,
    });
    expect(result).toEqual([
      { value: 'opus-4-7', label: `opus-4-7 ${suffix}` },
      { value: 'haiku', label: 'haiku' },
      { value: 'sonnet', label: 'sonnet' },
    ]);
  });

  it('does not inject anything for inactive rows (activeModelId = null)', () => {
    const result = computeModelOptions({
      models: ['haiku', 'sonnet'],
      activeModelId: null,
      notInListSuffix: suffix,
    });
    expect(result).toEqual([
      { value: 'haiku', label: 'haiku' },
      { value: 'sonnet', label: 'sonnet' },
    ]);
  });
});

describe('resolveTimeoutOptions', () => {
  it('covers the default 1200s stored value and long-generation 30m / 1h / 2h choices so users can configure what they need without hitting the old 300s ceiling', () => {
    expect(TIMEOUT_OPTION_SECONDS).toContain(1200);
    expect(TIMEOUT_OPTION_SECONDS).toContain(1800);
    expect(TIMEOUT_OPTION_SECONDS).toContain(3600);
    expect(TIMEOUT_OPTION_SECONDS).toContain(7200);
  });

  it('returns the canonical options unchanged when the stored value is already present', () => {
    const options = resolveTimeoutOptions(1200);
    expect(options).toEqual([...TIMEOUT_OPTION_SECONDS]);
  });

  it("merges a stored value that is not in the canonical list and keeps the list sorted so the select shows the user's existing choice instead of silently downgrading on save", () => {
    const options = resolveTimeoutOptions(900);
    expect(options).toContain(900);
    expect(options).toEqual([...options].sort((a, b) => a - b));
    // Canonical entries are preserved.
    for (const sec of TIMEOUT_OPTION_SECONDS) {
      expect(options).toContain(sec);
    }
  });

  it('ignores non-positive or non-finite stored values rather than injecting bogus options', () => {
    expect(resolveTimeoutOptions(0)).toEqual([...TIMEOUT_OPTION_SECONDS]);
    expect(resolveTimeoutOptions(-1)).toEqual([...TIMEOUT_OPTION_SECONDS]);
    expect(resolveTimeoutOptions(Number.NaN)).toEqual([...TIMEOUT_OPTION_SECONDS]);
    expect(resolveTimeoutOptions(Number.POSITIVE_INFINITY)).toEqual([...TIMEOUT_OPTION_SECONDS]);
  });
});
