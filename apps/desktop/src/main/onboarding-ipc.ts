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
import { configDir, configPath, readConfig, writeConfig } from './config';
import { ipcMain, shell } from './electron-runtime';
import { decryptSecret, encryptSecret } from './keychain';
import { getLogPath, getLogger } from './logger';
import {
  type ProviderRow,
  assertProviderHasStoredSecret,
  computeDeleteProviderResult,
  getAddProviderDefaults,
  toProviderRows,
} from './provider-settings';
import { buildAppPaths } from './storage-settings';

const logger = getLogger('settings-ipc');

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

export type { ProviderRow } from './provider-settings';

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

function toState(cfg: Config | null): OnboardingState {
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

// ── Settings handler implementations (shared by v1 and legacy channels) ───────

function runListProviders(): ProviderRow[] {
  return toProviderRows(getCachedConfig(), decryptSecret);
}

async function runAddProvider(raw: unknown): Promise<ProviderRow[]> {
  const input = parseSaveKey(raw);
  const ciphertext = encryptSecret(input.apiKey);
  const nextBaseUrls = { ...(cachedConfig?.baseUrls ?? {}) };
  if (input.baseUrl !== undefined) {
    nextBaseUrls[input.provider] = { baseUrl: input.baseUrl };
  } else {
    delete nextBaseUrls[input.provider];
  }
  const nextDefaults = getAddProviderDefaults(cachedConfig, input);
  const next: Config = {
    version: 1,
    provider: nextDefaults.activeProvider,
    modelPrimary: nextDefaults.modelPrimary,
    modelFast: nextDefaults.modelFast,
    secrets: {
      ...(cachedConfig?.secrets ?? {}),
      [input.provider]: { ciphertext },
    },
    baseUrls: nextBaseUrls,
  };
  await writeConfig(next);
  cachedConfig = next;
  return toProviderRows(cachedConfig, decryptSecret);
}

async function runDeleteProvider(raw: unknown): Promise<ProviderRow[]> {
  if (typeof raw !== 'string' || !isSupportedOnboardingProvider(raw)) {
    throw new CodesignError('delete-provider expects a provider string', 'IPC_BAD_INPUT');
  }
  const cfg = getCachedConfig();
  if (cfg === null) return [];
  const nextSecrets = { ...cfg.secrets };
  delete nextSecrets[raw];
  const nextBaseUrls = { ...(cfg.baseUrls ?? {}) };
  delete nextBaseUrls[raw];

  const { nextActive, modelPrimary, modelFast } = computeDeleteProviderResult(cfg, raw);

  if (nextActive === null) {
    // No providers left — write a tombstone config so onboarding triggers again.
    const emptyNext: Config = {
      version: 1,
      provider: cfg.provider,
      modelPrimary: '',
      modelFast: '',
      secrets: {},
      baseUrls: {},
    };
    await writeConfig(emptyNext);
    cachedConfig = emptyNext;
    return toProviderRows(cachedConfig, decryptSecret);
  }

  const next: Config = {
    version: 1,
    provider: nextActive,
    modelPrimary,
    modelFast,
    secrets: nextSecrets,
    baseUrls: nextBaseUrls,
  };
  await writeConfig(next);
  cachedConfig = next;
  return toProviderRows(cachedConfig, decryptSecret);
}

async function runSetActiveProvider(raw: unknown): Promise<OnboardingState> {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('set-active-provider expects an object', 'IPC_BAD_INPUT');
  }
  const r = raw as Record<string, unknown>;
  const provider = r['provider'];
  const modelPrimary = r['modelPrimary'];
  const modelFast = r['modelFast'];
  if (typeof provider !== 'string' || !isSupportedOnboardingProvider(provider)) {
    throw new CodesignError('provider must be a supported provider string', 'IPC_BAD_INPUT');
  }
  if (typeof modelPrimary !== 'string' || modelPrimary.trim().length === 0) {
    throw new CodesignError('modelPrimary must be a non-empty string', 'IPC_BAD_INPUT');
  }
  if (typeof modelFast !== 'string' || modelFast.trim().length === 0) {
    throw new CodesignError('modelFast must be a non-empty string', 'IPC_BAD_INPUT');
  }
  const cfg = getCachedConfig();
  if (cfg === null) {
    throw new CodesignError('No configuration found', 'CONFIG_MISSING');
  }
  assertProviderHasStoredSecret(cfg, provider);
  const next: Config = {
    ...cfg,
    provider,
    modelPrimary,
    modelFast,
  };
  await writeConfig(next);
  cachedConfig = next;
  return toState(cachedConfig);
}

