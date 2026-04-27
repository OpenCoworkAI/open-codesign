/**
 * Tests for settings IPC channel versioning.
 *
 * These tests verify that registerOnboardingIpc exposes only the versioned
 * v1 settings channels. v0.2 has not shipped yet, so renderer/main IPC drift
 * should fail loudly instead of being hidden by unversioned compatibility
 * handlers.
 */

import { describe, expect, it, vi } from 'vitest';

// Collect registered channel names via a mock ipcMain.
const registeredChannels: string[] = [];

// Track handler implementations so we can call them directly.
const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('./electron-runtime', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      registeredChannels.push(channel);
      handlers.set(channel, fn);
    },
  },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
  shell: { openPath: vi.fn() },
}));

// Stub Electron modules that electron-runtime would otherwise pull in.
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false, getVersion: vi.fn(() => '0.0.0') },
  ipcMain: { handle: vi.fn() },
  safeStorage: { isEncryptionAvailable: vi.fn(() => false) },
  shell: { openPath: vi.fn() },
}));

vi.mock('electron-log/main', () => ({
  default: {
    scope: () => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    }),
    transports: {
      file: { resolvePathFn: null, maxSize: 0, format: '' },
      console: { level: 'info', format: '' },
    },
    errorHandler: { startCatching: vi.fn() },
    eventLogger: { startLogging: vi.fn() },
    info: vi.fn(),
  },
}));

vi.mock('./config', () => ({
  defaultConfigDir: () => '/tmp/config',
  readConfig: vi.fn(async () => null),
  writeConfig: vi.fn(async () => {}),
}));

vi.mock('./keychain', () => ({
  encryptSecret: vi.fn((s: string) => `enc:${s}`),
  decryptSecret: vi.fn((s: string) => s.replace('enc:', '')),
  maskSecret: vi.fn((s: string) => (s.length > 8 ? `${s.slice(0, 4)}***${s.slice(-4)}` : '***')),
  buildSecretRef: vi.fn((s: string) => ({
    ciphertext: `enc:${s}`,
    mask: s.length > 8 ? `${s.slice(0, 4)}***${s.slice(-4)}` : '***',
  })),
  migrateSecrets: vi.fn((cfg: { secrets?: Record<string, unknown> }) => ({
    config: cfg,
    changed: false,
  })),
}));

vi.mock('./storage-settings', () => ({
  buildAppPathsForLocations: vi.fn(() => ({})),
  getDefaultUserDataDir: vi.fn(() => '/tmp/data'),
  patchForStorageKind: vi.fn((kind: string, dir: string) => ({ [`${kind}Dir`]: dir })),
  readPersistedStorageLocations: vi.fn(async () => ({})),
  writeStorageLocations: vi.fn(async () => ({})),
}));

