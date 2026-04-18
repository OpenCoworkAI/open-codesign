import { CodesignError, type Config } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import {
  assertProviderHasStoredSecret,
  computeDeleteProviderResult,
  getAddProviderDefaults,
  resolveActiveModel,
  toProviderRows,
} from './provider-settings';

describe('getAddProviderDefaults', () => {
  it('activates the newly added provider when the cached active provider has no saved secret', () => {
    const cfg: Config = {
      version: 1,
      provider: 'openai',
      modelPrimary: 'gpt-4o',
      modelFast: 'gpt-4o-mini',
      secrets: {},
      baseUrls: {},
    };

    const defaults = getAddProviderDefaults(cfg, {
      provider: 'anthropic',
      modelPrimary: 'claude-sonnet-4-6',
      modelFast: 'claude-haiku-3',
    });

    expect(defaults).toEqual({
      activeProvider: 'anthropic',
      modelPrimary: 'claude-sonnet-4-6',
      modelFast: 'claude-haiku-3',
    });
  });
});

describe('toProviderRows', () => {
  it('returns a row with error:decryption_failed and empty maskedKey when decrypt throws', () => {
    const cfg: Config = {
      version: 1,
      provider: 'openai',
      modelPrimary: 'gpt-4o',
      modelFast: 'gpt-4o-mini',
      secrets: {
        openai: { ciphertext: 'bad-ciphertext' },
      },
      baseUrls: {},
    };

    // Should NOT throw — decryption failure is now soft-handled.
    const rows = toProviderRows(cfg, () => {
      throw new Error('safeStorage unavailable');
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.error).toBe('decryption_failed');
    expect(rows[0]?.maskedKey).toBe('');
    expect(rows[0]?.provider).toBe('openai');
  });

  it('returns a normal masked row when decrypt succeeds', () => {
    const cfg: Config = {
      version: 1,
      provider: 'anthropic',
      modelPrimary: 'claude-sonnet-4-6',
      modelFast: 'claude-haiku-3',
      secrets: {
        anthropic: { ciphertext: 'enc' },
      },
      baseUrls: {},
    };

    const rows = toProviderRows(cfg, () => 'sk-ant-api03-abcdefghijklmnop');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.error).toBeUndefined();
    expect(rows[0]?.maskedKey).toMatch(/sk-.*\*{3}/);
    expect(rows[0]?.isActive).toBe(true);
  });
});

describe('assertProviderHasStoredSecret', () => {
  it('throws when activating a provider without a stored API key', () => {
    const cfg: Config = {
      version: 1,
      provider: 'openai',
      modelPrimary: 'gpt-4o',
      modelFast: 'gpt-4o-mini',
      secrets: {
        openai: { ciphertext: 'ciphertext' },
      },
      baseUrls: {},
    };

    expect(() => assertProviderHasStoredSecret(cfg, 'anthropic')).toThrow(CodesignError);
  });
});

describe('computeDeleteProviderResult', () => {
  it('switches to the next provider default models when the active provider is deleted', () => {
    const cfg: Config = {
      version: 1,
      provider: 'anthropic',
      modelPrimary: 'claude-sonnet-4-6',
      modelFast: 'claude-haiku-3',
      secrets: {
        anthropic: { ciphertext: 'enc-ant' },
        openai: { ciphertext: 'enc-oai' },
      },
      baseUrls: {},
    };

    const result = computeDeleteProviderResult(cfg, 'anthropic');

    expect(result.nextActive).toBe('openai');
    expect(result.modelPrimary).toBe('gpt-4o');
    expect(result.modelFast).toBe('gpt-4o-mini');
  });

  it('keeps existing models when a non-active provider is deleted', () => {
    const cfg: Config = {
      version: 1,
      provider: 'anthropic',
      modelPrimary: 'claude-sonnet-4-6',
      modelFast: 'claude-haiku-3',
      secrets: {
        anthropic: { ciphertext: 'enc-ant' },
        openai: { ciphertext: 'enc-oai' },
      },
      baseUrls: {},
    };

    const result = computeDeleteProviderResult(cfg, 'openai');

    expect(result.nextActive).toBe('anthropic');
    expect(result.modelPrimary).toBe('claude-sonnet-4-6');
    expect(result.modelFast).toBe('claude-haiku-3');
  });

  it('returns nextActive null and empty models when the last provider is deleted', () => {
    const cfg: Config = {
      version: 1,
      provider: 'openai',
      modelPrimary: 'gpt-4o',
      modelFast: 'gpt-4o-mini',
      secrets: {
        openai: { ciphertext: 'enc-oai' },
      },
      baseUrls: {},
    };

    const result = computeDeleteProviderResult(cfg, 'openai');

    expect(result.nextActive).toBeNull();
    expect(result.modelPrimary).toBe('');
    expect(result.modelFast).toBe('');
  });
});

