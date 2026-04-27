import {
  defaultImageBaseUrl,
  defaultImageModel,
  type GenerateImageOptions,
} from '@open-codesign/providers';
import {
  CodesignError,
  type Config,
  ERROR_CODES,
  hydrateConfig,
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

export interface ImageGenerationUpdateInput {
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

const IMAGE_GENERATION_UPDATE_FIELDS = [
  'enabled',
  'provider',
  'credentialMode',
  'model',
  'baseUrl',
  'quality',
  'size',
  'outputFormat',
  'apiKey',
] as const;

function assertKnownFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new CodesignError(
        `${context} contains unsupported field "${key}"`,
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
  }
}

function parseEnumField<T>(
  raw: unknown,
  field: string,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
): T | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') {
    throw new CodesignError(`${field} must be a string`, ERROR_CODES.IPC_BAD_INPUT);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new CodesignError(`Unsupported ${field}: ${raw}`, ERROR_CODES.IPC_BAD_INPUT);
  }
  return parsed.data;
}

function parseOptionalString(raw: unknown, field: string): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') {
    throw new CodesignError(`${field} must be a string`, ERROR_CODES.IPC_BAD_INPUT);
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new CodesignError(`${field} must be a non-empty string`, ERROR_CODES.IPC_BAD_INPUT);
  }
  return trimmed;
}

function parseOptionalHttpUrl(raw: unknown, field: string): string | undefined {
  const value = parseOptionalString(raw, field);
  if (value === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CodesignError(`${field} "${value}" is not a valid URL`, ERROR_CODES.IPC_BAD_INPUT);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CodesignError(
      `${field} must use http(s), got "${parsed.protocol}"`,
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  return value;
}

function isCredentialAvailabilityMiss(err: unknown): boolean {
  return (
    err instanceof CodesignError &&
    (err.code === ERROR_CODES.CONFIG_MISSING || err.code === ERROR_CODES.PROVIDER_KEY_MISSING)
  );
}

function hasInheritedImageCredential(provider: ImageGenerationProvider): boolean {
  try {
    getApiKeyForProvider(provider);
    return true;
  } catch (err) {
    if (isCredentialAvailabilityMiss(err)) return false;
    throw err;
  }
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
  const inheritedKeyAvailable = hasInheritedImageCredential(parsed.provider);
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
      throw new CodesignError(
        `Image generation is enabled but no custom API key is stored for "${parsed.provider}".`,
        ERROR_CODES.PROVIDER_KEY_MISSING,
      );
    }
    apiKey = decryptSecret(parsed.apiKey.ciphertext);
  } else {
    apiKey = getApiKeyForProvider(parsed.provider);
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
  return hasInheritedImageCredential(parsed.provider);
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

export function parseImageGenerationUpdate(raw: unknown): ImageGenerationUpdateInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError(
      'image-generation:v1:update expects an object',
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  const r = raw as Record<string, unknown>;
  assertKnownFields(r, IMAGE_GENERATION_UPDATE_FIELDS, 'image-generation:v1:update');
  const out: ImageGenerationUpdateInput = {};
  if (r['enabled'] !== undefined) {
    if (typeof r['enabled'] !== 'boolean') {
      throw new CodesignError('enabled must be a boolean', ERROR_CODES.IPC_BAD_INPUT);
    }
    out.enabled = r['enabled'];
  }
  const provider = parseEnumField(r['provider'], 'provider', ImageGenerationProviderSchema);
  if (provider !== undefined) out.provider = provider;
  const credentialMode = parseEnumField(
    r['credentialMode'],
    'credentialMode',
    ImageGenerationCredentialModeSchema,
  );
  if (credentialMode !== undefined) out.credentialMode = credentialMode;
  const model = parseOptionalString(r['model'], 'model');
  if (model !== undefined) out.model = model;
  const baseUrl = parseOptionalHttpUrl(r['baseUrl'], 'baseUrl');
  if (baseUrl !== undefined) out.baseUrl = baseUrl;
  const quality = parseEnumField(r['quality'], 'quality', ImageGenerationQualitySchema);
  if (quality !== undefined) out.quality = quality;
  const size = parseEnumField(r['size'], 'size', ImageGenerationSizeSchema);
  if (size !== undefined) out.size = size;
  const outputFormat = parseEnumField(
    r['outputFormat'],
    'outputFormat',
    ImageGenerationOutputFormatSchema,
  );
  if (outputFormat !== undefined) out.outputFormat = outputFormat;
  if (r['apiKey'] !== undefined) {
    if (typeof r['apiKey'] !== 'string') {
      throw new CodesignError('apiKey must be a string', ERROR_CODES.IPC_BAD_INPUT);
    }
    out.apiKey = r['apiKey'];
  }
  return out;
}

export async function updateImageGenerationSettings(
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
  if (providerChanged && apiKeyPatch === undefined && next.apiKey !== undefined) {
    const { apiKey: _providerScopedKey, ...rest } = next;
    next = rest;
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
    ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
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
      return updateImageGenerationSettings(parseImageGenerationUpdate(raw));
    },
  );
}
