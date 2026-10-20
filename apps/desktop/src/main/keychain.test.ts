import { CodesignError, ERROR_CODES, hydrateConfig } from '@open-codesign/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMock = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('./electron-runtime', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`encrypted:${s}`, 'utf8')),
    decryptString: vi.fn(() => ''),
  },
}));

vi.mock('./logger', () => ({
  getLogger: () => loggerMock,
}));

import { safeStorage } from './electron-runtime';
import { decryptSecret, encryptSecret, migrateSecrets } from './keychain';

beforeEach(() => {
  vi.clearAllMocks();
});

function expectKeychainEmpty(fn: () => unknown): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(CodesignError);
    expect((err as CodesignError).code).toBe(ERROR_CODES.KEYCHAIN_EMPTY_INPUT);
    return;
  }
  throw new Error('Expected KEYCHAIN_EMPTY_INPUT');
}

describe('decryptSecret', () => {
  it('encrypts new secrets with safeStorage when available', () => {
    const stored = encryptSecret('sk-test-secret');
    expect(stored).toBe(`safe:${Buffer.from('encrypted:sk-test-secret').toString('base64')}`);
  });

  it('falls back to plaintext rows when encryption is unavailable', () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValueOnce(false);
    expect(encryptSecret('sk-test-secret')).toBe('plain:sk-test-secret');
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'keychain.safeStorage.unavailable_plaintext_fallback',
    );
  });

  it('reads existing plaintext secret rows', () => {
    expect(decryptSecret('plain:sk-test-secret')).toBe('sk-test-secret');
  });

  it('reads new encrypted secret rows', () => {
    vi.mocked(safeStorage.decryptString).mockReturnValueOnce('sk-test-secret');
    const stored = `safe:${Buffer.from('ciphertext').toString('base64')}`;
    expect(decryptSecret(stored)).toBe('sk-test-secret');
  });

  it('rejects plaintext secret rows that decrypt to an empty string', () => {
    expectKeychainEmpty(() => decryptSecret('plain:'));
  });

  it('rejects legacy secret rows that decrypt to an empty string', () => {
    expectKeychainEmpty(() => decryptSecret('legacy-ciphertext'));
  });
});

describe('migrateSecrets', () => {
  it('migrates plaintext rows to encrypted rows when safeStorage is available', () => {
    const cfg = hydrateConfig({
      version: 3,
      activeProvider: 'openai',
      activeModel: 'gpt-5.4',
      providers: {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          builtin: true,
          wire: 'openai-chat',
          baseUrl: 'https://api.openai.com/v1',
          defaultModel: 'gpt-5.4',
        },
      },
      secrets: { openai: { ciphertext: 'plain:sk-test-secret', mask: '' } },
    });

    const migrated = migrateSecrets(cfg);
    expect(migrated.changed).toBe(true);
    expect(migrated.config.secrets['openai']?.ciphertext).toBe(
      `safe:${Buffer.from('encrypted:sk-test-secret').toString('base64')}`,
    );
    expect(migrated.config.secrets['openai']?.mask).toBe('sk-***cret');
  });

  it('keeps plaintext rows when safeStorage is unavailable', () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    const cfg = hydrateConfig({
      version: 3,
      activeProvider: 'openai',
      activeModel: 'gpt-5.4',
      providers: {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          builtin: true,
          wire: 'openai-chat',
          baseUrl: 'https://api.openai.com/v1',
          defaultModel: 'gpt-5.4',
        },
      },
      secrets: { openai: { ciphertext: 'plain:sk-test-secret', mask: '' } },
    });

    const migrated = migrateSecrets(cfg);
    expect(migrated.changed).toBe(true);
    expect(migrated.config.secrets['openai']?.ciphertext).toBe('plain:sk-test-secret');
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
  });

  it('preserves legacy secret rows that decrypt to an empty string during migration', () => {
    vi.mocked(safeStorage.decryptString).mockReturnValueOnce('');
    const cfg = hydrateConfig({
      version: 3,
      activeProvider: 'openai',
      activeModel: 'gpt-5.4',
      providers: {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          builtin: true,
          wire: 'openai-chat',
          baseUrl: 'https://api.openai.com/v1',
          defaultModel: 'gpt-5.4',
        },
      },
      secrets: { openai: { ciphertext: 'legacy-ciphertext', mask: '' } },
    });

    const migrated = migrateSecrets(cfg);
    expect(migrated).toEqual({ config: cfg, changed: false });
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'keychain.migration.skipped',
      expect.objectContaining({ provider: 'openai' }),
    );
  });

  it('preserves empty plaintext rows during migration instead of blocking boot', () => {
    const cfg = hydrateConfig({
      version: 3,
      activeProvider: 'openai',
      activeModel: 'gpt-5.4',
      providers: {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          builtin: true,
          wire: 'openai-chat',
          baseUrl: 'https://api.openai.com/v1',
          defaultModel: 'gpt-5.4',
        },
      },
      secrets: { openai: { ciphertext: 'plain:', mask: '' } },
    });

    const migrated = migrateSecrets(cfg);
    expect(migrated).toEqual({ config: cfg, changed: false });
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'keychain.migration.skipped',
      expect.objectContaining({ provider: 'openai' }),
    );
  });
});

