import { type Config, hydrateConfig } from '@open-codesign/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./electron-runtime', () => ({
  ipcMain: { handle: vi.fn() },
}));

const { getCachedConfigMock, getApiKeyForProviderMock } = vi.hoisted(() => ({
  getCachedConfigMock: vi.fn<() => Config | null>(),
  getApiKeyForProviderMock: vi.fn<(providerId: string) => string>(),
}));

vi.mock('./onboarding-ipc', () => ({
  getCachedConfig: getCachedConfigMock,
  getApiKeyForProvider: getApiKeyForProviderMock,
}));

vi.mock('./codex-oauth-ipc', () => ({
  getCodexTokenStore: () => ({
    getValidAccessToken: vi.fn(async () => 'codex-token'),
    read: vi.fn(async () => null),
  }),
}));

import { resolveActiveCredentials, resolveCredentialsForProvider } from './connection-ipc';

function makeCfg(): Config {
  return hydrateConfig({
    version: 3,
    activeProvider: 'claude-shell',
    activeModel: 'claude-sonnet-4-6',
    providers: {
      'claude-shell': {
        id: 'claude-shell',
        name: 'Claude (shell env)',
        builtin: false,
        wire: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        defaultModel: 'claude-sonnet-4-6',
        envKey: 'ANTHROPIC_AUTH_TOKEN',
      },
    },
    secrets: {},
  });
}

describe('connection credential resolution via envKey fallback', () => {
  beforeEach(() => {
    getCachedConfigMock.mockReset();
    getApiKeyForProviderMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('resolveCredentialsForProvider delegates to getApiKeyForProvider for env-backed imported providers', async () => {
    getCachedConfigMock.mockReturnValue(makeCfg());
    getApiKeyForProviderMock.mockReturnValue('sk-from-env');

    const result = await resolveCredentialsForProvider('claude-shell');

    expect(getApiKeyForProviderMock).toHaveBeenCalledWith('claude-shell');
    expect(result).toMatchObject({
      provider: 'claude-shell',
      wire: 'anthropic',
      apiKey: 'sk-from-env',
      baseUrl: 'https://api.anthropic.com',
      capabilities: {
        supportsReasoning: true,
        supportsModelsEndpoint: true,
      },
    });
  });

  it('resolveActiveCredentials also reaches env-backed imported providers without a stored secret', async () => {
    getCachedConfigMock.mockReturnValue(makeCfg());
    getApiKeyForProviderMock.mockReturnValue('sk-from-env');

    const result = await resolveActiveCredentials();

    expect(getApiKeyForProviderMock).toHaveBeenCalledWith('claude-shell');
    expect(result).toMatchObject({
      provider: 'claude-shell',
      wire: 'anthropic',
      apiKey: 'sk-from-env',
      baseUrl: 'https://api.anthropic.com',
      capabilities: {
        supportsReasoning: true,
        supportsModelsEndpoint: true,
      },
    });
  });
});