describe('resolveActiveModel', () => {
  const baseCfg: Config = {
    version: 1,
    provider: 'openrouter',
    modelPrimary: 'anthropic/claude-sonnet-4.6',
    modelFast: 'anthropic/claude-haiku-3',
    secrets: {
      openai: { ciphertext: 'enc-oai' },
      openrouter: { ciphertext: 'enc-or' },
    },
    baseUrls: {
      openai: { baseUrl: 'https://api.duckcoding.ai/v1' },
    },
  };

  it('returns the canonical active provider when the hint already matches', () => {
    const result = resolveActiveModel(baseCfg, {
      provider: 'openrouter',
      modelId: 'anthropic/claude-haiku-3',
    });

    expect(result.overridden).toBe(false);
    expect(result.model).toEqual({
      provider: 'openrouter',
      // Hint modelId is preserved so the renderer can pick fast vs primary.
      modelId: 'anthropic/claude-haiku-3',
    });
    expect(result.baseUrl).toBeNull();
  });

  it('snaps a stale hint back to the canonical active provider and modelPrimary', () => {
    // Reproduces the reported bug: Settings UI shows OpenRouter Active, but the
    // renderer's stale store sends openai + duckcoding-style modelId. The
    // resolver must override so the actual call lands on openrouter.
    const result = resolveActiveModel(baseCfg, {
      provider: 'openai',
      modelId: 'gpt-4o',
    });

    expect(result.overridden).toBe(true);
    expect(result.model).toEqual({
      provider: 'openrouter',
      modelId: 'anthropic/claude-sonnet-4.6',
    });
    expect(result.baseUrl).toBeNull();
  });

  it('threads through the per-provider baseUrl for the canonical active', () => {
    const cfg: Config = { ...baseCfg, provider: 'openai', modelPrimary: 'gpt-4o' };
    const result = resolveActiveModel(cfg, { provider: 'openai', modelId: 'gpt-4o' });

    expect(result.overridden).toBe(false);
    expect(result.baseUrl).toBe('https://api.duckcoding.ai/v1');
  });

  it('ignores stale hint baseUrl entry and returns active provider baseUrl on override', () => {
    // Reproduces the Codex finding: hint says {openai, duckcoding}, active is
    // openrouter. The resolver must report openrouter's baseUrl (null here) so
    // the IPC handler does not route the openrouter key to duckcoding.
    const cfg: Config = {
      ...baseCfg,
      baseUrls: {
        openai: { baseUrl: 'https://api.duckcoding.ai/v1' },
        openrouter: { baseUrl: 'https://openrouter.ai/api/v1' },
      },
    };
    const result = resolveActiveModel(cfg, { provider: 'openai', modelId: 'gpt-4o' });

    expect(result.overridden).toBe(true);
    expect(result.model.provider).toBe('openrouter');
    expect(result.baseUrl).toBe('https://openrouter.ai/api/v1');
  });

  it('throws PROVIDER_KEY_MISSING when the active provider has no stored secret', () => {
    const cfg: Config = {
      ...baseCfg,
      provider: 'anthropic',
      modelPrimary: 'claude-sonnet-4-6',
      modelFast: 'claude-haiku-3',
    };
    expect(() =>
      resolveActiveModel(cfg, { provider: 'anthropic', modelId: 'claude-sonnet-4-6' }),
    ).toThrowError(CodesignError);
  });
});
