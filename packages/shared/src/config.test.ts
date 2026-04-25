import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PROVIDERS,
  ConfigV3Schema,
  SUPPORTED_ONBOARDING_PROVIDERS,
  detectWireFromBaseUrl,
  hydrateConfig,
  migrateLegacyToV3,
  parseConfigFlexible,
  toPersistedV3,
} from './config';

describe('config v3 schema', () => {
  it('parses a minimal v3 config', () => {
    const raw = {
      version: 3,
      activeProvider: 'anthropic',
      activeModel: 'claude-sonnet-4-6',
      secrets: {},
      providers: {
        anthropic: BUILTIN_PROVIDERS.anthropic,
      },
    };
    const parsed = ConfigV3Schema.parse(raw);
    expect(parsed.version).toBe(3);
    expect(parsed.activeProvider).toBe('anthropic');
  });

  it('rejects unknown wire values', () => {
    const bad = {
      version: 3,
      activeProvider: 'x',
      activeModel: 'm',
      secrets: {},
      providers: {
        x: { ...BUILTIN_PROVIDERS.anthropic, id: 'x', wire: 'bogus' },
      },
    };
    expect(() => ConfigV3Schema.parse(bad)).toThrow();
  });

  it('parses provider capabilities for strict OpenAI-compatible gateways', () => {
    const raw = {
      version: 3,
      activeProvider: 'bedrock-proxy',
      activeModel: 'anthropic::claude-4-6-sonnet',
      secrets: {},
      providers: {
        'bedrock-proxy': {
          id: 'bedrock-proxy',
          name: 'Bedrock Proxy',
          builtin: false,
          wire: 'openai-chat',
          baseUrl: 'https://bedrock-proxy.example.test/v1',
          defaultModel: 'anthropic::claude-4-6-sonnet',
          capabilities: { supportsReasoning: false },
        },
      },
    };

    const parsed = ConfigV3Schema.parse(raw);
    expect(parsed.providers['bedrock-proxy']?.capabilities?.supportsReasoning).toBe(false);
  });
});

describe('migrateLegacyToV3', () => {
  it('seeds three builtin providers from an empty v2', () => {
    const legacy = {
      version: 2 as const,
      provider: 'anthropic' as const,
      modelPrimary: 'claude-sonnet-4-6',
      secrets: {},
      baseUrls: {},
    };
    const v3 = migrateLegacyToV3(legacy);
    expect(v3.version).toBe(3);
    expect(v3.activeProvider).toBe('anthropic');
    expect(v3.activeModel).toBe('claude-sonnet-4-6');
    for (const id of SUPPORTED_ONBOARDING_PROVIDERS) {
      expect(v3.providers[id]).toBeDefined();
      expect(v3.providers[id]?.builtin).toBe(true);
    }
  });

  it('preserves encrypted secrets across the migration', () => {
    const legacy = {
      version: 2 as const,
      provider: 'openai' as const,
      modelPrimary: 'gpt-4o',
      secrets: { openai: { ciphertext: 'abc==' } },
      baseUrls: {},
    };
    const v3 = migrateLegacyToV3(legacy);
    expect(v3.secrets['openai']?.ciphertext).toBe('abc==');
  });

  it('overlays custom baseUrl onto builtin provider entry', () => {
    const legacy = {
      version: 2 as const,
      provider: 'anthropic' as const,
      modelPrimary: 'claude-sonnet-4-6',
      secrets: {},
      baseUrls: { anthropic: { baseUrl: 'http://localhost:4000' } },
    };
    const v3 = migrateLegacyToV3(legacy);
    expect(v3.providers['anthropic']?.baseUrl).toBe('http://localhost:4000');
  });

  it('drops legacy modelFast field silently', () => {
    const legacy = {
      version: 1 as const,
      provider: 'anthropic' as const,
      modelPrimary: 'claude-sonnet-4-6',
      modelFast: 'claude-haiku',
      secrets: {},
      baseUrls: {},
    };
    const v3 = migrateLegacyToV3(legacy);
    expect(v3.version).toBe(3);
    expect('modelFast' in v3).toBe(false);
  });
});

describe('parseConfigFlexible', () => {
  it('accepts a v3 object as-is', () => {
    const raw = {
      version: 3,
      activeProvider: 'anthropic',
      activeModel: 'claude-sonnet-4-6',
      secrets: {},
      providers: { anthropic: BUILTIN_PROVIDERS.anthropic },
    };
    const out = parseConfigFlexible(raw);
    expect(out.version).toBe(3);
  });

  it('migrates a v1 object transparently', () => {
    const raw = {
      version: 1,
      provider: 'openrouter',
      modelPrimary: 'anthropic/claude-sonnet-4.6',
      secrets: { openrouter: { ciphertext: 'x' } },
    };
    const out = parseConfigFlexible(raw);
    expect(out.version).toBe(3);
    expect(out.activeProvider).toBe('openrouter');
    expect(Object.keys(out.providers)).toContain('openrouter');
  });

  it('migrates a v2 object transparently', () => {
    const raw = {
      version: 2,
      provider: 'openai',
      modelPrimary: 'gpt-4o',
      secrets: { openai: { ciphertext: 'y' } },
      baseUrls: { openai: { baseUrl: 'https://proxy.example.com/v1' } },
    };
    const out = parseConfigFlexible(raw);
    expect(out.version).toBe(3);
    expect(out.providers['openai']?.baseUrl).toBe('https://proxy.example.com/v1');
  });

  it('throws on schema mismatch', () => {
    expect(() => parseConfigFlexible({ provider: 'nope', modelPrimary: 'x' })).toThrow();
  });
});

describe('detectWireFromBaseUrl', () => {
  it('routes Anthropic URLs to the anthropic wire', () => {
    expect(detectWireFromBaseUrl('https://api.anthropic.com')).toBe('anthropic');
  });
  it('routes Azure to openai-responses', () => {
    expect(detectWireFromBaseUrl('https://org.openai.azure.com/openai')).toBe('openai-responses');
  });
  it('defaults to openai-chat', () => {
    expect(detectWireFromBaseUrl('https://api.deepseek.com/v1')).toBe('openai-chat');
    expect(detectWireFromBaseUrl('http://localhost:11434/v1')).toBe('openai-chat');
  });
});

describe('hydrateConfig / toPersistedV3', () => {
  it('round-trips cleanly — derived fields mirror v3 state', () => {
    const v3 = {
      version: 3 as const,
      activeProvider: 'anthropic',
      activeModel: 'claude-sonnet-4-6',
      secrets: {},
      providers: {
        anthropic: { ...BUILTIN_PROVIDERS.anthropic, baseUrl: 'http://localhost:4000' },
      },
    };
    const hydrated = hydrateConfig(v3);
    expect(hydrated.provider).toBe('anthropic');
    expect(hydrated.modelPrimary).toBe('claude-sonnet-4-6');
    expect(hydrated.baseUrls['anthropic']?.baseUrl).toBe('http://localhost:4000');
    const persisted = toPersistedV3(hydrated);
    expect(persisted).not.toHaveProperty('provider');
    expect(persisted).not.toHaveProperty('baseUrls');
    expect(persisted.version).toBe(3);
  });
});
