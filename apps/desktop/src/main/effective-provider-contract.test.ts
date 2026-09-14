import {
  BUILTIN_PROVIDERS,
  CHATGPT_CODEX_PROVIDER_ID,
  type Config,
  hydrateConfig,
} from '@open-codesign/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  canonicalInvokeBaseUrl,
  resolveEffectiveInvokeContract,
} from './effective-provider-contract';
import { resolveActiveModel, resolveProviderModel } from './provider-settings';
import { resolveCredentialForProvider } from './resolve-api-key';

function makeCfg(input: {
  provider: string;
  modelPrimary: string;
  secrets?: Record<string, { ciphertext: string }>;
  providers?: Record<string, import('@open-codesign/shared').ProviderEntry>;
}): Config {
  const providers: Record<string, import('@open-codesign/shared').ProviderEntry> = {
    anthropic: {
      ...BUILTIN_PROVIDERS.anthropic,
    },
    openai: {
      ...BUILTIN_PROVIDERS.openai,
    },
    openrouter: {
      ...BUILTIN_PROVIDERS.openrouter,
    },
    ...(input.providers ?? {}),
  };
  return hydrateConfig({
    version: 3,
    activeProvider: input.provider,
    activeModel: input.modelPrimary,
    secrets: input.secrets ?? {},
    providers,
  });
}

function creds(
  overrides: {
    getCodexAccessToken?: () => Promise<string>;
    getApiKeyForProvider?: (id: string) => string;
    hasApiKeyForProvider?: (id: string) => boolean;
  } = {},
) {
  return {
    getCodexAccessToken: overrides.getCodexAccessToken ?? vi.fn().mockResolvedValue('codex-token'),
    getApiKeyForProvider: overrides.getApiKeyForProvider ?? vi.fn().mockReturnValue('stored-key'),
    hasApiKeyForProvider: overrides.hasApiKeyForProvider ?? vi.fn().mockReturnValue(true),
  };
}

