import {
  type GenerateImageOptions,
  defaultImageBaseUrl,
  defaultImageModel,
} from '@open-codesign/providers';
import {
  CodesignError,
  type Config,
  ERROR_CODES,
  IMAGE_GENERATION_SCHEMA_VERSION,
  type ImageGenerationCredentialMode,
  ImageGenerationCredentialModeSchema,
  type ImageGenerationOutputFormat,
  ImageGenerationOutputFormatSchema,
  type ImageGenerationProvider,
  ImageGenerationProviderSchema,
  type ImageGenerationQuality,
  ImageGenerationQualitySchema,
  type ImageGenerationSettings,
  ImageGenerationSettingsSchema,
  type ImageGenerationSize,
  ImageGenerationSizeSchema,
  hydrateConfig,
  preservedV3OptionalsForWrite,
} from '@open-codesign/shared';
import { writeConfig } from './config';
import { ipcMain } from './electron-runtime';
import { buildSecretRef, decryptSecret } from './keychain';
import { getLogger } from './logger';
import { getApiKeyForProvider, getCachedConfig, setCachedConfig } from './onboarding-ipc';

const log = getLogger('image-generation');

export interface ImageGenerationSettingsView {
  enabled: boolean;
  provider: ImageGenerationProvider;
  credentialMode: ImageGenerationCredentialMode;
  model: string;
  baseUrl: string;
  quality: ImageGenerationQuality;
  size: ImageGenerationSize;
  outputFormat: ImageGenerationOutputFormat;
  hasCustomKey: boolean;
  maskedKey: string | null;
  inheritedKeyAvailable: boolean;
}

interface ImageGenerationUpdateInput {
  enabled?: boolean;
  provider?: ImageGenerationProvider;
  credentialMode?: ImageGenerationCredentialMode;
  model?: string;
  baseUrl?: string;
  quality?: ImageGenerationQuality;
  size?: ImageGenerationSize;
  outputFormat?: ImageGenerationOutputFormat;
  apiKey?: string;
}

export interface ResolvedImageGenerationConfig {
  provider: ImageGenerationProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
  quality: ImageGenerationQuality;
  size: ImageGenerationSize;
  outputFormat: ImageGenerationOutputFormat;
}

export function defaultImageGenerationSettings(): ImageGenerationSettings {
  return {
    schemaVersion: IMAGE_GENERATION_SCHEMA_VERSION,
    enabled: false,
    provider: 'openai',
    credentialMode: 'inherit',
    model: defaultImageModel('openai'),
    quality: 'high',
    size: '1536x1024',
    outputFormat: 'png',
  };
}

export function imageSettingsToView(
  settings: ImageGenerationSettings | undefined,
): ImageGenerationSettingsView {
  const parsed = ImageGenerationSettingsSchema.parse(settings ?? defaultImageGenerationSettings());
  let inheritedKeyAvailable = false;
  try {
    getApiKeyForProvider(parsed.provider);
    inheritedKeyAvailable = true;
  } catch {
    inheritedKeyAvailable = false;
  }
  return {
    enabled: parsed.enabled,
    provider: parsed.provider,
    credentialMode: parsed.credentialMode,
    model: parsed.model,
    baseUrl: parsed.baseUrl ?? defaultImageBaseUrl(parsed.provider),
    quality: parsed.quality,
    size: parsed.size,
    outputFormat: parsed.outputFormat,
    hasCustomKey: parsed.apiKey !== undefined,
    maskedKey: parsed.apiKey?.mask ?? null,
    inheritedKeyAvailable,
  };
}

