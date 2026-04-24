import {
  type Config,
  hydrateConfig,
  IMAGE_GENERATION_SCHEMA_VERSION,
  type ProviderEntry,
} from '@open-codesign/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  imageSettingsToView,
  isGenerateImageAssetEnabled,
  resolveImageGenerationConfig,
} from './image-generation-settings';

const getApiKeyForProviderMock = vi.fn<(provider: string) => string>();

vi.mock('./onboarding-ipc', () => ({
  getApiKeyForProvider: (provider: string) => getApiKeyForProviderMock(provider),
  getCachedConfig: () => null,
  setCachedConfig: () => {},
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

describe('image generation enablement', () => {
  afterEach(() => {
    getApiKeyForProviderMock.mockReset();
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

  it('keeps generate_image_asset disabled when image generation is on but key is unavailable', () => {
    getApiKeyForProviderMock.mockImplementation(() => {
      throw new Error('missing key');
    });
    const cfg = makeConfig(true);
    expect(isGenerateImageAssetEnabled(cfg)).toBe(false);
    expect(resolveImageGenerationConfig(cfg)).toBeNull();
  });

  it('reports inheritedKeyAvailable=false in the view when the provider key is missing', () => {
    getApiKeyForProviderMock.mockImplementation(() => {
      throw new Error('missing key');
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
});