describe('resolveEffectiveInvokeContract vs generate', () => {
  it('test-active shares active-provider snap, wire, canonical baseUrl, and API key with generate', async () => {
    const cfg = makeCfg({
      provider: 'openrouter',
      modelPrimary: 'anthropic/claude-sonnet-4.6',
      secrets: {
        openai: { ciphertext: 'enc-oai' },
        openrouter: { ciphertext: 'enc-or' },
      },
      providers: {
        openai: {
          ...BUILTIN_PROVIDERS.openai,
          baseUrl: 'https://api.duckcoding.ai/v1',
        },
      },
    });
    const hint = { provider: 'openai', modelId: 'gpt-4o' };
    const deps = creds();

    const active = resolveActiveModel(cfg, hint);
    const apiKey = await resolveCredentialForProvider(
      active.model.provider,
      active.allowKeyless,
      deps,
    );
    const contract = await resolveEffectiveInvokeContract({
      cfg,
      mode: 'active',
      hint,
      creds: deps,
    });

    expect(contract.overridden).toBe(true);
    expect(contract.providerId).toBe(active.model.provider);
    expect(contract.modelId).toBe(active.model.modelId);
    expect(contract.wire).toBe(active.wire);
    expect(contract.canonicalBaseUrl).toBe(canonicalInvokeBaseUrl(active.baseUrl, active.wire));
    expect(contract.apiKey).toBe(apiKey);
    expect(contract.providerId).toBe('openrouter');
    expect(contract.canonicalBaseUrl).toBe('https://openrouter.ai/api/v1');
    expect(contract.canonicalBaseUrl).not.toBe('https://api.duckcoding.ai/v1');
    expect(contract.authMode).toBe('bearer');
    expect(contract.authHeaders['authorization']).toBe('Bearer stored-key');
  });

  it('test-provider uses the named provider contract and does not snap to active', async () => {
    const cfg = makeCfg({
      provider: 'openrouter',
      modelPrimary: 'anthropic/claude-sonnet-4.6',
      secrets: {
        openai: { ciphertext: 'enc-oai' },
        openrouter: { ciphertext: 'enc-or' },
      },
      providers: {
        openai: {
          ...BUILTIN_PROVIDERS.openai,
          baseUrl: 'https://gateway.example.com',
        },
      },
    });
    const deps = creds();
    const named = resolveProviderModel(cfg, 'openai');
    const contract = await resolveEffectiveInvokeContract({
      cfg,
      mode: 'provider',
      providerId: 'openai',
      creds: deps,
    });

    expect(contract.overridden).toBe(false);
    expect(contract.providerId).toBe('openai');
    expect(contract.wire).toBe(named.wire);
    expect(contract.canonicalBaseUrl).toBe('https://gateway.example.com/v1');
    expect(contract.invokeUrl).toBe('https://gateway.example.com/v1/chat/completions');
    expect(contract.modelsUrl).toBe('https://gateway.example.com/v1/models');
    expect(contract.modelsProbeRelation).toBe('optional-discovery');
  });

  it('ChatGPT Codex OAuth uses getValidAccessToken, not a stored API-key row', async () => {
    const cfg = makeCfg({
      provider: CHATGPT_CODEX_PROVIDER_ID,
      modelPrimary: 'gpt-5.5',
      providers: {
        [CHATGPT_CODEX_PROVIDER_ID]: {
          id: CHATGPT_CODEX_PROVIDER_ID,
          name: 'ChatGPT 订阅',
          builtin: false,
          wire: 'openai-codex-responses',
          baseUrl: 'https://chatgpt.com/backend-api',
          defaultModel: 'gpt-5.5',
          requiresApiKey: false,
          capabilities: {
            supportsKeyless: true,
            supportsModelsEndpoint: false,
            modelDiscoveryMode: 'static-hint',
          },
        },
      },
    });
    const deps = creds({
      getCodexAccessToken: vi.fn().mockResolvedValue('refreshed-oauth'),
      getApiKeyForProvider: vi.fn(() => {
        throw new Error('must not read API-key storage for Codex');
      }),
      hasApiKeyForProvider: vi.fn().mockReturnValue(false),
    });

    const contract = await resolveEffectiveInvokeContract({
      cfg,
      mode: 'active',
      creds: deps,
    });

    expect(deps.getCodexAccessToken).toHaveBeenCalledTimes(1);
    expect(deps.getApiKeyForProvider).not.toHaveBeenCalled();
    expect(contract.apiKey).toBe('refreshed-oauth');
    expect(contract.authMode).toBe('codex-oauth');
    expect(contract.modelsProbeRelation).toBe('unavailable');
    expect(contract.modelsUrl).toBeNull();
    expect(contract.invokeUrl).toBe('https://chatgpt.com/backend-api/codex/responses');
    expect(contract.authHeaders['authorization']).toBe('Bearer refreshed-oauth');
  });

  it('keyless proxy keeps an empty bearer, matching generate allowKeyless', async () => {
    const cfg = makeCfg({
      provider: 'local-proxy',
      modelPrimary: 'llama3',
      providers: {
        'local-proxy': {
          id: 'local-proxy',
          name: 'Local proxy',
          builtin: false,
          wire: 'openai-chat',
          baseUrl: 'http://127.0.0.1:8317/v1',
          defaultModel: 'llama3',
          requiresApiKey: false,
        },
      },
    });
    const deps = creds({
      hasApiKeyForProvider: vi.fn().mockReturnValue(false),
      getApiKeyForProvider: vi.fn(() => {
        throw new Error('must not read key storage when keyless');
      }),
    });

    const active = resolveActiveModel(cfg, { provider: 'local-proxy', modelId: 'llama3' });
    const apiKey = await resolveCredentialForProvider(
      active.model.provider,
      active.allowKeyless,
      deps,
    );
    const contract = await resolveEffectiveInvokeContract({
      cfg,
      mode: 'active',
      creds: deps,
    });

    expect(active.allowKeyless).toBe(true);
    expect(apiKey).toBe('');
    expect(contract.apiKey).toBe('');
    expect(contract.authMode).toBe('keyless');
    expect(contract.allowKeyless).toBe(true);
    expect(contract.authHeaders['authorization']).toBeUndefined();
  });
});
