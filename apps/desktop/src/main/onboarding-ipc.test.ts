/**
 * Tests for settings IPC channel versioning.
 *
 * These tests verify that registerOnboardingIpc registers both the versioned
 * v1 channels and the legacy shim channels, ensuring backward compat for
 * callers that haven't migrated yet.
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
  tryBuildSecretRef: vi.fn((s: string) => ({
    ciphertext: `enc:${s}`,
    mask: s.length > 8 ? `${s.slice(0, 4)}***${s.slice(-4)}` : '***',
  })),
  migrateSecrets: vi.fn((cfg: { secrets?: Record<string, unknown> }) => ({
    config: cfg,
    changed: false,
  })),
  migrateSecretMasks: vi.fn((cfg: { secrets?: Record<string, unknown> }) => ({
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
  pingProvider: vi.fn(async () => ({ ok: true, modelCount: 1 })),
}));

describe('registerOnboardingIpc — channel versioning', () => {
  it('registers settings:v1:list-providers alongside the legacy settings:list-providers shim', async () => {
    // Import after mocks are in place.
    const { registerOnboardingIpc } = await import('./onboarding-ipc');
    registerOnboardingIpc();

    expect(registeredChannels).toContain('settings:v1:list-providers');
    expect(registeredChannels).toContain('settings:list-providers');
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

  it('preserves all legacy settings shim channels for backward compat', async () => {
    const legacyChannels = [
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

    for (const ch of legacyChannels) {
      expect(registeredChannels).toContain(ch);
    }
  });

  it('registers the canonical config:v1:set-provider-and-models handler', async () => {
    const { registerOnboardingIpc } = await import('./onboarding-ipc');
    registerOnboardingIpc();
    expect(registeredChannels).toContain('config:v1:set-provider-and-models');
  });
});

describe('config:v1:set-provider-and-models — payload validation', () => {
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
  it('imports providers without encrypting empty env secrets', async () => {
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
    await expect(handler?.({} as unknown)).resolves.toMatchObject({
      provider: 'codex-empty-env',
      hasKey: false,
    });

    expect(encryptSecret).not.toHaveBeenCalled();
    const written = vi.mocked(writeConfig).mock.calls.at(-1)?.[0];
    expect(written?.secrets['codex-empty-env']).toBeUndefined();
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

  it('creates a Claude Code entry without flipping active when local-proxy has no key', async () => {
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
    const state = (await handler?.({} as unknown)) as { provider: string };
    // Active provider stays on 'anthropic' because the new entry has no key.
    expect(state.provider).toBe('anthropic');

    const written = vi.mocked(writeConfig).mock.calls.at(-1)?.[0];
    expect(written?.activeProvider).toBe('anthropic');
    expect(written?.providers['claude-code-imported']).toBeDefined();
    expect(written?.secrets['claude-code-imported']).toBeUndefined();
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

describe('getApiKeyForProvider — envKey runtime fallback', () => {
  it('returns process.env[entry.envKey] when secret is absent but env is set', async () => {
    const ENV_NAME = 'OPEN_CODESIGN_TEST_ENV_FALLBACK_KEY';
    process.env[ENV_NAME] = 'sk-from-shell-env';
    const { readConfig } = await import('./config');
    vi.mocked(readConfig).mockResolvedValueOnce({
      version: 3,
      activeProvider: 'fallback-test',
      activeModel: 'x',
      secrets: {},
      providers: {
        'fallback-test': {
          id: 'fallback-test',
          name: 'Env Fallback',
          builtin: false,
          wire: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          defaultModel: 'x',
          envKey: ENV_NAME,
        },
      },
      provider: 'fallback-test',
      modelPrimary: 'x',
      baseUrls: {},
    });
    const { loadConfigOnBoot, getApiKeyForProvider } = await import('./onboarding-ipc');
    await loadConfigOnBoot();

    expect(getApiKeyForProvider('fallback-test')).toBe('sk-from-shell-env');
    delete process.env[ENV_NAME];
  });

  it('throws PROVIDER_KEY_MISSING when both secret and envKey are absent', async () => {
    const ENV_NAME = 'OPEN_CODESIGN_TEST_ENV_FALLBACK_EMPTY';
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

  it('falls back to the first imported provider when activeProvider is null', async () => {
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
});
