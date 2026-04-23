import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./electron-runtime', () => ({
  ipcMain: { handle: vi.fn() },
}));

const onboardingMocks = vi.hoisted(() => ({
  getCachedConfig: vi.fn(),
  getApiKeyForProvider: vi.fn(),
}));

vi.mock('./onboarding-ipc', () => ({
  getCachedConfig: onboardingMocks.getCachedConfig,
  getApiKeyForProvider: onboardingMocks.getApiKeyForProvider,
}));

const codexMocks = vi.hoisted(() => ({
  getValidAccessToken: vi.fn(),
}));

vi.mock('./codex-oauth-ipc', async () => {
  const actual = await vi.importActual<typeof import('./codex-oauth-ipc')>('./codex-oauth-ipc');
  return {
    ...actual,
    getCodexTokenStore: () => ({
      getValidAccessToken: codexMocks.getValidAccessToken,
    }),
  };
});

import {
  BUILTIN_PROVIDERS,
  CHATGPT_CODEX_PROVIDER_ID,
  type Config,
  hydrateConfig,
} from '@open-codesign/shared';
import { resolveActiveCredentials, resolveCredentialsForProvider } from './connection-ipc';

function makeCfg(input: {
  activeProvider: string;
  activeModel: string;
  providers?: Record<string, import('@open-codesign/shared').ProviderEntry>;
  secrets?: Record<string, { ciphertext: string }>;
}): Config {
  return hydrateConfig({
    version: 3,
    activeProvider: input.activeProvider,
    activeModel: input.activeModel,
    providers: {
      openai: { ...BUILTIN_PROVIDERS.openai },
      ...(input.providers ?? {}),
    },
    secrets: input.secrets ?? {},
  });
}

describe('connection test credential parity', () => {
  beforeEach(() => {
    onboardingMocks.getCachedConfig.mockReset();
    onboardingMocks.getApiKeyForProvider.mockReset();
    codexMocks.getValidAccessToken.mockReset();
  });

  it('test-active resolves ChatGPT Codex auth via the same token accessor runtime uses', async () => {
    onboardingMocks.getCachedConfig.mockReturnValue(
      makeCfg({
        activeProvider: CHATGPT_CODEX_PROVIDER_ID,
        activeModel: 'gpt-5.3-codex',
        providers: {
          [CHATGPT_CODEX_PROVIDER_ID]: {
            id: CHATGPT_CODEX_PROVIDER_ID,
            name: 'ChatGPT Codex',
            builtin: false,
            wire: 'openai-codex-responses',
            baseUrl: 'https://chatgpt.com/backend-api',
            defaultModel: 'gpt-5.3-codex',
            requiresApiKey: false,
            capabilities: {
              supportsKeyless: true,
              supportsModelsEndpoint: false,
              supportsReasoning: true,
              requiresClaudeCodeIdentity: false,
              modelDiscoveryMode: 'static-hint',
            },
          },
        },
      }),
    );
    codexMocks.getValidAccessToken.mockResolvedValue('oauth-access-token');

    const result = await resolveActiveCredentials();

    expect('provider' in result).toBe(true);
    if ('provider' in result) {
      expect(result.provider).toBe(CHATGPT_CODEX_PROVIDER_ID);
      expect(result.wire).toBe('openai-codex-responses');
      expect(result.apiKey).toBe('oauth-access-token');
      expect(codexMocks.getValidAccessToken).toHaveBeenCalledTimes(1);
    }
  });

  it('test-provider respects explicit keyless capability and returns an empty bearer', async () => {
    onboardingMocks.getCachedConfig.mockReturnValue(
      makeCfg({
        activeProvider: 'openai',
        activeModel: 'gpt-4o',
        secrets: { openai: { ciphertext: 'enc-openai' } },
        providers: {
          'litellm-proxy': {
            id: 'litellm-proxy',
            name: 'LiteLLM Proxy',
            builtin: false,
            wire: 'openai-chat',
            baseUrl: 'https://proxy.example.com/v1',
            defaultModel: 'gpt-4.1',
            capabilities: {
              supportsKeyless: true,
              supportsModelsEndpoint: true,
              supportsReasoning: true,
              requiresClaudeCodeIdentity: false,
              modelDiscoveryMode: 'models',
            },
          },
        },
      }),
    );
    onboardingMocks.getApiKeyForProvider.mockImplementation(() => {
      throw new Error('missing secret');
    });

    const result = await resolveCredentialsForProvider('litellm-proxy');

    expect('provider' in result).toBe(true);
    if ('provider' in result) {
      expect(result.provider).toBe('litellm-proxy');
      expect(result.apiKey).toBe('');
      expect(result.baseUrl).toBe('https://proxy.example.com/v1');
    }
  });

  it('test-provider returns an actionable config error for unknown providers', async () => {
    onboardingMocks.getCachedConfig.mockReturnValue(
      makeCfg({
        activeProvider: 'openai',
        activeModel: 'gpt-4o',
        secrets: { openai: { ciphertext: 'enc-openai' } },
      }),
    );

    const result = await resolveCredentialsForProvider('missing-provider');

    expect(result).toMatchObject({
      ok: false,
      code: 'IPC_BAD_INPUT',
    });
    if (!('provider' in result)) {
      expect(result.message).toContain('missing-provider');
    }
  });
});
