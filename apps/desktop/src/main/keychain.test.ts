import { CodesignError, ERROR_CODES, hydrateConfig } from '@open-codesign/shared';
import { describe, expect, it, vi } from 'vitest';

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

  it('rejects legacy secret rows that decrypt to an empty string', () => {
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

    expectKeychainEmpty(() => migrateSecrets(cfg));
  });

  it('rejects plaintext rows that need migration but contain an empty secret', () => {
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

    expectKeychainEmpty(() => migrateSecrets(cfg));
  });
});
