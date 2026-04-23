import { AuthStorage, ModelRegistry } from '@open-codesign/core';
import { describe, expect, it } from 'vitest';
import { populateAuthStorage, registerCustomProviders } from './auth-bridge';

const PLAIN = (s: string) => `plain:${s}`;
const decrypt = (stored: string) =>
  stored.startsWith('plain:') ? stored.slice('plain:'.length) : stored;

function makeConfig(overrides: Record<string, unknown>) {
  return {
    schemaVersion: 3,
    providers: overrides,
  } as never;
}

describe('auth-bridge', () => {
  it('writes anthropic / openai built-in keys into AuthStorage', () => {
    const auth = AuthStorage.inMemory();
    populateAuthStorage(auth, {
      userDataPath: '/tmp',
      config: makeConfig({
        anthropic: {
          id: 'anthropic',
          name: 'Anthropic',
          builtin: true,
          wire: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          defaultModel: 'claude-sonnet-4-6',
          apiKey: { value: PLAIN('sk-ant-test') },
        },
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
        openai: {
          id: 'openai',
          name: 'OpenAI',
          builtin: true,
          wire: 'openai-chat',
          baseUrl: 'https://api.openai.com/v1',
          defaultModel: 'gpt-4o',
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
          apiKey: { value: PLAIN('whq-token') },
          httpHeaders: { 'x-whq-tenant': 'codesign' },
        },
      }),
      decrypt,
    });
    expect(registered).toEqual(['whq']);
  });
});