vi.mock('./logger', () => ({
  defaultLogsDir: () => '/tmp/logs',
  getLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('./imports/codex-config', () => ({
  readCodexConfig: vi.fn(async () => null),
  codexAuthPath: vi.fn(() => '/tmp/codex-auth.json'),
  ALLOWED_IMPORT_ENV_KEYS: new Set([
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CEREBRAS_API_KEY',
    'DEEPSEEK_API_KEY',
    'GEMINI_API_KEY',
    'GROQ_API_KEY',
    'OPENAI_API_KEY',
    'OPENROUTER_API_KEY',
    'XAI_API_KEY',
  ]),
}));

vi.mock('./imports/claude-code-config', () => ({
  readClaudeCodeSettings: vi.fn(async () => null),
}));

vi.mock('./imports/gemini-cli-config', () => ({
  readGeminiCliConfig: vi.fn(async () => null),
}));

vi.mock('./imports/opencode-config', () => ({
  readOpencodeConfig: vi.fn(async () => null),
}));

vi.mock('@open-codesign/providers', () => ({
  looksLikeClaudeOAuthToken: vi.fn(() => false),
  pingProvider: vi.fn(async () => ({ ok: true, modelCount: 1 })),
  withClaudeCodeIdentity: vi.fn(
    (_wire: unknown, _baseUrl: unknown, headers: Record<string, string>) => headers,
  ),
}));

describe('registerOnboardingIpc — channel versioning', () => {
  it('registers settings:v1:list-providers without the unversioned settings:list-providers shim', async () => {
    // Import after mocks are in place.
    const { registerOnboardingIpc } = await import('./onboarding-ipc');
    registerOnboardingIpc();

    expect(registeredChannels).toContain('settings:v1:list-providers');
    expect(registeredChannels).not.toContain('settings:list-providers');
  });

  it('registers all settings v1 channels', async () => {
    const v1Channels = [
      'settings:v1:list-providers',
      'settings:v1:add-provider',
      'settings:v1:delete-provider',
      'settings:v1:set-active-provider',
      'settings:v1:get-paths',
      'settings:v1:choose-storage-folder',
      'settings:v1:open-folder',
      'settings:v1:reset-onboarding',
      'settings:v1:toggle-devtools',
    ];

    for (const ch of v1Channels) {
      expect(registeredChannels).toContain(ch);
    }
  });

  it('does not register unversioned settings channels', async () => {
    const unversionedChannels = [
      'settings:list-providers',
      'settings:add-provider',
      'settings:delete-provider',
      'settings:set-active-provider',
      'settings:get-paths',
      'settings:choose-storage-folder',
      'settings:open-folder',
      'settings:reset-onboarding',
      'settings:toggle-devtools',
    ];

    for (const ch of unversionedChannels) {
      expect(registeredChannels).not.toContain(ch);
    }
  });

  it('lets settings add the keyless Ollama builtin without storing an empty secret', async () => {
    const { readConfig, writeConfig } = await import('./config');
    vi.mocked(readConfig).mockResolvedValueOnce(null);
    vi.mocked(writeConfig).mockClear();
    const { loadConfigOnBoot, registerOnboardingIpc } = await import('./onboarding-ipc');
    await loadConfigOnBoot();
    registerOnboardingIpc();

    const handler = handlers.get('settings:v1:add-provider');
    expect(handler).toBeDefined();

    const rows = (await handler?.(
      {},
      {
        provider: 'ollama',
        apiKey: '',
        modelPrimary: 'llama3.2',
      },
    )) as Array<{ provider: string }>;

    const written = vi.mocked(writeConfig).mock.calls.at(-1)?.[0];
    expect(written?.providers['ollama']).toMatchObject({
      id: 'ollama',
      name: 'Ollama (local)',
      requiresApiKey: false,
    });
    expect(written?.secrets['ollama']).toBeUndefined();
    expect(rows.some((row) => row.provider === 'ollama')).toBe(true);
  });

  it('trims modelPrimary before writing builtin provider settings', async () => {
    const { readConfig, writeConfig } = await import('./config');
    vi.mocked(readConfig).mockResolvedValueOnce(null);
    vi.mocked(writeConfig).mockClear();
    const { loadConfigOnBoot, registerOnboardingIpc } = await import('./onboarding-ipc');
    await loadConfigOnBoot();
    registerOnboardingIpc();

    const handler = handlers.get('settings:v1:add-provider');
    expect(handler).toBeDefined();

    await handler?.(
      {},
      {
        provider: 'openai',
        apiKey: 'sk-test',
        modelPrimary: '  gpt-5.4  ',
      },
    );

    const written = vi.mocked(writeConfig).mock.calls.at(-1)?.[0];
    expect(written?.activeModel).toBe('gpt-5.4');
  });

  it('registers the canonical config:v1:set-provider-and-models handler', async () => {
    const { registerOnboardingIpc } = await import('./onboarding-ipc');
    registerOnboardingIpc();
    expect(registeredChannels).toContain('config:v1:set-provider-and-models');
  });
});

describe('config:v1:set-provider-and-models — payload validation', () => {
  it('rejects unsupported provider ids instead of inventing a custom provider', async () => {
    const { registerOnboardingIpc } = await import('./onboarding-ipc');
    registerOnboardingIpc();
    const handler = handlers.get('config:v1:set-provider-and-models');
    expect(handler).toBeDefined();
    if (!handler) return;
    await expect(
      handler({} as never, {
        provider: 'openia',
        apiKey: 'sk-test',
        modelPrimary: 'gpt-4o',
        setAsActive: true,
      }),
    ).rejects.toThrow(/not supported/);
  });

  it('rejects payloads without a setAsActive boolean', async () => {
    const { registerOnboardingIpc } = await import('./onboarding-ipc');
    registerOnboardingIpc();
    const handler = handlers.get('config:v1:set-provider-and-models');
    expect(handler).toBeDefined();
    if (!handler) return;
    await expect(
      handler({} as never, {
        provider: 'openrouter',
        apiKey: 'sk-test',
        modelPrimary: 'a',
      }),
    ).rejects.toThrow(/setAsActive/);
  });

  it('rejects payloads with an unsupported schemaVersion', async () => {
    const { registerOnboardingIpc } = await import('./onboarding-ipc');
    registerOnboardingIpc();
    const handler = handlers.get('config:v1:set-provider-and-models');
    if (!handler) throw new Error('handler missing');
    await expect(
      handler({} as never, {
        schemaVersion: 99,
        provider: 'openrouter',
        apiKey: 'sk-test',
        modelPrimary: 'a',
        setAsActive: true,
      }),
    ).rejects.toThrow(/schemaVersion/);
  });
});

describe('settings:v1:set-active-provider — payload validation', () => {
  it('rejects unknown fields instead of dropping them', async () => {
    const { readConfig, writeConfig } = await import('./config');
    const { loadConfigOnBoot, registerOnboardingIpc } = await import('./onboarding-ipc');
    vi.mocked(writeConfig).mockClear();
    vi.mocked(readConfig).mockResolvedValueOnce({
      version: 3,
      activeProvider: 'openai',
      activeModel: 'gpt-4o',
      secrets: { openai: { ciphertext: 'enc:sk-openai', mask: 'sk-***ai' } },
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
      provider: 'openai',
      modelPrimary: 'gpt-4o',
      baseUrls: {},
    });
    await loadConfigOnBoot();
    registerOnboardingIpc();
    const handler = handlers.get('settings:v1:set-active-provider');
    if (!handler) throw new Error('handler missing');

    await expect(
      handler({} as never, {
        provider: 'openai',
        modelPrimary: 'gpt-4o',
        typoedField: true,
      }),
    ).rejects.toThrow(/unsupported field "typoedField"/);
    expect(writeConfig).not.toHaveBeenCalled();
  });

  it('trims provider and model before persisting active settings', async () => {
    const { readConfig, writeConfig } = await import('./config');
    const { loadConfigOnBoot, registerOnboardingIpc } = await import('./onboarding-ipc');
    vi.mocked(writeConfig).mockClear();
    vi.mocked(readConfig).mockResolvedValueOnce({
      version: 3,
      activeProvider: 'openai',
      activeModel: 'gpt-4o',
      secrets: { openai: { ciphertext: 'enc:sk-openai', mask: 'sk-***ai' } },
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
      provider: 'openai',
      modelPrimary: 'gpt-4o',
      baseUrls: {},
    });
    await loadConfigOnBoot();
    registerOnboardingIpc();
    const handler = handlers.get('settings:v1:set-active-provider');
    if (!handler) throw new Error('handler missing');

    await handler({} as never, {
      provider: ' openai ',
      modelPrimary: ' gpt-4o-mini ',
    });

    const written = vi.mocked(writeConfig).mock.calls.at(-1)?.[0];
    expect(written?.activeProvider).toBe('openai');
    expect(written?.activeModel).toBe('gpt-4o-mini');
  });
});

describe('config:v1:remove-provider — empty-state normalization', () => {
  it('returns provider:null after removing the last configured provider', async () => {
    const { hydrateConfig } = await import('@open-codesign/shared');
    const { readConfig, writeConfig } = await import('./config');
    const { loadConfigOnBoot, registerOnboardingIpc } = await import('./onboarding-ipc');
    vi.mocked(writeConfig).mockClear();
    vi.mocked(readConfig).mockResolvedValueOnce(
      hydrateConfig({
        version: 3,
        activeProvider: 'custom-only',
        activeModel: 'gpt-test',
        secrets: {
          'custom-only': { ciphertext: 'enc:sk-test', mask: 'sk-***test' },
        },
        providers: {
          'custom-only': {
            id: 'custom-only',
            name: 'Custom Only',
            builtin: false,
            wire: 'openai-chat',
            baseUrl: 'https://proxy.example.com/v1',
            defaultModel: 'gpt-test',
          },
        },
      }),
    );
    await loadConfigOnBoot();
    registerOnboardingIpc();
    const handler = handlers.get('config:v1:remove-provider');
    if (!handler) throw new Error('handler missing');

    await expect(handler({} as never, 'custom-only')).resolves.toMatchObject({
      hasKey: false,
      provider: null,
      modelPrimary: null,
      baseUrl: null,
    });
    const written = vi.mocked(writeConfig).mock.calls.at(-1)?.[0];
    expect(written?.activeProvider).toBe('');
    expect(written?.activeModel).toBe('');
  });
});

describe('settings:v1:reset-onboarding — empty-state normalization', () => {
  it('clears the active provider even when the old active provider is keyless', async () => {
    const { BUILTIN_PROVIDERS, hydrateConfig } = await import('@open-codesign/shared');
    const { readConfig, writeConfig } = await import('./config');
    const { loadConfigOnBoot, registerOnboardingIpc } = await import('./onboarding-ipc');
    vi.mocked(writeConfig).mockClear();
    vi.mocked(readConfig).mockResolvedValueOnce(
      hydrateConfig({
        version: 3,
        activeProvider: 'ollama',
        activeModel: 'llama3.2',
        secrets: {},
        providers: {
          ollama: BUILTIN_PROVIDERS.ollama,
        },
      }),
    );
    await loadConfigOnBoot();
    registerOnboardingIpc();
    const reset = handlers.get('settings:v1:reset-onboarding');
    const getState = handlers.get('onboarding:get-state');
    if (!reset || !getState) throw new Error('handler missing');

    await reset({} as never);

    const written = vi.mocked(writeConfig).mock.calls.at(-1)?.[0];
    expect(written?.activeProvider).toBe('');
    expect(written?.activeModel).toBe('');
    expect(written?.providers['ollama']).toBeDefined();
    expect(await getState({} as never)).toMatchObject({
      hasKey: false,
      provider: null,
      modelPrimary: null,
    });
  });
});

describe('config:v1 provider mutations — fail-fast key handling', () => {
  it('rejects custom provider creation with an empty API key before touching storage', async () => {
    const { buildSecretRef } = await import('./keychain');
    const { registerOnboardingIpc } = await import('./onboarding-ipc');
    vi.mocked(buildSecretRef).mockClear();
    registerOnboardingIpc();
    const handler = handlers.get('config:v1:add-provider');
    if (!handler) throw new Error('handler missing');

    await expect(
      handler({} as never, {
        id: 'custom-empty',
        name: 'Custom Empty',
        wire: 'openai-chat',
        baseUrl: 'https://proxy.example.com/v1',
        apiKey: '',
        defaultModel: 'gpt-test',
      }),
    ).rejects.toThrow(/apiKey must be a non-empty string/);
    expect(buildSecretRef).not.toHaveBeenCalled();
  });

  it('rejects malformed custom-provider header maps instead of dropping bad entries', async () => {
    const { registerOnboardingIpc } = await import('./onboarding-ipc');
    registerOnboardingIpc();
    const handler = handlers.get('config:v1:add-provider');
    if (!handler) throw new Error('handler missing');

    await expect(
      handler({} as never, {
        id: 'custom-bad-headers',
        name: 'Custom Bad Headers',
        wire: 'openai-chat',
        baseUrl: 'https://proxy.example.com/v1',
        apiKey: 'sk-test',
        defaultModel: 'gpt-test',
        httpHeaders: { 'x-ok': 'yes', 'x-bad': 42 },
        setAsActive: false,
      }),
    ).rejects.toThrow(/httpHeaders\.x-bad must be a string/);
  });

  it('rejects clearing a non-keyless provider secret instead of writing a broken config', async () => {
    const { hydrateConfig } = await import('@open-codesign/shared');
    const { readConfig, writeConfig } = await import('./config');
    const { loadConfigOnBoot, registerOnboardingIpc } = await import('./onboarding-ipc');
    vi.mocked(writeConfig).mockClear();
    vi.mocked(readConfig).mockResolvedValueOnce(
      hydrateConfig({
        version: 3,
        activeProvider: 'custom-required',
        activeModel: 'gpt-test',
        secrets: {
          'custom-required': { ciphertext: 'enc:sk-test', mask: 'sk-***test' },
        },
        providers: {
          'custom-required': {
            id: 'custom-required',
            name: 'Custom Required',
            builtin: false,
            wire: 'openai-chat',
            baseUrl: 'https://proxy.example.com/v1',
            defaultModel: 'gpt-test',
          },
        },
      }),
    );
    await loadConfigOnBoot();
    registerOnboardingIpc();
    const handler = handlers.get('config:v1:update-provider');
    if (!handler) throw new Error('handler missing');

    await expect(
      handler({} as never, {
        id: 'custom-required',
        apiKey: '',
      }),
    ).rejects.toThrow(/Cannot clear API key/);
    expect(writeConfig).not.toHaveBeenCalled();
  });

  it('rejects invalid provider updates instead of silently keeping old values', async () => {
    const { registerOnboardingIpc } = await import('./onboarding-ipc');
    registerOnboardingIpc();
    const handler = handlers.get('config:v1:update-provider');
    if (!handler) throw new Error('handler missing');

    await expect(
      handler({} as never, {
        id: 'custom-required',
        wire: 'not-a-wire',
      }),
    ).rejects.toThrow(/Unsupported wire/);
  });

  it('rejects invalid add-provider setAsActive instead of coercing to false', async () => {
    const { registerOnboardingIpc } = await import('./onboarding-ipc');
    registerOnboardingIpc();
    const handler = handlers.get('config:v1:add-provider');
    if (!handler) throw new Error('handler missing');

    await expect(
      handler({} as never, {
        id: 'custom-add',
        name: 'Custom Add',
        wire: 'openai-chat',
        baseUrl: 'https://proxy.example.com/v1',
        apiKey: 'sk-test',
        defaultModel: 'gpt-test',
        setAsActive: 'yes',
      }),
    ).rejects.toThrow(/setAsActive must be a boolean/);
  });

  it('rejects missing add-provider setAsActive instead of defaulting to false', async () => {
    const { registerOnboardingIpc } = await import('./onboarding-ipc');
    registerOnboardingIpc();
    const handler = handlers.get('config:v1:add-provider');
    if (!handler) throw new Error('handler missing');

    await expect(
      handler({} as never, {
        id: 'custom-add',
        name: 'Custom Add',
        wire: 'openai-chat',
        baseUrl: 'https://proxy.example.com/v1',
        apiKey: 'sk-test',
        defaultModel: 'gpt-test',
      }),
    ).rejects.toThrow(/setAsActive must be a boolean/);
  });

  it('rejects unknown provider mutation fields instead of dropping them', async () => {
    const { registerOnboardingIpc } = await import('./onboarding-ipc');
    registerOnboardingIpc();
    const handler = handlers.get('config:v1:add-provider');
    if (!handler) throw new Error('handler missing');

    await expect(
      handler({} as never, {
        id: 'custom-add',
        name: 'Custom Add',
        wire: 'openai-chat',
        baseUrl: 'https://proxy.example.com/v1',
        apiKey: 'sk-test',
        defaultModel: 'gpt-test',
        typoedField: 'would have been ignored',
      }),
    ).rejects.toThrow(/unsupported field "typoedField"/);
  });
});

describe('config:v1:list-endpoint-models — response parsing', () => {
  it('returns a parse error for unknown payload fields before fetching', async () => {
    const savedFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error('fetch should not be called');
    }) as unknown as typeof fetch;
    try {
      const { runListEndpointModels } = await import('./onboarding/providers-crud');
      await expect(
        runListEndpointModels({
          wire: 'openai-chat',
          baseUrl: 'https://proxy.example.com/v1',
          apiKey: 'sk-test',
          typoedField: true,
        }),
      ).resolves.toEqual({ ok: false, error: 'unsupported field "typoedField"' });
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it('returns a parse error for malformed baseUrl before fetching', async () => {
    const savedFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error('fetch should not be called');
    }) as unknown as typeof fetch;
    try {
      const { runListEndpointModels } = await import('./onboarding/providers-crud');
      await expect(
        runListEndpointModels({
          wire: 'openai-chat',
          baseUrl: 'not a url',
          apiKey: 'sk-test',
        }),
      ).resolves.toEqual({ ok: false, error: 'baseUrl "not a url" is not a valid URL' });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it('returns a parse error when a model item has neither id nor name', async () => {
    const savedFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'good-model' }, { label: 'display only' }] }),
    })) as unknown as typeof fetch;
    try {
      const { runListEndpointModels } = await import('./onboarding/providers-crud');
      await expect(
        runListEndpointModels({
          wire: 'openai-chat',
          baseUrl: 'https://proxy.example.com/v1',
          apiKey: 'sk-test',
        }),
      ).resolves.toEqual({ ok: false, error: 'unexpected response shape' });
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});

describe('registerOnboardingIpc — validate-key passes baseUrl to pingProvider', () => {
  it('forwards baseUrl to pingProvider when provided', async () => {
    const { pingProvider } = await import('@open-codesign/providers');
    const handler = handlers.get('onboarding:validate-key');
    expect(handler).toBeDefined();

    await handler?.({} as unknown, {
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://custom.proxy.example/v1',
    });

    expect(pingProvider).toHaveBeenCalledWith(
      'openai',
      'sk-test',
      'https://custom.proxy.example/v1',
    );
  });

  it('calls pingProvider without baseUrl when not provided', async () => {
    const { pingProvider } = await import('@open-codesign/providers');
    vi.mocked(pingProvider).mockClear();
    const handler = handlers.get('onboarding:validate-key');
    expect(handler).toBeDefined();

    await handler?.({} as unknown, { provider: 'anthropic', apiKey: 'sk-ant-test' });

    expect(pingProvider).toHaveBeenCalledWith('anthropic', 'sk-ant-test', undefined);
  });

  it('allows explicitly keyless Ollama validation with an empty apiKey', async () => {
    const { pingProvider } = await import('@open-codesign/providers');
    vi.mocked(pingProvider).mockClear();
    const handler = handlers.get('onboarding:validate-key');
    expect(handler).toBeDefined();

    await handler?.({} as unknown, {
      provider: 'ollama',
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
    });

    expect(pingProvider).toHaveBeenCalledWith('ollama', '', 'http://localhost:11434/v1');
  });

  it('rejects malformed baseUrl before calling pingProvider', async () => {
    const { pingProvider } = await import('@open-codesign/providers');
    vi.mocked(pingProvider).mockClear();
    const handler = handlers.get('onboarding:validate-key');
    expect(handler).toBeDefined();

    await expect(
      handler?.({} as unknown, {
        provider: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'not a url',
      }),
    ).rejects.toThrow(/baseUrl .* is not a valid URL/);
    expect(pingProvider).not.toHaveBeenCalled();
  });

  it('rejects non-http provider baseUrls before calling pingProvider', async () => {
    const { pingProvider } = await import('@open-codesign/providers');
    vi.mocked(pingProvider).mockClear();
    const handler = handlers.get('onboarding:validate-key');
    expect(handler).toBeDefined();

    await expect(
      handler?.({} as unknown, {
        provider: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'file:///tmp/socket',
      }),
    ).rejects.toThrow(/baseUrl must use http\(s\)/);
    expect(pingProvider).not.toHaveBeenCalled();
  });
});

describe('getApiKeyForProvider — API key retrieval', () => {
  it('returns the decrypted key when the provider secret exists in config', async () => {
    const { loadConfigOnBoot, getApiKeyForProvider } = await import('./onboarding-ipc');

    // Override readConfig to return a config with an anthropic secret.
    const { readConfig } = await import('./config');
    vi.mocked(readConfig).mockResolvedValueOnce({
      version: 3,
      activeProvider: 'anthropic',
      activeModel: 'claude-sonnet-4-6',
      secrets: { anthropic: { ciphertext: 'enc:sk-ant-test' } },
      providers: {
        anthropic: {
          id: 'anthropic',
          name: 'Anthropic Claude',
          builtin: true,
          wire: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          defaultModel: 'claude-sonnet-4-6',
        },
      },
      provider: 'anthropic',
      modelPrimary: 'claude-sonnet-4-6',
      baseUrls: {},
    });

    await loadConfigOnBoot();
    const key = getApiKeyForProvider('anthropic');
    // decryptSecret mock strips the 'enc:' prefix.
    expect(key).toBe('sk-ant-test');
  });

  it('throws PROVIDER_KEY_MISSING when provider has no stored secret', async () => {
    const { getApiKeyForProvider } = await import('./onboarding-ipc');
    expect(() => getApiKeyForProvider('openai')).toThrow(/PROVIDER_KEY_MISSING|No API key stored/);
  });
});

describe('config:v1:import-codex-config empty env handling', () => {
  it('rejects imports that only found an empty env credential', async () => {
    const { readCodexConfig } = await import('./imports/codex-config');
    const { encryptSecret } = await import('./keychain');
    const { writeConfig } = await import('./config');
    vi.mocked(encryptSecret).mockClear();
    vi.mocked(writeConfig).mockClear();
    vi.mocked(readCodexConfig).mockResolvedValueOnce({
      providers: [
        {
          id: 'codex-empty-env',
          name: 'Codex (imported)',
          builtin: false,
          wire: 'openai-chat',
          baseUrl: 'https://api.example.com/v1',
          defaultModel: 'gpt-test',
          envKey: 'OPEN_CODESIGN_EMPTY_ENV_FOR_TEST',
        },
      ],
      activeProvider: 'codex-empty-env',
      activeModel: 'gpt-test',
      envKeyMap: { 'codex-empty-env': 'OPEN_CODESIGN_EMPTY_ENV_FOR_TEST' },
      apiKeyMap: {},
      warnings: [],
    });
    process.env['OPEN_CODESIGN_EMPTY_ENV_FOR_TEST'] = '   ';

    const handler = handlers.get('config:v1:import-codex-config');
    expect(handler).toBeDefined();
    await expect(handler?.({} as unknown)).rejects.toThrow(/usable API key/);

    expect(encryptSecret).not.toHaveBeenCalled();
    expect(writeConfig).not.toHaveBeenCalled();
    process.env['OPEN_CODESIGN_EMPTY_ENV_FOR_TEST'] = undefined;
  });

  it('encrypts Codex auth.json API keys for providers requiring OpenAI auth', async () => {
    const { readCodexConfig } = await import('./imports/codex-config');
    const { buildSecretRef } = await import('./keychain');
    const { writeConfig } = await import('./config');
    vi.mocked(buildSecretRef).mockClear();
    vi.mocked(writeConfig).mockClear();
    vi.mocked(readCodexConfig).mockResolvedValueOnce({
      providers: [
        {
          id: 'codex-custom',
          name: 'Codex (imported)',
          builtin: false,
          wire: 'openai-responses',
          baseUrl: 'https://api.duckcoding.ai/v1',
          defaultModel: 'gpt-5.4',
          requiresApiKey: true,
        },
      ],
      activeProvider: 'codex-custom',
      activeModel: 'gpt-5.4',
      envKeyMap: {},
      apiKeyMap: { 'codex-custom': 'sk-codex-auth' },
      warnings: [],
    });

    const handler = handlers.get('config:v1:import-codex-config');
    expect(handler).toBeDefined();
    await expect(handler?.({} as unknown)).resolves.toMatchObject({
      provider: 'codex-custom',
      hasKey: true,
    });

    expect(buildSecretRef).toHaveBeenCalledWith('sk-codex-auth');
    const written = vi.mocked(writeConfig).mock.calls.at(-1)?.[0];
    expect(written?.secrets['codex-custom']).toEqual(
      expect.objectContaining({ ciphertext: 'enc:sk-codex-auth' }),
    );
  });
});

describe('config:v1:import-claude-code-config — user-type branching', () => {
  it('throws CLAUDE_CODE_OAUTH_ONLY for oauth-only users without touching config', async () => {
    const { readClaudeCodeSettings } = await import('./imports/claude-code-config');
    const { writeConfig } = await import('./config');
    vi.mocked(writeConfig).mockClear();
    vi.mocked(readClaudeCodeSettings).mockResolvedValueOnce({
      provider: null,
      apiKey: null,
      apiKeySource: 'none',
      userType: 'oauth-only',
      hasOAuthEvidence: true,
      activeModel: null,
      settingsPath: '/tmp/.claude/settings.json',
      warnings: [],
    });

    const handler = handlers.get('config:v1:import-claude-code-config');
    expect(handler).toBeDefined();
    await expect(handler?.({} as unknown)).rejects.toThrow(/OAuth|CLAUDE_CODE_OAUTH_ONLY/);
    expect(writeConfig).not.toHaveBeenCalled();
  });

  it('rejects Claude Code import without a stored key instead of writing an inactive row', async () => {
    const { readClaudeCodeSettings } = await import('./imports/claude-code-config');
    const { readConfig, writeConfig } = await import('./config');
    vi.mocked(writeConfig).mockClear();

    // Start with a working config so there's an active to preserve.
    vi.mocked(readConfig).mockResolvedValueOnce({
      version: 3,
      activeProvider: 'anthropic',
      activeModel: 'claude-sonnet-4-6',
      secrets: { anthropic: { ciphertext: 'enc:sk-existing', mask: 'sk-e***ting' } },
      providers: {
        anthropic: {
          id: 'anthropic',
          name: 'Anthropic Claude',
          builtin: true,
          wire: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          defaultModel: 'claude-sonnet-4-6',
        },
      },
      provider: 'anthropic',
      modelPrimary: 'claude-sonnet-4-6',
      baseUrls: {},
    });
    const { loadConfigOnBoot } = await import('./onboarding-ipc');
    await loadConfigOnBoot();

    vi.mocked(readClaudeCodeSettings).mockResolvedValueOnce({
      provider: {
        id: 'claude-code-imported',
        name: 'Claude Code (imported)',
        builtin: false,
        wire: 'anthropic',
        baseUrl: 'http://localhost:8082',
        defaultModel: 'claude-sonnet-4-6',
        envKey: 'ANTHROPIC_AUTH_TOKEN',
        reasoningLevel: 'medium',
      },
      apiKey: null,
      apiKeySource: 'none',
      userType: 'local-proxy',
      hasOAuthEvidence: false,
      activeModel: 'claude-sonnet-4-6',
      settingsPath: '/tmp/.claude/settings.json',
      warnings: [],
    });

    const handler = handlers.get('config:v1:import-claude-code-config');
    await expect(handler?.({} as unknown)).rejects.toThrow(/usable API key/);
    expect(writeConfig).not.toHaveBeenCalled();
  });

  it('activates the imported provider when a key was extracted', async () => {
    const { readClaudeCodeSettings } = await import('./imports/claude-code-config');
    const { writeConfig } = await import('./config');
    vi.mocked(writeConfig).mockClear();
    vi.mocked(readClaudeCodeSettings).mockResolvedValueOnce({
      provider: {
        id: 'claude-code-imported',
        name: 'Claude Code (imported)',
        builtin: false,
        wire: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        defaultModel: 'claude-sonnet-4-6',
        envKey: 'ANTHROPIC_AUTH_TOKEN',
        reasoningLevel: 'medium',
      },
      apiKey: 'sk-ant-from-settings',
      apiKeySource: 'settings-json',
      userType: 'has-api-key',
      hasOAuthEvidence: false,
      activeModel: 'claude-sonnet-4-6',
      settingsPath: '/tmp/.claude/settings.json',
      warnings: [],
    });

    const handler = handlers.get('config:v1:import-claude-code-config');
    const state = (await handler?.({} as unknown)) as { provider: string; hasKey: boolean };
    expect(state.provider).toBe('claude-code-imported');
    expect(state.hasKey).toBe(true);

    const written = vi.mocked(writeConfig).mock.calls.at(-1)?.[0];
    expect(written?.activeProvider).toBe('claude-code-imported');
    expect(written?.secrets['claude-code-imported']).toBeDefined();
  });
});

describe('getApiKeyForProvider — no runtime envKey credential rescue', () => {
  it('throws PROVIDER_KEY_MISSING when secret is absent even if envKey is set', async () => {
    const ENV_NAME = 'ANTHROPIC_API_KEY';
    const saved = process.env[ENV_NAME];
    process.env[ENV_NAME] = 'sk-from-shell-env';
    const { readConfig } = await import('./config');
    vi.mocked(readConfig).mockResolvedValueOnce({
      version: 3,
      activeProvider: 'env-only-test',
      activeModel: 'x',
      secrets: {},
      providers: {
        'env-only-test': {
          id: 'env-only-test',
          name: 'Env Only',
          builtin: false,
          wire: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          defaultModel: 'x',
          envKey: ENV_NAME,
        },
      },
      provider: 'env-only-test',
      modelPrimary: 'x',
      baseUrls: {},
    });
    const { loadConfigOnBoot, getApiKeyForProvider } = await import('./onboarding-ipc');
    await loadConfigOnBoot();

    expect(() => getApiKeyForProvider('env-only-test')).toThrow(
      /PROVIDER_KEY_MISSING|No API key stored/,
    );
    if (saved === undefined) delete process.env[ENV_NAME];
    else process.env[ENV_NAME] = saved;
  });

  it('throws PROVIDER_KEY_MISSING when both secret and envKey are absent', async () => {
    const ENV_NAME = 'CEREBRAS_API_KEY';
    const saved = process.env[ENV_NAME];
    delete process.env[ENV_NAME];
    const { readConfig } = await import('./config');
    vi.mocked(readConfig).mockResolvedValueOnce({
      version: 3,
      activeProvider: 'no-key',
      activeModel: 'x',
      secrets: {},
      providers: {
        'no-key': {
          id: 'no-key',
          name: 'No Key',
          builtin: false,
          wire: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          defaultModel: 'x',
          envKey: ENV_NAME,
        },
      },
      provider: 'no-key',
      modelPrimary: 'x',
      baseUrls: {},
    });
    const { loadConfigOnBoot, getApiKeyForProvider } = await import('./onboarding-ipc');
    await loadConfigOnBoot();

    expect(() => getApiKeyForProvider('no-key')).toThrow(/PROVIDER_KEY_MISSING|No API key stored/);
    if (saved !== undefined) process.env[ENV_NAME] = saved;
  });

  it('ignores arbitrary envKey values in stale configs', async () => {
    const ENV_NAME = 'AWS_SECRET_ACCESS_KEY';
    const saved = process.env[ENV_NAME];
    process.env[ENV_NAME] = 'should-never-be-returned';
    const { readConfig } = await import('./config');
    vi.mocked(readConfig).mockResolvedValueOnce({
      version: 3,
      activeProvider: 'attacker',
      activeModel: 'x',
      secrets: {},
      providers: {
        attacker: {
          id: 'attacker',
          name: 'Attacker',
          builtin: false,
          wire: 'openai-chat',
          baseUrl: 'https://attacker.example/v1',
          defaultModel: 'x',
          envKey: ENV_NAME,
        },
      },
      provider: 'attacker',
      modelPrimary: 'x',
      baseUrls: {},
    });
    const { loadConfigOnBoot, getApiKeyForProvider } = await import('./onboarding-ipc');
    await loadConfigOnBoot();
    expect(() => getApiKeyForProvider('attacker')).toThrow(
      /PROVIDER_KEY_MISSING|No API key stored/,
    );
    if (saved === undefined) delete process.env[ENV_NAME];
    else process.env[ENV_NAME] = saved;
  });
});

describe('config:v1:detect-external-configs — payload shape', () => {
  // Regression guard: this PR lost `settingsPath` + `defaultModel` from the
  // IPC output three separate times during rebasing. Lock the shape so it
  // can't silently regress again — the renderer depends on both fields.
  it('emits settingsPath and defaultModel alongside the existing fields', async () => {
    const { readClaudeCodeSettings } = await import('./imports/claude-code-config');
    vi.mocked(readClaudeCodeSettings).mockResolvedValueOnce({
      provider: {
        id: 'claude-code-imported',
        name: 'Claude Code (imported)',
        builtin: false,
        wire: 'anthropic',
        baseUrl: 'http://localhost:9999',
        defaultModel: 'claude-opus-4-1',
        envKey: 'ANTHROPIC_AUTH_TOKEN',
        reasoningLevel: 'medium',
      },
      apiKey: null,
      apiKeySource: 'none',
      userType: 'local-proxy',
      hasOAuthEvidence: false,
      activeModel: 'claude-opus-4-1',
      settingsPath: '/home/alice/.claude/settings.json',
      warnings: ['apiKeyHelper detected'],
    });

    const handler = handlers.get('config:v1:detect-external-configs');
    expect(handler).toBeDefined();
    const result = (await handler?.()) as {
      claudeCode?: {
        userType: string;
        baseUrl: string;
        defaultModel: string;
        hasApiKey: boolean;
        apiKeySource: string;
        settingsPath: string;
        warnings: string[];
      };
    };
    expect(result.claudeCode).toMatchObject({
      userType: 'local-proxy',
      baseUrl: 'http://localhost:9999',
      defaultModel: 'claude-opus-4-1',
      hasApiKey: false,
      apiKeySource: 'none',
      settingsPath: '/home/alice/.claude/settings.json',
      warnings: ['apiKeyHelper detected'],
    });
  });
});

describe('config:v1:detect-external-configs — never leaks plaintext keys', () => {
  // Regression guard for the "apiKeyMap crosses IPC" silent leak fixed
  // earlier in this PR chain. Electron's structured clone ships every own
  // property regardless of the TypeScript facade, so this test verifies
  // the runtime payload — not the type — omits the secret fields.
  it('strips apiKeyMap and envKeyMap from Codex before returning', async () => {
    const { readCodexConfig } = await import('./imports/codex-config');
    vi.mocked(readCodexConfig).mockResolvedValueOnce({
      providers: [
        {
          id: 'codex-deepseek',
          name: 'Codex (imported)',
          builtin: false,
          wire: 'openai-chat',
          baseUrl: 'https://api.deepseek.com/v1',
          defaultModel: 'deepseek-chat',
          envKey: 'DEEPSEEK_API_KEY',
        },
      ],
      activeProvider: 'codex-deepseek',
      activeModel: 'deepseek-chat',
      envKeyMap: { 'codex-deepseek': 'DEEPSEEK_API_KEY' },
      apiKeyMap: { 'codex-deepseek': 'sk-secret-ant-should-never-leak' },
      warnings: [],
    });

    const handler = handlers.get('config:v1:detect-external-configs');
    expect(handler).toBeDefined();
    const result = (await handler?.()) as Record<string, unknown>;

    expect(result['codex']).toBeDefined();
    const codex = result['codex'] as Record<string, unknown>;
    expect(codex['apiKeyMap']).toBeUndefined();
    expect(codex['envKeyMap']).toBeUndefined();
    // Belt and suspenders: the full serialized payload should not contain
    // the secret string anywhere — catches future changes that stuff the
    // key under a different field name.
    expect(JSON.stringify(result)).not.toContain('sk-secret-ant-should-never-leak');
  });

  it('strips apiKeyMap from OpenCode before returning', async () => {
    const { readOpencodeConfig } = await import('./imports/opencode-config');
    vi.mocked(readOpencodeConfig).mockResolvedValueOnce({
      providers: [
        {
          id: 'opencode-anthropic',
          name: 'OpenCode · Anthropic',
          builtin: false,
          wire: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          defaultModel: 'claude-sonnet-4-6',
          envKey: 'ANTHROPIC_API_KEY',
        },
      ],
      apiKeyMap: { 'opencode-anthropic': 'sk-opencode-secret-leak-canary' },
      activeProvider: null,
      activeModel: null,
      warnings: [],
    });

    const handler = handlers.get('config:v1:detect-external-configs');
    const result = (await handler?.()) as Record<string, unknown>;

    expect(result['opencode']).toBeDefined();
    const oc = result['opencode'] as Record<string, unknown>;
    expect(oc['apiKeyMap']).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('sk-opencode-secret-leak-canary');
  });
});

describe('config:v1:import-gemini-config — merge logic', () => {
  it('writes a gemini-import provider with the key stored under that id', async () => {
    const { readGeminiCliConfig } = await import('./imports/gemini-cli-config');
    const { writeConfig } = await import('./config');
    vi.mocked(writeConfig).mockClear();
    vi.mocked(readGeminiCliConfig).mockResolvedValueOnce({
      kind: 'found',
      provider: {
        id: 'gemini-import',
        name: 'Gemini (imported)',
        builtin: false,
        wire: 'openai-chat',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        defaultModel: 'gemini-2.5-flash',
        envKey: 'GEMINI_API_KEY',
      },
      apiKey: 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456',
      apiKeySource: 'gemini-env',
      keyPath: '/home/alice/.gemini/.env',
      warnings: [],
    });

    const handler = handlers.get('config:v1:import-gemini-config');
    expect(handler).toBeDefined();
    await handler?.({} as unknown);

    const written = vi.mocked(writeConfig).mock.calls.at(-1)?.[0];
    expect(written?.providers['gemini-import']).toMatchObject({
      id: 'gemini-import',
      wire: 'openai-chat',
      envKey: 'GEMINI_API_KEY',
    });
    expect(written?.secrets['gemini-import']).toEqual(
      expect.objectContaining({ ciphertext: expect.stringContaining('AIzaSy') }),
    );
    // Fresh install: gemini-import should become the active provider.
    expect(written?.activeProvider).toBe('gemini-import');
    expect(written?.activeModel).toBe('gemini-2.5-flash');
  });

  it('throws CONFIG_MISSING when the parser returns a Vertex-blocked result', async () => {
    const { readGeminiCliConfig } = await import('./imports/gemini-cli-config');
    vi.mocked(readGeminiCliConfig).mockResolvedValueOnce({
      kind: 'blocked',
      warnings: ['Vertex AI detected (GOOGLE_GENAI_USE_VERTEXAI=true). ...'],
    });

    const handler = handlers.get('config:v1:import-gemini-config');
    await expect(handler?.({} as unknown)).rejects.toThrow(/Vertex/);
  });

  it('is idempotent: re-import overwrites the existing gemini-import row', async () => {
    const { readGeminiCliConfig } = await import('./imports/gemini-cli-config');
    const { writeConfig } = await import('./config');
    const fresh = {
      kind: 'found' as const,
      provider: {
        id: 'gemini-import',
        name: 'Gemini (imported)',
        builtin: false as const,
        wire: 'openai-chat' as const,
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        defaultModel: 'gemini-2.5-flash',
        envKey: 'GEMINI_API_KEY',
      },
      apiKey: `AIzaSy${'z'.repeat(33)}`,
      apiKeySource: 'gemini-env' as const,
      keyPath: '/home/alice/.gemini/.env',
      warnings: [] as string[],
    };
    vi.mocked(readGeminiCliConfig).mockResolvedValueOnce(fresh);
    vi.mocked(writeConfig).mockClear();
    const handler = handlers.get('config:v1:import-gemini-config');
    await handler?.({} as unknown);

    // Second call should produce a single provider row, not a duplicate.
    vi.mocked(readGeminiCliConfig).mockResolvedValueOnce({
      ...fresh,
      apiKey: `AIzaSy${'r'.repeat(33)}`, // rotated key
    });
    await handler?.({} as unknown);

    const written = vi.mocked(writeConfig).mock.calls.at(-1)?.[0];
    const geminiIds = Object.keys(written?.providers ?? {}).filter((id) =>
      id.startsWith('gemini-import'),
    );
    expect(geminiIds).toEqual(['gemini-import']);
    // Rotated key should win.
    expect(written?.secrets['gemini-import']).toEqual(
      expect.objectContaining({
        ciphertext: expect.stringContaining('r'.repeat(33)),
      }),
    );
  });
});

describe('config:v1:import-opencode-config — merge logic', () => {
  it('imports multiple providers and resolves activeProvider from the config file', async () => {
    const { readOpencodeConfig } = await import('./imports/opencode-config');
    const { writeConfig } = await import('./config');
    vi.mocked(writeConfig).mockClear();
    vi.mocked(readOpencodeConfig).mockResolvedValueOnce({
      providers: [
        {
          id: 'opencode-openai',
          name: 'OpenCode · OpenAI',
          builtin: false,
          wire: 'openai-chat',
          baseUrl: 'https://api.openai.com/v1',
          defaultModel: 'gpt-4o',
          envKey: 'OPENAI_API_KEY',
        },
        {
          id: 'opencode-anthropic',
          name: 'OpenCode · Anthropic',
          builtin: false,
          wire: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          // User's opencode.json said `model: "anthropic/claude-opus-4-1"`,
          // so readOpencodeConfig already rewrote this entry's defaultModel.
          defaultModel: 'claude-opus-4-1',
          envKey: 'ANTHROPIC_API_KEY',
        },
      ],
      apiKeyMap: {
        'opencode-openai': 'sk-opencode-oai',
        'opencode-anthropic': 'sk-opencode-ant',
      },
      activeProvider: 'opencode-anthropic',
      activeModel: 'claude-opus-4-1',
      warnings: [],
    });

    const handler = handlers.get('config:v1:import-opencode-config');
    await handler?.({} as unknown);

    const written = vi.mocked(writeConfig).mock.calls.at(-1)?.[0];
    expect(Object.keys(written?.providers ?? {}).sort()).toEqual(
      expect.arrayContaining(['opencode-anthropic', 'opencode-openai']),
    );
    expect(written?.secrets['opencode-openai']).toEqual(
      expect.objectContaining({ ciphertext: expect.stringContaining('sk-opencode-oai') }),
    );
    expect(written?.secrets['opencode-anthropic']).toEqual(
      expect.objectContaining({ ciphertext: expect.stringContaining('sk-opencode-ant') }),
    );
    // The detected active model wins over first-provider-alphabetic.
    expect(written?.activeProvider).toBe('opencode-anthropic');
    expect(written?.activeModel).toBe('claude-opus-4-1');
  });

  it('uses the first imported provider when activeProvider is null', async () => {
    const { readOpencodeConfig } = await import('./imports/opencode-config');
    const { writeConfig } = await import('./config');
    vi.mocked(writeConfig).mockClear();
    vi.mocked(readOpencodeConfig).mockResolvedValueOnce({
      providers: [
        {
          id: 'opencode-deepseek',
          name: 'OpenCode · DeepSeek',
          builtin: false,
          wire: 'openai-chat',
          baseUrl: 'https://api.deepseek.com/v1',
          defaultModel: 'deepseek-chat',
          envKey: 'DEEPSEEK_API_KEY',
        },
      ],
      apiKeyMap: { 'opencode-deepseek': 'sk-ds' },
      activeProvider: null,
      activeModel: null,
      warnings: [],
    });

    const handler = handlers.get('config:v1:import-opencode-config');
    await handler?.({} as unknown);

    const written = vi.mocked(writeConfig).mock.calls.at(-1)?.[0];
    expect(written?.activeProvider).toBe('opencode-deepseek');
  });

  it('throws CONFIG_MISSING when the parser produced zero providers', async () => {
    const { readOpencodeConfig } = await import('./imports/opencode-config');
    vi.mocked(readOpencodeConfig).mockResolvedValueOnce({
      providers: [],
      apiKeyMap: {},
      activeProvider: null,
      activeModel: null,
      warnings: ['OpenCode auth.json is not valid JSON: ...'],
    });

    const handler = handlers.get('config:v1:import-opencode-config');
    await expect(handler?.({} as unknown)).rejects.toThrow(/importable API provider/i);
  });

  it('rejects providers that have metadata but no imported credential', async () => {
    const { readOpencodeConfig } = await import('./imports/opencode-config');
    const { writeConfig } = await import('./config');
    vi.mocked(writeConfig).mockClear();
    vi.mocked(readOpencodeConfig).mockResolvedValueOnce({
      providers: [
        {
          id: 'opencode-missing-key',
          name: 'OpenCode · Missing Key',
          builtin: false,
          wire: 'openai-chat',
          baseUrl: 'https://api.openai.com/v1',
          defaultModel: 'gpt-4o',
          envKey: 'OPENAI_API_KEY',
        },
      ],
      apiKeyMap: {},
      activeProvider: 'opencode-missing-key',
      activeModel: 'gpt-4o',
      warnings: [],
    });

    const handler = handlers.get('config:v1:import-opencode-config');
    await expect(handler?.({} as unknown)).rejects.toThrow(/usable API key/);
    expect(writeConfig).not.toHaveBeenCalled();
  });
});

describe('detectChatgptSubscription — non-ENOENT failure handling', () => {
  it('returns true when auth.json has auth_mode: chatgpt', async () => {
    const { detectChatgptSubscription } = await import('./onboarding-ipc');
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = join(tmpdir(), `codesign-subscription-${Date.now()}-${Math.random()}`);
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'auth.json');
    await writeFile(path, JSON.stringify({ auth_mode: 'chatgpt' }), 'utf8');
    await expect(detectChatgptSubscription(path)).resolves.toBe(true);
  });

  it('returns false when auth.json has a different auth_mode', async () => {
    const { detectChatgptSubscription } = await import('./onboarding-ipc');
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = join(tmpdir(), `codesign-subscription-${Date.now()}-${Math.random()}`);
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'auth.json');
    await writeFile(path, JSON.stringify({ OPENAI_API_KEY: 'sk-...' }), 'utf8');
    await expect(detectChatgptSubscription(path)).resolves.toBe(false);
  });

  it('returns false when auth.json is absent (ENOENT is silent)', async () => {
    const { detectChatgptSubscription } = await import('./onboarding-ipc');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const path = join(tmpdir(), `codesign-nonexistent-${Date.now()}-${Math.random()}.json`);
    await expect(detectChatgptSubscription(path)).resolves.toBe(false);
  });

  it('returns false on malformed JSON without throwing', async () => {
    const { detectChatgptSubscription } = await import('./onboarding-ipc');
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = join(tmpdir(), `codesign-malformed-${Date.now()}-${Math.random()}`);
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'auth.json');
    await writeFile(path, '{"auth_mode":', 'utf8');
    await expect(detectChatgptSubscription(path)).resolves.toBe(false);
  });
});
