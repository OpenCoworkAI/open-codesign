import { type ValidateResult, pingProvider } from '@open-codesign/providers';
import {
  CodesignError,
  type Config,
  type OnboardingState,
  StoredDesignSystem,
  type StoredDesignSystem as StoredDesignSystemValue,
  type SupportedOnboardingProvider,
  isSupportedOnboardingProvider,
} from '@open-codesign/shared';
import { readConfig, writeConfig } from './config';
import { ipcMain } from './electron-runtime';
import { decryptSecret, encryptSecret } from './keychain';

interface SaveKeyInput {
  provider: SupportedOnboardingProvider;
  apiKey: string;
  modelPrimary: string;
  modelFast: string;
  baseUrl?: string;
}

interface ValidateKeyInput {
  provider: SupportedOnboardingProvider;
  apiKey: string;
  baseUrl?: string;
}

let cachedConfig: Config | null = null;
let configLoaded = false;

export async function loadConfigOnBoot(): Promise<void> {
  cachedConfig = await readConfig();
  configLoaded = true;
}

export function getCachedConfig(): Config | null {
  if (!configLoaded) {
    throw new CodesignError('getCachedConfig called before loadConfigOnBoot', 'CONFIG_NOT_LOADED');
  }
  return cachedConfig;
}

export function getApiKeyForProvider(provider: string): string {
  const cfg = getCachedConfig();
  if (cfg === null) {
    throw new CodesignError('No configuration found. Complete onboarding first.', 'CONFIG_MISSING');
  }
  const ref = cfg.secrets[provider as keyof typeof cfg.secrets];
  if (ref === undefined) {
    throw new CodesignError(
      `No API key stored for provider "${provider}". Re-run onboarding to add one.`,
      'PROVIDER_KEY_MISSING',
    );
  }
  return decryptSecret(ref.ciphertext);
}

export function getBaseUrlForProvider(provider: string): string | undefined {
  const cfg = getCachedConfig();
  if (cfg === null) return undefined;
  const ref = cfg.baseUrls?.[provider as keyof typeof cfg.baseUrls];
  return ref?.baseUrl;
}

export function toState(cfg: Config | null): OnboardingState {
  if (cfg === null) {
    return {
      hasKey: false,
      provider: null,
      modelPrimary: null,
      modelFast: null,
      baseUrl: null,
      designSystem: null,
    };
  }
  if (!isSupportedOnboardingProvider(cfg.provider)) {
    return {
      hasKey: false,
      provider: null,
      modelPrimary: null,
      modelFast: null,
      baseUrl: null,
      designSystem: cfg.designSystem ?? null,
    };
  }
  const ref = cfg.secrets[cfg.provider];
  if (ref === undefined) {
    return {
      hasKey: false,
      provider: cfg.provider,
      modelPrimary: null,
      modelFast: null,
      baseUrl: null,
      designSystem: cfg.designSystem ?? null,
    };
  }
  return {
    hasKey: true,
    provider: cfg.provider,
    modelPrimary: cfg.modelPrimary,
    modelFast: cfg.modelFast,
    baseUrl: cfg.baseUrls?.[cfg.provider]?.baseUrl ?? null,
    designSystem: cfg.designSystem ?? null,
  };
}

export function getOnboardingState(): OnboardingState {
  return toState(getCachedConfig());
}

export async function setDesignSystem(
  designSystem: StoredDesignSystemValue | null,
): Promise<OnboardingState> {
  const cfg = getCachedConfig();
  if (cfg === null) {
    throw new CodesignError(
      'Cannot save a design system before onboarding has completed.',
      'CONFIG_MISSING',
    );
  }
  const next: Config = {
    ...cfg,
    ...(designSystem ? { designSystem: StoredDesignSystem.parse(designSystem) } : {}),
  };
  if (designSystem === null) {
    next.designSystem = undefined;
  }
  await writeConfig(next);
  cachedConfig = next;
  configLoaded = true;
  return toState(cachedConfig);
}