describe('migration recovery for optional and unreadable credentials', () => {
  it.each([
    'tvly-missing-plain-prefix',
    'safe:broken-ciphertext',
    'legacy-ciphertext',
  ])('retains an unreadable %s without logging its value or accepting it as plaintext', (stored) => {
    const rawError = 'secret-must-never-be-logged';
    vi.mocked(safeStorage.decryptString).mockImplementationOnce(() => {
      throw new Error(rawError);
    });
    const cfg = hydrateConfig({
      version: 3,
      activeProvider: '',
      activeModel: '',
      providers: {},
      secrets: { tavily: { ciphertext: stored } },
    });
    const migrated = migrateSecrets(cfg);
    expect(migrated).toEqual({ config: cfg, changed: false });
    const logged = JSON.stringify(loggerMock.warn.mock.calls);
    expect(logged).toContain('tavily');
    expect(logged).not.toContain(stored);
    expect(logged).not.toContain(rawError);
    expect(() => decryptSecret(stored)).toThrow(CodesignError);
  });

  it('still migrates good entries and leaves bad entries untouched in a mixed config', () => {
    vi.mocked(safeStorage.decryptString).mockImplementationOnce(() => {
      throw new Error('bad legacy key');
    });
    const cfg = hydrateConfig({
      version: 3,
      activeProvider: '',
      activeModel: '',
      providers: {},
      secrets: {
        tavily: { ciphertext: 'tvly-missing-plain-prefix' },
        openai: { ciphertext: 'plain:sk-valid-secret' },
      },
    });
    const before = structuredClone(cfg);
    const migrated = migrateSecrets(cfg);
    expect(migrated.changed).toBe(true);
    expect(migrated.config.secrets['tavily']).toEqual(cfg.secrets['tavily']);
    expect(migrated.config.secrets['openai']?.ciphertext).toMatch(/^safe:/);
    expect(cfg).toEqual(before);
  });

  it('keeps unreadable encrypted entries when the OS keychain is unavailable', () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValueOnce(false);
    const cfg = hydrateConfig({
      version: 3,
      activeProvider: '',
      activeModel: '',
      providers: {},
      secrets: { tavily: { ciphertext: 'safe:encrypted-on-another-machine' } },
    });
    expect(migrateSecrets(cfg)).toEqual({ config: cfg, changed: false });
    expect(safeStorage.decryptString).not.toHaveBeenCalled();
  });

  it('keeps explicit plaintext Tavily credentials usable during migration', () => {
    const cfg = hydrateConfig({
      version: 3,
      activeProvider: '',
      activeModel: '',
      providers: {},
      secrets: { tavily: { ciphertext: 'plain:tvly-test-only-key' } },
    });
    const migrated = migrateSecrets(cfg);
    expect(migrated.changed).toBe(true);
    expect(migrated.config.secrets['tavily']?.ciphertext).toBe(
      `safe:${Buffer.from('encrypted:tvly-test-only-key').toString('base64')}`,
    );
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });
});
