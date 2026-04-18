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
  configPath: () => '/tmp/config.toml',
  configDir: () => '/tmp',
  readConfig: vi.fn(async () => null),
  writeConfig: vi.fn(async () => {}),
}));

vi.mock('./keychain', () => ({
  encryptSecret: vi.fn((s: string) => `enc:${s}`),
  decryptSecret: vi.fn((s: string) => s.replace('enc:', '')),
}));

vi.mock('./storage-settings', () => ({
  buildAppPaths: vi.fn(() => ({})),
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

  it('registers all eight settings v1 channels', async () => {
    const v1Channels = [
      'settings:v1:list-providers',
      'settings:v1:add-provider',
      'settings:v1:delete-provider',
      'settings:v1:set-active-provider',
      'settings:v1:get-paths',
      'settings:v1:open-folder',
      'settings:v1:reset-onboarding',
      'settings:v1:toggle-devtools',
    ];

    for (const ch of v1Channels) {
      expect(registeredChannels).toContain(ch);
    }
  });

  it('preserves all eight legacy settings shim channels for backward compat', async () => {
    const legacyChannels = [
      'settings:list-providers',
      'settings:add-provider',
      'settings:delete-provider',
      'settings:set-active-provider',
      'settings:get-paths',
      'settings:open-folder',
      'settings:reset-onboarding',
      'settings:toggle-devtools',
    ];

    for (const ch of legacyChannels) {
      expect(registeredChannels).toContain(ch);
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
});

describe('getApiKeyForProvider — API key retrieval', () => {
  it('returns the decrypted key when the provider secret exists in config', async () => {
    const { loadConfigOnBoot, getApiKeyForProvider } = await import('./onboarding-ipc');

    // Override readConfig to return a config with an anthropic secret.
    const { readConfig } = await import('./config');
    vi.mocked(readConfig).mockResolvedValueOnce({
      version: 1,
      provider: 'anthropic',
      modelPrimary: 'claude-sonnet-4-6',
      modelFast: 'claude-haiku-3',
      secrets: { anthropic: { ciphertext: 'enc:sk-ant-test' } },
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