export function resolveImageGenerationConfig(cfg: Config): ResolvedImageGenerationConfig | null {
  const settings = cfg.imageGeneration;
  if (settings === undefined) return null;
  if (settings.enabled !== true) return null;
  const parsed = ImageGenerationSettingsSchema.parse(settings);
  let apiKey: string;
  if (parsed.credentialMode === 'custom') {
    if (parsed.apiKey === undefined) {
      log.warn('resolve.skipped', {
        reason: 'custom_key_missing',
        provider: parsed.provider,
      });
      return null;
    }
    apiKey = decryptSecret(parsed.apiKey.ciphertext);
  } else {
    try {
      apiKey = getApiKeyForProvider(parsed.provider);
    } catch (err) {
      log.warn('resolve.skipped', {
        reason: 'inherit_key_missing',
        provider: parsed.provider,
        message: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
  const inheritedBaseUrl =
    parsed.credentialMode === 'inherit' ? cfg.providers[parsed.provider]?.baseUrl : undefined;
  log.info('resolve.ok', {
    provider: parsed.provider,
    model: parsed.model,
    credentialMode: parsed.credentialMode,
  });
  return {
    provider: parsed.provider,
    apiKey,
    model: parsed.model,
    baseUrl: parsed.baseUrl ?? inheritedBaseUrl ?? defaultImageBaseUrl(parsed.provider),
    quality: parsed.quality,
    size: parsed.size,
    outputFormat: parsed.outputFormat,
  };
}

export function isGenerateImageAssetEnabled(cfg: Config): boolean {
  return resolveImageGenerationConfig(cfg) !== null;
}

export function imageGenerationKeyAvailable(cfg: Config | null): boolean {
  if (cfg === null) return false;
  const settings = cfg.imageGeneration;
  if (settings === undefined) return false;
  const parsed = ImageGenerationSettingsSchema.parse(settings);
  if (parsed.credentialMode === 'custom') return parsed.apiKey !== undefined;
  try {
    getApiKeyForProvider(parsed.provider);
    return true;
  } catch {
    return false;
  }
}

export function toGenerateImageOptions(
  config: ResolvedImageGenerationConfig,
  prompt: string,
  signal?: AbortSignal,
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4',
): GenerateImageOptions {
  const size = resolveImageSize(config.size, aspectRatio);
  return {
    provider: config.provider,
    apiKey: config.apiKey,
    model: config.model,
    baseUrl: config.baseUrl,
    prompt,
    quality: config.quality,
    size,
    outputFormat: config.outputFormat,
    ...(aspectRatio !== undefined ? { aspectRatio } : {}),
    ...(signal !== undefined ? { signal } : {}),
  };
}

/**
 * Map a caller-provided aspectRatio hint onto the OpenAI image API's discrete
 * `size` enum. When the caller did not supply an aspect ratio we keep the
 * user-configured default from Settings (`config.size`). The OpenRouter path
 * also receives `aspect_ratio` directly, so this mapping only matters for
 * backends that need a fixed bucketed size.
 */
export function resolveImageSize(
  configured: ImageGenerationSize,
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | undefined,
): ImageGenerationSize {
  if (aspectRatio === undefined) return configured;
  if (aspectRatio === '1:1') return '1024x1024';
  if (aspectRatio === '16:9' || aspectRatio === '4:3') return '1536x1024';
  return '1024x1536';
}

function parseUpdate(raw: unknown): ImageGenerationUpdateInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError(
      'image-generation:v1:update expects an object',
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  const r = raw as Record<string, unknown>;
  const out: ImageGenerationUpdateInput = {};
  if (typeof r['enabled'] === 'boolean') out.enabled = r['enabled'];
  if (typeof r['provider'] === 'string') {
    out.provider = ImageGenerationProviderSchema.parse(r['provider']);
  }
  if (typeof r['credentialMode'] === 'string') {
    out.credentialMode = ImageGenerationCredentialModeSchema.parse(r['credentialMode']);
  }
  if (typeof r['model'] === 'string') {
    const model = r['model'].trim();
    if (model.length > 0) out.model = model;
  }
  if (typeof r['baseUrl'] === 'string') {
    const baseUrl = r['baseUrl'].trim();
    if (baseUrl.length > 0) out.baseUrl = baseUrl;
  }
  if (typeof r['quality'] === 'string') {
    out.quality = ImageGenerationQualitySchema.parse(r['quality']);
  }
  if (typeof r['size'] === 'string') {
    out.size = ImageGenerationSizeSchema.parse(r['size']);
  }
  if (typeof r['outputFormat'] === 'string') {
    out.outputFormat = ImageGenerationOutputFormatSchema.parse(r['outputFormat']);
  }
  if (typeof r['apiKey'] === 'string') out.apiKey = r['apiKey'];
  return out;
}

async function updateImageGenerationSettings(
  patch: ImageGenerationUpdateInput,
): Promise<ImageGenerationSettingsView> {
  const cfg = getCachedConfig();
  if (cfg === null) {
    throw new CodesignError('No configuration found', ERROR_CODES.CONFIG_MISSING);
  }
  const current = ImageGenerationSettingsSchema.parse(
    cfg.imageGeneration ?? defaultImageGenerationSettings(),
  );
  const { apiKey: apiKeyPatch, ...safePatch } = patch;
  const provider = patch.provider ?? current.provider;
  const providerChanged = patch.provider !== undefined && patch.provider !== current.provider;
  let next: ImageGenerationSettings = {
    ...current,
    ...safePatch,
    provider,
    model: patch.model ?? (providerChanged ? defaultImageModel(provider) : current.model),
  };
  if (patch.baseUrl === undefined && providerChanged) {
    next.baseUrl = defaultImageBaseUrl(provider);
  }
  if (apiKeyPatch !== undefined) {
    const trimmed = apiKeyPatch.trim();
    if (trimmed.length === 0) {
      const { apiKey: _removed, ...rest } = next;
      next = rest;
    } else {
      next.apiKey = buildSecretRef(trimmed);
    }
  }
  const parsed = ImageGenerationSettingsSchema.parse(next);
  const config = hydrateConfig({
    version: 3,
    activeProvider: cfg.activeProvider,
    activeModel: cfg.activeModel,
    secrets: cfg.secrets,
    providers: cfg.providers,
    ...preservedV3OptionalsForWrite(cfg, { skipImageGeneration: true }),
    imageGeneration: parsed,
  });
  await writeConfig(config);
  setCachedConfig(config);
  return imageSettingsToView(parsed);
}

export function registerImageGenerationSettingsIpc(): void {
  ipcMain.handle('image-generation:v1:get', async (): Promise<ImageGenerationSettingsView> => {
    const cfg = getCachedConfig();
    return imageSettingsToView(cfg?.imageGeneration);
  });

  ipcMain.handle(
    'image-generation:v1:update',
    async (_e, raw: unknown): Promise<ImageGenerationSettingsView> => {
      return updateImageGenerationSettings(parseUpdate(raw));
    },
  );
}
