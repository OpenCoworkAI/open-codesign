import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PROVIDERS,
  ConfigV3Schema,
  defaultProviderCapabilities,
  detectWireFromBaseUrl,
  hydrateConfig,
  migrateLegacyToV3,
  parseConfigFlexible,
  resolveProviderCapabilities,
  SUPPORTED_ONBOARDING_PROVIDERS,
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

  it('accepts provider capability profiles', () => {
    const parsed = ConfigV3Schema.parse({
      version: 3,
      activeProvider: 'custom-lite',
      activeModel: 'gpt-4.1',
      secrets: {},
      providers: {
        'custom-lite': {
          id: 'custom-lite',
          name: 'Lite Gateway',
          builtin: false,
          wire: 'openai-chat',
          baseUrl: 'https://proxy.example.com/v1',
          defaultModel: 'gpt-4.1',
          capabilities: {
            supportsKeyless: true,
            supportsModelsEndpoint: false,
            modelDiscoveryMode: 'manual',
          },
        },
      },
    });
    expect(parsed.providers['custom-lite']?.capabilities?.supportsKeyless).toBe(true);
    expect(parsed.providers['custom-lite']?.capabilities?.modelDiscoveryMode).toBe('manual');
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

  it('rejects unknown v3 top-level fields instead of stripping them', () => {
    expect(() =>
      ConfigV3Schema.parse({
        version: 3,
        activeProvider: 'anthropic',
        activeModel: 'claude-sonnet-4-6',
        secrets: {},
        providers: {
          anthropic: BUILTIN_PROVIDERS.anthropic,
        },
        provider: 'anthropic',
      }),
    ).toThrow();
  });

  it('rejects unknown provider entry fields instead of stripping them', () => {
    expect(() =>
      ConfigV3Schema.parse({
        version: 3,
        activeProvider: 'custom',
        activeModel: 'gpt-4o',
        secrets: {},
        providers: {
          custom: {
            id: 'custom',
            name: 'Custom',
            builtin: false,
            wire: 'openai-chat',
            baseUrl: 'https://proxy.example.com/v1',
            defaultModel: 'gpt-4o',
            apiKey: 'sk-should-not-live-here',
          },
        },
      }),
    ).toThrow();
  });

  it('accepts the explicit no-active-provider empty state', () => {
    const parsed = ConfigV3Schema.parse({
      version: 3,
      activeProvider: '',
      activeModel: '',
      secrets: {},
      providers: {},
    });
    expect(parsed.activeProvider).toBe('');
    expect(parsed.activeModel).toBe('');
  });

  it('rejects one-sided active provider/model state', () => {
    expect(() =>
      ConfigV3Schema.parse({
        version: 3,
        activeProvider: 'openai',
        activeModel: '',
        secrets: {},
        providers: {
          openai: BUILTIN_PROVIDERS.openai,
        },
      }),
    ).toThrow(/activeModel/);

    expect(() =>
      ConfigV3Schema.parse({
        version: 3,
        activeProvider: '',
        activeModel: 'gpt-4o',
        secrets: {},
        providers: {},
      }),
    ).toThrow(/activeModel/);
  });

  it('rejects active providers that have no provider entry', () => {
    expect(() =>
      ConfigV3Schema.parse({
        version: 3,
        activeProvider: 'custom-missing',
        activeModel: 'gpt-test',
        secrets: {
          'custom-missing': { ciphertext: 'plain:sk-test' },
        },
        providers: {},
      }),
    ).toThrow(/activeProvider/);
  });

  it('parses schema-versioned image generation settings', () => {
    const parsed = ConfigV3Schema.parse({
      version: 3,
      activeProvider: 'openai',
      activeModel: 'gpt-4o',
      secrets: {},
      providers: {
        openai: BUILTIN_PROVIDERS.openai,
      },
      imageGeneration: {
        schemaVersion: 1,
        enabled: true,
        provider: 'openrouter',
        credentialMode: 'custom',
        model: 'openai/gpt-5.4-image-2',
        apiKey: { ciphertext: 'plain:sk-test', mask: 'sk-***test' },
      },
    });
    expect(parsed.imageGeneration?.enabled).toBe(true);
    expect(parsed.imageGeneration?.quality).toBe('high');
    expect(parsed.imageGeneration?.size).toBe('1536x1024');
  });

  it('rejects unknown image generation settings fields instead of stripping them', () => {
    expect(() =>
      ConfigV3Schema.parse({
        version: 3,
        activeProvider: 'openai',
        activeModel: 'gpt-4o',
        secrets: {},
        providers: {
          openai: BUILTIN_PROVIDERS.openai,
        },
        imageGeneration: {
          schemaVersion: 1,
          enabled: true,
          provider: 'openai',
          credentialMode: 'inherit',
          model: 'gpt-image-2',
          quality: 'high',
          size: '1536x1024',
          outputFormat: 'png',
          typoedField: true,
        },
      }),
    ).toThrow();
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

  it('validates legacy migration output against v3 invariants', () => {
    expect(() =>
      parseConfigFlexible({
        version: 2,
        provider: 'openai',
        modelPrimary: '',
        secrets: {},
      }),
    ).toThrow(/activeModel/);
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

  it('preserves image generation settings when stripping derived fields', () => {
    const hydrated = hydrateConfig({
      version: 3,
      activeProvider: 'openai',
      activeModel: 'gpt-4o',
      secrets: {},
      providers: { openai: BUILTIN_PROVIDERS.openai },
      imageGeneration: {
        schemaVersion: 1,
        enabled: true,
        provider: 'openai',
        credentialMode: 'inherit',
        model: 'gpt-image-2',
        quality: 'high',
        size: '1536x1024',
        outputFormat: 'png',
      },
    });
    expect(toPersistedV3(hydrated).imageGeneration?.model).toBe('gpt-image-2');
  });
});

describe('provider capability helpers', () => {
  it('derives static-hint model discovery for providers with modelsHint', () => {
    const caps = defaultProviderCapabilities('chatgpt-codex', {
      wire: 'openai-codex-responses',
      requiresApiKey: false,
      modelsHint: ['gpt-5.4'],
    });
    expect(caps.supportsKeyless).toBe(true);
    expect(caps.supportsModelsEndpoint).toBe(false);
    expect(caps.modelDiscoveryMode).toBe('static-hint');
  });

  it('lets explicit capability overrides win over defaults', () => {
    const caps = resolveProviderCapabilities('custom-lite', {
      wire: 'openai-chat',
      capabilities: {
        supportsKeyless: true,
        supportsModelsEndpoint: false,
        modelDiscoveryMode: 'manual',
      },
    });
    expect(caps.supportsKeyless).toBe(true);
    expect(caps.supportsModelsEndpoint).toBe(false);
    expect(caps.modelDiscoveryMode).toBe('manual');
  });
});
