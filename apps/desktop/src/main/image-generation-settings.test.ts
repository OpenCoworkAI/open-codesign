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

describe('image generation enablement', () => {
  afterEach(() => {
    mocks.cachedConfig = null;
    getApiKeyForProviderMock.mockReset();
    mocks.setCachedConfig.mockReset();
    mocks.writeConfig.mockReset();
  });

  it('disables generate_image_asset when image generation is turned off', () => {
    const cfg = makeConfig(false);
    expect(isGenerateImageAssetEnabled(cfg)).toBe(false);
    expect(resolveImageGenerationConfig(cfg)).toBeNull();
  });

  it('enables generate_image_asset when image generation is on and key is available', () => {
    getApiKeyForProviderMock.mockReturnValue('sk-openai');
    const cfg = makeConfig(true);
    expect(isGenerateImageAssetEnabled(cfg)).toBe(true);
    expect(resolveImageGenerationConfig(cfg)).toMatchObject({
      provider: 'openai',
      model: 'gpt-image-2',
      apiKey: 'sk-openai',
    });
  });

  it('throws when image generation is on but inherited key is unavailable', () => {
    getApiKeyForProviderMock.mockImplementation(() => {
      throw new CodesignError('missing key', ERROR_CODES.PROVIDER_KEY_MISSING);
    });
    const cfg = makeConfig(true);
    expect(() => isGenerateImageAssetEnabled(cfg)).toThrow(/missing key/);
    expect(() => resolveImageGenerationConfig(cfg)).toThrow(/missing key/);
  });

  it('throws PROVIDER_KEY_MISSING when custom credential mode has no custom key', () => {
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

    expectThrowCode(() => resolveImageGenerationConfig(parsed), ERROR_CODES.PROVIDER_KEY_MISSING);
  });

  it('reports inheritedKeyAvailable=false in the view when the provider key is missing', () => {
    getApiKeyForProviderMock.mockImplementation(() => {
      throw new CodesignError('missing key', ERROR_CODES.PROVIDER_KEY_MISSING);
    });
    const cfg = makeConfig(true);
    const view = imageSettingsToView(cfg.imageGeneration);
    expect(view.enabled).toBe(true);
    expect(view.credentialMode).toBe('inherit');
    expect(view.inheritedKeyAvailable).toBe(false);
    expect(view.hasCustomKey).toBe(false);
  });

  it('reports inheritedKeyAvailable=true in the view when the provider key exists', () => {
    getApiKeyForProviderMock.mockReturnValue('sk-openai');
    const cfg = makeConfig(true);
    const view = imageSettingsToView(cfg.imageGeneration);
    expect(view.inheritedKeyAvailable).toBe(true);
  });

  it('throws credential corruption instead of reporting it as a missing inherited key', () => {
    getApiKeyForProviderMock.mockImplementation(() => {
      throw new CodesignError('decrypt failed', ERROR_CODES.KEYCHAIN_UNAVAILABLE);
    });
    const cfg = makeConfig(true);
    expectThrowCode(
      () => imageSettingsToView(cfg.imageGeneration),
      ERROR_CODES.KEYCHAIN_UNAVAILABLE,
    );
    expectThrowCode(() => imageGenerationKeyAvailable(cfg), ERROR_CODES.KEYCHAIN_UNAVAILABLE);
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
