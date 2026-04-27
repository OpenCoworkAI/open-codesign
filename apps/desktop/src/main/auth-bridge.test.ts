import { AuthStorage, ModelRegistry } from '@open-codesign/core';
import type { Config, ProviderEntry, SecretRef } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import { populateAuthStorage, registerCustomProviders } from './auth-bridge';

const PLAIN = (s: string) => `plain:${s}`;
const decrypt = (stored: string) => {
  if (stored === 'bad') throw new Error('bad ciphertext');
  return stored.startsWith('plain:') ? stored.slice('plain:'.length) : stored;
};

function makeConfig(input: {
  activeProvider?: string;
  providers: Record<string, ProviderEntry>;
  secrets?: Record<string, SecretRef>;
}): Config {
  return {
    version: 3,
    activeProvider: input.activeProvider ?? '',
    activeModel: '',
    secrets: input.secrets ?? {},
    providers: input.providers,
    provider: input.activeProvider ?? '',
    modelPrimary: '',
    baseUrls: {},
  };
}

describe('auth-bridge', () => {
  it('writes anthropic / openai built-in keys into AuthStorage', () => {
    const auth = AuthStorage.inMemory();
    populateAuthStorage(auth, {
      userDataPath: '/tmp',
      config: makeConfig({
        activeProvider: 'anthropic',
        providers: {
          anthropic: {
            id: 'anthropic',
            name: 'Anthropic',
            builtin: true,
            wire: 'anthropic',
            baseUrl: 'https://api.anthropic.com',
            defaultModel: 'claude-sonnet-4-6',
          },
        },
        secrets: { anthropic: { ciphertext: PLAIN('sk-ant-test') } },
      }),
      decrypt,
    });
    const stored = auth.get('anthropic');
    expect(stored).toEqual({ type: 'api_key', key: 'sk-ant-test' });
  });

  it('skips entries without a stored key', () => {
    const auth = AuthStorage.inMemory();
    populateAuthStorage(auth, {
      userDataPath: '/tmp',
      config: makeConfig({
        providers: {
          openai: {
            id: 'openai',
            name: 'OpenAI',
            builtin: true,
            wire: 'openai-chat',
            baseUrl: 'https://api.openai.com/v1',
            defaultModel: 'gpt-4o',
          },
        },
      }),
      decrypt,
    });
    expect(auth.get('openai')).toBeUndefined();
  });

  it('registerCustomProviders only registers non-built-in entries', () => {
    const auth = AuthStorage.inMemory();
    const registry = ModelRegistry.create(auth);
    const registered = registerCustomProviders(registry, {
      userDataPath: '/tmp',
      config: makeConfig({
        providers: {
          anthropic: {
            id: 'anthropic',
            name: 'Anthropic',
            builtin: true,
            wire: 'anthropic',
            baseUrl: 'https://api.anthropic.com',
            defaultModel: 'claude-sonnet-4-6',
          },
          whq: {
            id: 'whq',
            name: 'Whq Gateway',
            builtin: false,
            wire: 'anthropic',
            baseUrl: 'https://gateway.example.com',
            defaultModel: 'claude-opus-4-7',
            httpHeaders: { 'x-whq-tenant': 'codesign' },
          },
        },
        secrets: { whq: { ciphertext: PLAIN('whq-token') } },
      }),
      decrypt,
    });
    expect(registered).toEqual(['whq']);
  });

  it('throws when a stored secret cannot be decrypted', () => {
    const auth = AuthStorage.inMemory();
    expect(() =>
      populateAuthStorage(auth, {
        userDataPath: '/tmp',
        config: makeConfig({
          activeProvider: 'openai',
          providers: {
            openai: {
              id: 'openai',
              name: 'OpenAI',
              builtin: true,
              wire: 'openai-chat',
              baseUrl: 'https://api.openai.com/v1',
              defaultModel: 'gpt-4o',
            },
          },
          secrets: { openai: { ciphertext: 'bad' } },
        }),
        decrypt,
      }),
    ).toThrow(/Failed to decrypt API key for provider "openai"/);
  });

  it('throws when the active non-keyless provider has no stored secret', () => {
    const auth = AuthStorage.inMemory();
    expect(() =>
      populateAuthStorage(auth, {
        userDataPath: '/tmp',
        config: makeConfig({
          activeProvider: 'openai',
          providers: {
            openai: {
              id: 'openai',
              name: 'OpenAI',
              builtin: true,
              wire: 'openai-chat',
              baseUrl: 'https://api.openai.com/v1',
              defaultModel: 'gpt-4o',
            },
          },
        }),
        decrypt,
      }),
    ).toThrow(/No API key stored for active provider "openai"/);
  });
});
