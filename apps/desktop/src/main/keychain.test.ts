import { CodesignError, ERROR_CODES, hydrateConfig } from '@open-codesign/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./electron-runtime', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    decryptString: vi.fn(() => ''),
  },
}));

vi.mock('./logger', () => ({
  getLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

import { safeStorage } from './electron-runtime';
import { decryptSecret, migrateSecrets } from './keychain';

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
  it('rejects plaintext secret rows that decrypt to an empty string', () => {
    expectKeychainEmpty(() => decryptSecret('plain:'));
  });

  it('rejects legacy secret rows that decrypt to an empty string', () => {
    expectKeychainEmpty(() => decryptSecret('legacy-ciphertext'));
  });
});

describe('migrateSecrets', () => {
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
