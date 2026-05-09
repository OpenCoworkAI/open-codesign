import {
  CodesignError,
  type Config,
  ERROR_CODES,
  hydrateConfig,
  IMAGE_GENERATION_SCHEMA_VERSION,
  type ProviderEntry,
} from '@open-codesign/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  imageGenerationKeyAvailable,
  imageSettingsToView,
  isGenerateImageAssetEnabled,
  parseImageGenerationUpdate,
  resolveImageGenerationConfig,
  updateImageGenerationSettings,
} from './image-generation-settings';

const mocks = vi.hoisted(() => ({
  cachedConfig: null as Config | null,
  getApiKeyForProvider: vi.fn<(provider: string) => string>(),
  codexRead: vi.fn<() => Promise<unknown>>(),
  codexGetValidAccessToken: vi.fn<() => Promise<string>>(),
  setCachedConfig: vi.fn<(config: Config) => void>(),
  writeConfig: vi.fn<(config: Config) => Promise<void>>(),
}));

const getApiKeyForProviderMock = mocks.getApiKeyForProvider;

vi.mock('./config', () => ({
  writeConfig: (config: Config) => mocks.writeConfig(config),
}));

vi.mock('./onboarding-ipc', () => ({
  getApiKeyForProvider: (provider: string) => getApiKeyForProviderMock(provider),
  getCachedConfig: () => mocks.cachedConfig,
  setCachedConfig: (config: Config) => {
    mocks.cachedConfig = config;
    mocks.setCachedConfig(config);
  },
}));

vi.mock('./codex-oauth-ipc', () => ({
  getCodexTokenStore: () => ({
    read: mocks.codexRead,
    getValidAccessToken: mocks.codexGetValidAccessToken,
  }),
}));

vi.mock('./keychain', () => ({
  buildSecretRef: (value: string) => ({ ciphertext: value, mask: '***' }),
  decryptSecret: (value: string) => value,
}));

vi.mock('./logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function makeConfig(imageEnabled: boolean): Config {
  const providers: Record<string, ProviderEntry> = {
    openai: {
      id: 'openai',
      name: 'OpenAI',
      builtin: true,
      wire: 'openai-chat',
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-5.4',
    },
  };
  return hydrateConfig({
    version: 3,
    activeProvider: 'openai',
    activeModel: 'gpt-5.4',
    providers,
    secrets: {},
    imageGeneration: {
      schemaVersion: IMAGE_GENERATION_SCHEMA_VERSION,
      enabled: imageEnabled,
      provider: 'openai',
      credentialMode: 'inherit',
      model: 'gpt-image-2',
      quality: 'high',
      size: '1536x1024',
      outputFormat: 'png',
    },
  });
}

function expectThrowCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected function to throw ${code}`);
}

async function expectRejectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (err) {
    expect(err).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected promise to reject ${code}`);
}

