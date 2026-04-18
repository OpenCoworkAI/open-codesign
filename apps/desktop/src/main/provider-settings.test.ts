import { CodesignError, type Config } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import {
  assertProviderHasStoredSecret,
  getAddProviderDefaults,
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
