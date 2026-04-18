import { type ValidateResult, pingProvider } from '@open-codesign/providers';
import {
  CodesignError,
  type Config,
  type OnboardingState,
  type SupportedOnboardingProvider,
  isSupportedOnboardingProvider,
} from '@open-codesign/shared';
import { ipcMain } from 'electron';
import { readConfig, writeConfig } from './config';
import { decryptSecret, encryptSecret } from './keychain';

interface SaveKeyInput {
  provider: SupportedOnboardingProvider;
  apiKey: string;
  modelPrimary: string;
  modelFast: string;
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

function toState(cfg: Config | null): OnboardingState {
  if (cfg === null) {
    return { hasKey: false, provider: null, modelPrimary: null, modelFast: null };
  }
  if (!isSupportedOnboardingProvider(cfg.provider)) {
    return { hasKey: false, provider: null, modelPrimary: null, modelFast: null };
  }
  const ref = cfg.secrets[cfg.provider];
  if (ref === undefined) {
    return { hasKey: false, provider: cfg.provider, modelPrimary: null, modelFast: null };
  }
  return {
    hasKey: true,
    provider: cfg.provider,
    modelPrimary: cfg.modelPrimary,
    modelFast: cfg.modelFast,
  };
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
  return { provider, apiKey, modelPrimary, modelFast };
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
    const next: Config = {
      version: 1,
      provider: input.provider,
      modelPrimary: input.modelPrimary,
      modelFast: input.modelFast,
      secrets: {
        ...(cachedConfig?.secrets ?? {}),
        [input.provider]: { ciphertext },
      },
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