function runGetPaths() {
  return buildAppPaths(configPath(), getLogPath(), configDir());
}

async function runOpenFolder(raw: unknown): Promise<void> {
  if (typeof raw !== 'string') {
    throw new CodesignError('open-folder expects a path string', 'IPC_BAD_INPUT');
  }
  const error = await shell.openPath(raw);
  if (error) {
    throw new CodesignError(`Could not open ${raw}: ${error}`, 'OPEN_PATH_FAILED');
  }
}

async function runResetOnboarding(): Promise<void> {
  const cfg = getCachedConfig();
  if (cfg === null) return;
  // Clear secrets so onboarding flow triggers again on next load.
  const next: Config = {
    ...cfg,
    secrets: {},
  };
  await writeConfig(next);
  cachedConfig = next;
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
    };
    await writeConfig(next);
    cachedConfig = next;
    configLoaded = true;
    return toState(cachedConfig);
  });

  ipcMain.handle('onboarding:skip', async (): Promise<OnboardingState> => {
    return toState(cachedConfig);
  });

  // ── Settings v1 channels ────────────────────────────────────────────────────

  ipcMain.handle('settings:v1:list-providers', (): ProviderRow[] => runListProviders());

  ipcMain.handle(
    'settings:v1:add-provider',
    async (_e, raw: unknown): Promise<ProviderRow[]> => runAddProvider(raw),
  );

  ipcMain.handle(
    'settings:v1:delete-provider',
    async (_e, raw: unknown): Promise<ProviderRow[]> => runDeleteProvider(raw),
  );

  ipcMain.handle(
    'settings:v1:set-active-provider',
    async (_e, raw: unknown): Promise<OnboardingState> => runSetActiveProvider(raw),
  );

  ipcMain.handle('settings:v1:get-paths', () => runGetPaths());

  ipcMain.handle(
    'settings:v1:open-folder',
    async (_e, raw: unknown): Promise<void> => runOpenFolder(raw),
  );

  ipcMain.handle('settings:v1:reset-onboarding', async (): Promise<void> => runResetOnboarding());

  ipcMain.handle('settings:v1:toggle-devtools', (_e) => {
    _e.sender.toggleDevTools();
  });

  // ── Settings legacy shims (schedule removal next minor) ────────────────────

  ipcMain.handle('settings:list-providers', (): ProviderRow[] => {
    logger.warn('legacy settings:list-providers channel used, schedule removal next minor');
    return runListProviders();
  });

  ipcMain.handle('settings:add-provider', async (_e, raw: unknown): Promise<ProviderRow[]> => {
    logger.warn('legacy settings:add-provider channel used, schedule removal next minor');
    return runAddProvider(raw);
  });

  ipcMain.handle('settings:delete-provider', async (_e, raw: unknown): Promise<ProviderRow[]> => {
    logger.warn('legacy settings:delete-provider channel used, schedule removal next minor');
    return runDeleteProvider(raw);
  });

  ipcMain.handle(
    'settings:set-active-provider',
    async (_e, raw: unknown): Promise<OnboardingState> => {
      logger.warn('legacy settings:set-active-provider channel used, schedule removal next minor');
      return runSetActiveProvider(raw);
    },
  );

  ipcMain.handle('settings:get-paths', () => {
    logger.warn('legacy settings:get-paths channel used, schedule removal next minor');
    return runGetPaths();
  });

  ipcMain.handle('settings:open-folder', async (_e, raw: unknown) => {
    logger.warn('legacy settings:open-folder channel used, schedule removal next minor');
    return runOpenFolder(raw);
  });

  ipcMain.handle('settings:reset-onboarding', async (): Promise<void> => {
    logger.warn('legacy settings:reset-onboarding channel used, schedule removal next minor');
    return runResetOnboarding();
  });

  ipcMain.handle('settings:toggle-devtools', (_e) => {
    logger.warn('legacy settings:toggle-devtools channel used, schedule removal next minor');
    _e.sender.toggleDevTools();
  });
}