function parseSaveKey(raw: unknown): SaveKeyInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('save-key expects an object payload', 'IPC_BAD_INPUT');
  }
  const r = raw as Record<string, unknown>;
  const provider = r['provider'];
  const apiKey = r['apiKey'];
  const modelPrimary = r['modelPrimary'];
  const modelFast = r['modelFast'];
  const baseUrl = r['baseUrl'];
  if (typeof provider !== 'string' || !isSupportedOnboardingProvider(provider)) {
    throw new CodesignError(
      `Provider "${String(provider)}" is not supported in v0.1.`,
      'PROVIDER_NOT_SUPPORTED',
    );
  }
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new CodesignError('apiKey must be a non-empty string', 'IPC_BAD_INPUT');
  }
  if (typeof modelPrimary !== 'string' || modelPrimary.trim().length === 0) {
    throw new CodesignError('modelPrimary must be a non-empty string', 'IPC_BAD_INPUT');
  }
  if (typeof modelFast !== 'string' || modelFast.trim().length === 0) {
    throw new CodesignError('modelFast must be a non-empty string', 'IPC_BAD_INPUT');
  }
  const out: SaveKeyInput = { provider, apiKey, modelPrimary, modelFast };
  if (typeof baseUrl === 'string' && baseUrl.trim().length > 0) {
    try {
      new URL(baseUrl);
    } catch {
      throw new CodesignError(`baseUrl "${baseUrl}" is not a valid URL`, 'IPC_BAD_INPUT');
    }
    out.baseUrl = baseUrl.trim();
  }
  return out;
}

function parseValidateKey(raw: unknown): ValidateKeyInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('validate-key expects an object payload', 'IPC_BAD_INPUT');
  }
  const r = raw as Record<string, unknown>;
  const provider = r['provider'];
  const apiKey = r['apiKey'];
  const baseUrl = r['baseUrl'];
  if (typeof provider !== 'string') {
    throw new CodesignError('provider must be a string', 'IPC_BAD_INPUT');
  }
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new CodesignError('apiKey must be a non-empty string', 'IPC_BAD_INPUT');
  }
  if (!isSupportedOnboardingProvider(provider)) {
    throw new CodesignError(
      `Provider "${provider}" is not supported in v0.1. Only anthropic, openai, openrouter.`,
      'PROVIDER_NOT_SUPPORTED',
    );
  }
  const out: ValidateKeyInput = { provider, apiKey };
  if (typeof baseUrl === 'string' && baseUrl.length > 0) out.baseUrl = baseUrl;
  return out;
}

export function registerOnboardingIpc(): void {
  ipcMain.handle('onboarding:get-state', (): OnboardingState => toState(getCachedConfig()));

  ipcMain.handle('onboarding:validate-key', async (_e, raw: unknown): Promise<ValidateResult> => {
    const input = parseValidateKey(raw);
    return pingProvider(input.provider, input.apiKey, input.baseUrl);
  });

  ipcMain.handle('onboarding:save-key', async (_e, raw: unknown): Promise<OnboardingState> => {
    const input = parseSaveKey(raw);
    const ciphertext = encryptSecret(input.apiKey);
    const nextBaseUrls = { ...(cachedConfig?.baseUrls ?? {}) };
    if (input.baseUrl !== undefined) {
      nextBaseUrls[input.provider] = { baseUrl: input.baseUrl };
    } else {
      delete nextBaseUrls[input.provider];
    }
    const next: Config = {
      version: 1,
      provider: input.provider,
      modelPrimary: input.modelPrimary,
      modelFast: input.modelFast,
      secrets: {
        ...(cachedConfig?.secrets ?? {}),
        [input.provider]: { ciphertext },
      },
      baseUrls: nextBaseUrls,
      ...(cachedConfig?.designSystem ? { designSystem: cachedConfig.designSystem } : {}),
    };
    await writeConfig(next);
    cachedConfig = next;
    configLoaded = true;
    return toState(cachedConfig);
  });

  ipcMain.handle('onboarding:skip', async (): Promise<OnboardingState> => {
    return toState(cachedConfig);
  });
}