describe('image generation enablement', () => {
  afterEach(() => {
    mocks.cachedConfig = null;
    getApiKeyForProviderMock.mockReset();
    mocks.codexRead.mockReset();
    mocks.codexGetValidAccessToken.mockReset();
    mocks.setCachedConfig.mockReset();
    mocks.writeConfig.mockReset();
  });

  it('disables generate_image_asset when image generation is turned off', async () => {
    const cfg = makeConfig(false);
    await expect(isGenerateImageAssetEnabled(cfg)).resolves.toBe(false);
    await expect(resolveImageGenerationConfig(cfg)).resolves.toBeNull();
  });

  it('enables generate_image_asset when image generation is on and key is available', async () => {
    getApiKeyForProviderMock.mockReturnValue('sk-openai');
    const cfg = makeConfig(true);
    await expect(isGenerateImageAssetEnabled(cfg)).resolves.toBe(true);
    await expect(resolveImageGenerationConfig(cfg)).resolves.toMatchObject({
      provider: 'openai',
      model: 'gpt-image-2',
      apiKey: 'sk-openai',
    });
  });

  it('throws when image generation is on but inherited key is unavailable', async () => {
    getApiKeyForProviderMock.mockImplementation(() => {
      throw new CodesignError('missing key', ERROR_CODES.PROVIDER_KEY_MISSING);
    });
    const cfg = makeConfig(true);
    await expect(isGenerateImageAssetEnabled(cfg)).rejects.toThrow(/missing key/);
    await expect(resolveImageGenerationConfig(cfg)).rejects.toThrow(/missing key/);
  });

  it('throws PROVIDER_KEY_MISSING when custom credential mode has no custom key', async () => {
    const cfg = makeConfig(true);
    const parsed = hydrateConfig({
      version: 3,
      activeProvider: cfg.activeProvider,
      activeModel: cfg.activeModel,
      providers: cfg.providers,
      secrets: cfg.secrets,
      imageGeneration: {
        schemaVersion: IMAGE_GENERATION_SCHEMA_VERSION,
        enabled: true,
        provider: 'openai',
        credentialMode: 'custom',
        model: 'gpt-image-2',
        quality: 'high',
        size: '1536x1024',
        outputFormat: 'png',
      },
    });

    await expectRejectCode(resolveImageGenerationConfig(parsed), ERROR_CODES.PROVIDER_KEY_MISSING);
  });

  it('reports inheritedKeyAvailable=false in the view when the provider key is missing', async () => {
    getApiKeyForProviderMock.mockImplementation(() => {
      throw new CodesignError('missing key', ERROR_CODES.PROVIDER_KEY_MISSING);
    });
    const cfg = makeConfig(true);
    const view = await imageSettingsToView(cfg.imageGeneration);
    expect(view.enabled).toBe(true);
    expect(view.credentialMode).toBe('inherit');
    expect(view.inheritedKeyAvailable).toBe(false);
    expect(view.hasCustomKey).toBe(false);
  });

  it('reports inheritedKeyAvailable=true in the view when the provider key exists', async () => {
    getApiKeyForProviderMock.mockReturnValue('sk-openai');
    const cfg = makeConfig(true);
    const view = await imageSettingsToView(cfg.imageGeneration);
    expect(view.inheritedKeyAvailable).toBe(true);
  });

  it('throws credential corruption instead of reporting it as a missing inherited key', async () => {
    getApiKeyForProviderMock.mockImplementation(() => {
      throw new CodesignError('decrypt failed', ERROR_CODES.KEYCHAIN_UNAVAILABLE);
    });
    const cfg = makeConfig(true);
    await expectRejectCode(
      imageSettingsToView(cfg.imageGeneration),
      ERROR_CODES.KEYCHAIN_UNAVAILABLE,
    );
    await expectRejectCode(imageGenerationKeyAvailable(cfg), ERROR_CODES.KEYCHAIN_UNAVAILABLE);
  });

  it('resolves ChatGPT subscription image generation through the OAuth token store', async () => {
    mocks.codexGetValidAccessToken.mockResolvedValue('oauth-token');
    const cfg = hydrateConfig({
      version: 3,
      activeProvider: 'chatgpt-codex',
      activeModel: 'gpt-5.5',
      providers: {
        'chatgpt-codex': {
          id: 'chatgpt-codex',
          name: 'ChatGPT subscription',
          builtin: false,
          wire: 'openai-codex-responses',
          baseUrl: 'https://chatgpt.com/backend-api',
          defaultModel: 'gpt-5.5',
          requiresApiKey: false,
        },
      },
      secrets: {},
      imageGeneration: {
        schemaVersion: IMAGE_GENERATION_SCHEMA_VERSION,
        enabled: true,
        provider: 'chatgpt-codex',
        credentialMode: 'inherit',
        model: 'gpt-5.5',
        quality: 'high',
        size: '1536x1024',
        outputFormat: 'png',
      },
    });

    await expect(resolveImageGenerationConfig(cfg)).resolves.toMatchObject({
      provider: 'chatgpt-codex',
      model: 'gpt-5.5',
      apiKey: 'oauth-token',
      baseUrl: 'https://chatgpt.com/backend-api',
    });
    expect(getApiKeyForProviderMock).not.toHaveBeenCalled();
  });

  it('reports ChatGPT subscription inherited credential availability from OAuth status', async () => {
    mocks.codexRead.mockResolvedValue({
      schemaVersion: 1,
      accessToken: 'token',
      refreshToken: 'refresh',
      idToken: 'id',
      expiresAt: Date.now() + 1000,
      accountId: 'acct',
      email: 'person@example.com',
      updatedAt: Date.now(),
    });
    const view = await imageSettingsToView({
      schemaVersion: IMAGE_GENERATION_SCHEMA_VERSION,
      enabled: true,
      provider: 'chatgpt-codex',
      credentialMode: 'inherit',
      model: 'gpt-5.5',
      quality: 'high',
      size: '1536x1024',
      outputFormat: 'png',
    });

    expect(view.inheritedKeyAvailable).toBe(true);
  });

  it('reports ChatGPT subscription key availability from imageGenerationKeyAvailable', async () => {
    const cfg = hydrateConfig({
      version: 3,
      activeProvider: 'openai',
      activeModel: 'gpt-5.4',
      providers: {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          builtin: true,
          wire: 'openai-chat',
          baseUrl: 'https://api.openai.com/v1',
          defaultModel: 'gpt-5.4',
        },
        'chatgpt-codex': {
          id: 'chatgpt-codex',
          name: 'ChatGPT subscription',
          builtin: false,
          wire: 'openai-codex-responses',
          baseUrl: 'https://chatgpt.com/backend-api',
          defaultModel: 'gpt-5.5',
          requiresApiKey: false,
        },
      },
      secrets: {},
      imageGeneration: {
        schemaVersion: IMAGE_GENERATION_SCHEMA_VERSION,
        enabled: true,
        provider: 'chatgpt-codex',
        credentialMode: 'inherit',
        model: 'gpt-5.5',
        quality: 'high',
        size: '1536x1024',
        outputFormat: 'png',
      },
    });

    mocks.codexRead.mockResolvedValue({
      schemaVersion: 1,
      accessToken: 'token',
      refreshToken: 'refresh',
      idToken: 'id',
      expiresAt: Date.now() + 1000,
      accountId: 'acct',
      email: 'person@example.com',
      updatedAt: Date.now(),
    });
    await expect(imageGenerationKeyAvailable(cfg)).resolves.toBe(true);

    mocks.codexRead.mockResolvedValue(null);
    await expect(imageGenerationKeyAvailable(cfg)).resolves.toBe(false);
  });

  it('clears provider-scoped custom keys when the image provider changes', async () => {
    const cfg = makeConfig(true);
    mocks.cachedConfig = hydrateConfig({
      version: 3,
      activeProvider: cfg.activeProvider,
      activeModel: cfg.activeModel,
      providers: cfg.providers,
      secrets: cfg.secrets,
      imageGeneration: {
        schemaVersion: IMAGE_GENERATION_SCHEMA_VERSION,
        enabled: true,
        provider: 'openai',
        credentialMode: 'custom',
        model: 'gpt-image-2',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: { ciphertext: 'old-openai-key', mask: 'sk-openai***' },
        quality: 'high',
        size: '1536x1024',
        outputFormat: 'png',
      },
    });
    getApiKeyForProviderMock.mockImplementation(() => {
      throw new CodesignError('missing inherited key', ERROR_CODES.PROVIDER_KEY_MISSING);
    });

    const view = await updateImageGenerationSettings({ provider: 'openrouter' });

    expect(view).toMatchObject({
      provider: 'openrouter',
      credentialMode: 'custom',
      model: 'openai/gpt-5.4-image-2',
      baseUrl: 'https://openrouter.ai/api/v1',
      hasCustomKey: false,
      maskedKey: null,
      inheritedKeyAvailable: false,
    });
    expect(mocks.writeConfig).toHaveBeenCalledTimes(1);
    const written = mocks.writeConfig.mock.calls[0]?.[0] as Config;
    expect(written.imageGeneration?.apiKey).toBeUndefined();
    expect(mocks.setCachedConfig).toHaveBeenCalledWith(written);
  });

  it('rejects malformed update fields instead of ignoring them', () => {
    expectThrowCode(
      () => parseImageGenerationUpdate({ enabled: 'true' }),
      ERROR_CODES.IPC_BAD_INPUT,
    );
    expectThrowCode(() => parseImageGenerationUpdate({ model: '   ' }), ERROR_CODES.IPC_BAD_INPUT);
    expectThrowCode(
      () => parseImageGenerationUpdate({ baseUrl: 'not a url' }),
      ERROR_CODES.IPC_BAD_INPUT,
    );
    expectThrowCode(
      () => parseImageGenerationUpdate({ quality: 'ultra' }),
      ERROR_CODES.IPC_BAD_INPUT,
    );
    expectThrowCode(
      () => parseImageGenerationUpdate({ enabled: true, typoedField: 'ignored before' }),
      ERROR_CODES.IPC_BAD_INPUT,
    );
  });

  it('parses a valid update and trims string fields', () => {
    expect(
      parseImageGenerationUpdate({
        enabled: true,
        provider: 'openai',
        credentialMode: 'custom',
        model: ' gpt-image-2 ',
        baseUrl: ' https://api.openai.com/v1 ',
        quality: 'high',
        size: '1024x1024',
        outputFormat: 'png',
        apiKey: ' sk-test ',
      }),
    ).toMatchObject({
      enabled: true,
      provider: 'openai',
      credentialMode: 'custom',
      model: 'gpt-image-2',
      baseUrl: 'https://api.openai.com/v1',
      quality: 'high',
      size: '1024x1024',
      outputFormat: 'png',
      apiKey: ' sk-test ',
    });
  });
});
