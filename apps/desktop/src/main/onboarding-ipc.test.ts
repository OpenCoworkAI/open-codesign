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
  migrateSecretMasks: vi.fn((cfg: { secrets?: Record<string, unknown> }) => ({
    config: cfg,
    changed: false,
  })),
  ensureKeychainAvailable: vi.fn(() => {}),
}));

vi.mock('./keychain-ux', () => ({
  prepareKeychain: vi.fn(async () => true),
  maybeShowKeychainExplainer: vi.fn(async () => {}),
  maybeShowKeychainUnavailableDialog: vi.fn(async () => {}),
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
}));

vi.mock('./imports/claude-code-config', () => ({
  readClaudeCodeSettings: vi.fn(async () => null),
}));

vi.mock('./ssh-remote', () => ({
  testSshConnection: vi.fn(async () => undefined),
  testSavedSshProfile: vi.fn(async () => undefined),
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
      sshProfiles: {},
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
    const { tryBuildSecretRef } = await import('./keychain');
    const { writeConfig } = await import('./config');
    vi.mocked(tryBuildSecretRef).mockClear();
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

    expect(tryBuildSecretRef).toHaveBeenCalledWith('sk-codex-auth');
    const written = vi.mocked(writeConfig).mock.calls.at(-1)?.[0];
    expect(written?.secrets['codex-custom']).toEqual(
      expect.objectContaining({ ciphertext: 'enc:sk-codex-auth' }),
    );
  });
});
