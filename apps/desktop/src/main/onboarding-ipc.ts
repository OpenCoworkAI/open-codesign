import { type ValidateResult, pingProvider } from '@open-codesign/providers';
import {
  BUILTIN_PROVIDERS,
  CodesignError,
  type Config,
  type OnboardingState,
  type ProviderEntry,
  StoredDesignSystem,
  type StoredDesignSystem as StoredDesignSystemValue,
  type SupportedOnboardingProvider,
  type WireApi,
  WireApiSchema,
  detectWireFromBaseUrl,
  hydrateConfig,
  isSupportedOnboardingProvider,
} from '@open-codesign/shared';
import { configDir, configPath, readConfig, writeConfig } from './config';
import { ipcMain, shell } from './electron-runtime';
import { type ClaudeCodeImport, readClaudeCodeSettings } from './imports/claude-code-config';
import { type CodexImport, readCodexConfig } from './imports/codex-config';
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
  provider: string;
  apiKey: string;
  modelPrimary: string;
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
  return cfg.providers[provider]?.baseUrl;
}

function toState(cfg: Config | null): OnboardingState {
  if (cfg === null) {
    return {
      hasKey: false,
      provider: null,
      modelPrimary: null,
      baseUrl: null,
      designSystem: null,
    };
  }
  const active = cfg.activeProvider;
  const ref = cfg.secrets[active];
  if (ref === undefined) {
    return {
      hasKey: false,
      provider: active,
      modelPrimary: null,
      baseUrl: null,
      designSystem: cfg.designSystem ?? null,
    };
  }
  return {
    hasKey: true,
    provider: active,
    modelPrimary: cfg.activeModel,
    baseUrl: cfg.providers[active]?.baseUrl ?? null,
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
  const next: Config = hydrateConfig({
    version: 3,
    activeProvider: cfg.activeProvider,
    activeModel: cfg.activeModel,
    secrets: cfg.secrets,
    providers: cfg.providers,
    ...(designSystem !== null ? { designSystem: StoredDesignSystem.parse(designSystem) } : {}),
  });
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
  const baseUrl = r['baseUrl'];
  if (typeof provider !== 'string' || provider.trim().length === 0) {
    throw new CodesignError(`Provider "${String(provider)}" is invalid.`, 'IPC_BAD_INPUT');
  }
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new CodesignError('apiKey must be a non-empty string', 'IPC_BAD_INPUT');
  }
  if (typeof modelPrimary !== 'string' || modelPrimary.trim().length === 0) {
    throw new CodesignError('modelPrimary must be a non-empty string', 'IPC_BAD_INPUT');
  }
  const out: SaveKeyInput = { provider, apiKey, modelPrimary };
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

interface SetProviderAndModelsInput extends SaveKeyInput {
  setAsActive: boolean;
}

function parseSetProviderAndModels(raw: unknown): SetProviderAndModelsInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('set-provider-and-models expects an object payload', 'IPC_BAD_INPUT');
  }
  const r = raw as Record<string, unknown>;
  const sv = r['schemaVersion'];
  if (sv !== undefined && sv !== 1) {
    throw new CodesignError(
      `Unsupported schemaVersion ${String(sv)} (expected 1)`,
      'IPC_BAD_INPUT',
    );
  }
  const setAsActive = r['setAsActive'];
  if (typeof setAsActive !== 'boolean') {
    throw new CodesignError('setAsActive must be a boolean', 'IPC_BAD_INPUT');
  }
  return { ...parseSaveKey(raw), setAsActive };
}

/**
 * Canonical "add or update a provider" mutation. Atomic: writes secret +
 * baseUrl + (optionally) flips active provider in a single writeConfig.
 *
 * Returns the full OnboardingState so renderer can hydrate Zustand without a
 * follow-up read — that store-sync gap is what made TopBar drift out of date
 * after Settings mutations.
 */
async function runSetProviderAndModels(input: SetProviderAndModelsInput): Promise<OnboardingState> {
  const ciphertext = encryptSecret(input.apiKey);
  const nextProviders: Record<string, ProviderEntry> = { ...(cachedConfig?.providers ?? {}) };
  const existing = nextProviders[input.provider];
  const builtin = BUILTIN_PROVIDERS[input.provider as SupportedOnboardingProvider];
  const seed: ProviderEntry = existing ??
    builtin ?? {
      id: input.provider,
      name: input.provider,
      builtin: false,
      wire: 'openai-chat',
      baseUrl: input.baseUrl ?? 'https://api.openai.com/v1',
      defaultModel: input.modelPrimary,
    };
  nextProviders[input.provider] = {
    ...seed,
    baseUrl: input.baseUrl ?? seed.baseUrl,
    defaultModel: input.modelPrimary || seed.defaultModel,
  };
  const nextSecrets = {
    ...(cachedConfig?.secrets ?? {}),
    [input.provider]: { ciphertext },
  };
  const activate = input.setAsActive || cachedConfig === null;
  const nextActiveProvider = activate
    ? input.provider
    : (cachedConfig?.activeProvider ?? input.provider);
  const nextActiveModel = activate
    ? input.modelPrimary
    : (cachedConfig?.activeModel ?? input.modelPrimary);
  const next: Config = hydrateConfig({
    version: 3,
    activeProvider: nextActiveProvider,
    activeModel: nextActiveModel,
    secrets: nextSecrets,
    providers: nextProviders,
    ...(cachedConfig?.designSystem !== undefined
      ? { designSystem: cachedConfig.designSystem }
      : {}),
  });
  await writeConfig(next);
  cachedConfig = next;
  configLoaded = true;
  return toState(cachedConfig);
}

async function runAddProvider(raw: unknown): Promise<ProviderRow[]> {
  const input = parseSaveKey(raw);
  const defaults = getAddProviderDefaults(cachedConfig, input);
  await runSetProviderAndModels({
    ...input,
    setAsActive: defaults.activeProvider === input.provider,
    modelPrimary: defaults.modelPrimary,
  });
  return toProviderRows(cachedConfig, decryptSecret);
}

async function runDeleteProvider(raw: unknown): Promise<ProviderRow[]> {
  if (typeof raw !== 'string') {
    throw new CodesignError('delete-provider expects a provider string', 'IPC_BAD_INPUT');
  }
  const cfg = getCachedConfig();
  if (cfg === null) return [];
  const nextSecrets = { ...cfg.secrets };
  delete nextSecrets[raw];
  const nextProviders: Record<string, ProviderEntry> = { ...cfg.providers };
  // Custom providers are fully removed from the providers map. Builtins stay
  // (so the user can re-add a key without losing wire/baseUrl defaults) but
  // their secret is cleared above.
  if (nextProviders[raw]?.builtin !== true) {
    delete nextProviders[raw];
  }

  const { nextActive, modelPrimary } = computeDeleteProviderResult(cfg, raw);

  if (nextActive === null) {
    const emptyNext: Config = hydrateConfig({
      version: 3,
      activeProvider: cfg.activeProvider,
      activeModel: '',
      secrets: {},
      providers: nextProviders,
      ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
    });
    await writeConfig(emptyNext);
    cachedConfig = emptyNext;
    return toProviderRows(cachedConfig, decryptSecret);
  }

  const next: Config = hydrateConfig({
    version: 3,
    activeProvider: nextActive,
    activeModel: modelPrimary,
    secrets: nextSecrets,
    providers: nextProviders,
    ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
  });
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
  if (typeof provider !== 'string' || provider.length === 0) {
    throw new CodesignError('provider must be a non-empty string', 'IPC_BAD_INPUT');
  }
  if (typeof modelPrimary !== 'string' || modelPrimary.trim().length === 0) {
    throw new CodesignError('modelPrimary must be a non-empty string', 'IPC_BAD_INPUT');
  }
  const cfg = getCachedConfig();
  if (cfg === null) {
    throw new CodesignError('No configuration found', 'CONFIG_MISSING');
  }
  assertProviderHasStoredSecret(cfg, provider);
  const next: Config = hydrateConfig({
    version: 3,
    activeProvider: provider,
    activeModel: modelPrimary,
    secrets: cfg.secrets,
    providers: cfg.providers,
    ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
  });
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
  const next: Config = hydrateConfig({
    version: 3,
    activeProvider: cfg.activeProvider,
    activeModel: cfg.activeModel,
    secrets: {},
    providers: cfg.providers,
    ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
  });
  await writeConfig(next);
  cachedConfig = next;
}

// ── v3 custom provider helpers ────────────────────────────────────────────

interface AddCustomProviderInput {
  id: string;
  name: string;
  wire: WireApi;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  httpHeaders?: Record<string, string>;
  queryParams?: Record<string, string>;
  envKey?: string;
  setAsActive: boolean;
}

function parseAddProviderPayload(raw: unknown): AddCustomProviderInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('config:v1:add-provider expects an object', 'IPC_BAD_INPUT');
  }
  const r = raw as Record<string, unknown>;
  const id = r['id'];
  const name = r['name'];
  const wire = r['wire'];
  const baseUrl = r['baseUrl'];
  const apiKey = r['apiKey'];
  const defaultModel = r['defaultModel'];
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new CodesignError('id must be a non-empty string', 'IPC_BAD_INPUT');
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new CodesignError('name must be a non-empty string', 'IPC_BAD_INPUT');
  }
  const parsedWire = WireApiSchema.safeParse(wire);
  if (!parsedWire.success) {
    throw new CodesignError(`Unsupported wire: ${String(wire)}`, 'IPC_BAD_INPUT');
  }
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
    throw new CodesignError('baseUrl must be a non-empty string', 'IPC_BAD_INPUT');
  }
  try {
    new URL(baseUrl);
  } catch {
    throw new CodesignError(`baseUrl "${baseUrl}" is not a valid URL`, 'IPC_BAD_INPUT');
  }
  if (typeof apiKey !== 'string') {
    throw new CodesignError('apiKey must be a string', 'IPC_BAD_INPUT');
  }
  if (typeof defaultModel !== 'string' || defaultModel.trim().length === 0) {
    throw new CodesignError('defaultModel must be a non-empty string', 'IPC_BAD_INPUT');
  }
  const setAsActive = r['setAsActive'];
  const out: AddCustomProviderInput = {
    id: id.trim(),
    name: name.trim(),
    wire: parsedWire.data,
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim(),
    defaultModel: defaultModel.trim(),
    setAsActive: setAsActive === true,
  };
  const headers = r['httpHeaders'];
  if (headers !== undefined && headers !== null && typeof headers === 'object') {
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      if (typeof v === 'string') map[k] = v;
    }
    if (Object.keys(map).length > 0) out.httpHeaders = map;
  }
  const qp = r['queryParams'];
  if (qp !== undefined && qp !== null && typeof qp === 'object') {
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(qp as Record<string, unknown>)) {
      if (typeof v === 'string') map[k] = v;
    }
    if (Object.keys(map).length > 0) out.queryParams = map;
  }
  if (typeof r['envKey'] === 'string' && (r['envKey'] as string).length > 0) {
    out.envKey = r['envKey'] as string;
  }
  return out;
}

async function runAddCustomProvider(input: AddCustomProviderInput): Promise<OnboardingState> {
  const entry: ProviderEntry = {
    id: input.id,
    name: input.name,
    builtin: false,
    wire: input.wire,
    baseUrl: input.baseUrl,
    defaultModel: input.defaultModel,
    ...(input.httpHeaders !== undefined ? { httpHeaders: input.httpHeaders } : {}),
    ...(input.queryParams !== undefined ? { queryParams: input.queryParams } : {}),
    ...(input.envKey !== undefined ? { envKey: input.envKey } : {}),
  };
  const ciphertext = encryptSecret(input.apiKey);
  const nextProviders = { ...(cachedConfig?.providers ?? {}), [entry.id]: entry };
  const nextSecrets = { ...(cachedConfig?.secrets ?? {}), [entry.id]: { ciphertext } };
  const shouldActivate = input.setAsActive || cachedConfig === null;
  const next = hydrateConfig({
    version: 3,
    activeProvider: shouldActivate ? entry.id : (cachedConfig?.activeProvider ?? entry.id),
    activeModel: shouldActivate
      ? input.defaultModel
      : (cachedConfig?.activeModel ?? input.defaultModel),
    secrets: nextSecrets,
    providers: nextProviders,
    ...(cachedConfig?.designSystem !== undefined
      ? { designSystem: cachedConfig.designSystem }
      : {}),
  });
  await writeConfig(next);
  cachedConfig = next;
  configLoaded = true;
  return toState(cachedConfig);
}

interface UpdateProviderInput {
  id: string;
  name?: string;
  baseUrl?: string;
  defaultModel?: string;
  httpHeaders?: Record<string, string>;
  queryParams?: Record<string, string>;
  wire?: WireApi;
}

function parseUpdateProviderPayload(raw: unknown): UpdateProviderInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('config:v1:update-provider expects an object', 'IPC_BAD_INPUT');
  }
  const r = raw as Record<string, unknown>;
  const id = r['id'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new CodesignError('id must be a non-empty string', 'IPC_BAD_INPUT');
  }
  const out: UpdateProviderInput = { id };
  if (typeof r['name'] === 'string') out.name = r['name'] as string;
  if (typeof r['baseUrl'] === 'string') out.baseUrl = r['baseUrl'] as string;
  if (typeof r['defaultModel'] === 'string') out.defaultModel = r['defaultModel'] as string;
  if (
    r['httpHeaders'] !== undefined &&
    typeof r['httpHeaders'] === 'object' &&
    r['httpHeaders'] !== null
  ) {
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(r['httpHeaders'] as Record<string, unknown>)) {
      if (typeof v === 'string') map[k] = v;
    }
    out.httpHeaders = map;
  }
  if (
    r['queryParams'] !== undefined &&
    typeof r['queryParams'] === 'object' &&
    r['queryParams'] !== null
  ) {
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(r['queryParams'] as Record<string, unknown>)) {
      if (typeof v === 'string') map[k] = v;
    }
    out.queryParams = map;
  }
  if (typeof r['wire'] === 'string') {
    const parsedWire = WireApiSchema.safeParse(r['wire']);
    if (parsedWire.success) out.wire = parsedWire.data;
  }
  return out;
}

async function runUpdateProvider(input: UpdateProviderInput): Promise<OnboardingState> {
  const cfg = getCachedConfig();
  if (cfg === null) {
    throw new CodesignError('No configuration found', 'CONFIG_MISSING');
  }
  const existing = cfg.providers[input.id];
  if (existing === undefined) {
    throw new CodesignError(`Provider "${input.id}" not found`, 'IPC_BAD_INPUT');
  }
  const updated: ProviderEntry = {
    ...existing,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
    ...(input.defaultModel !== undefined ? { defaultModel: input.defaultModel } : {}),
    ...(input.httpHeaders !== undefined ? { httpHeaders: input.httpHeaders } : {}),
    ...(input.queryParams !== undefined ? { queryParams: input.queryParams } : {}),
    ...(input.wire !== undefined ? { wire: input.wire } : {}),
  };
  const next = hydrateConfig({
    version: 3,
    activeProvider: cfg.activeProvider,
    activeModel: cfg.activeModel,
    secrets: cfg.secrets,
    providers: { ...cfg.providers, [input.id]: updated },
    ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
  });
  await writeConfig(next);
  cachedConfig = next;
  return toState(cachedConfig);
}

interface ExternalConfigsDetection {
  codex?: CodexImport;
  claudeCode?: ClaudeCodeImport;
}

async function runImportCodex(imported: CodexImport): Promise<OnboardingState> {
  if (imported.providers.length === 0) {
    throw new CodesignError('Codex config has no providers to bring in', 'CONFIG_MISSING');
  }
  const nextProviders: Record<string, ProviderEntry> = { ...(cachedConfig?.providers ?? {}) };
  const nextSecrets = { ...(cachedConfig?.secrets ?? {}) };
  // Seed builtins if we're on a fresh install so the user keeps a fallback.
  if (cachedConfig === null) {
    for (const [id, entry] of Object.entries(BUILTIN_PROVIDERS)) {
      if (nextProviders[id] === undefined) nextProviders[id] = { ...entry };
    }
  }
  for (const entry of imported.providers) {
    nextProviders[entry.id] = entry;
    if (entry.envKey !== undefined) {
      const envValue = process.env[entry.envKey];
      if (envValue !== undefined && envValue.length > 0) {
        nextSecrets[entry.id] = { ciphertext: encryptSecret(envValue) };
      } else if (nextSecrets[entry.id] === undefined) {
        // env var not exported — store empty key so the provider is
        // usable for keyless endpoints (IP-whitelisted proxies).
        nextSecrets[entry.id] = { ciphertext: encryptSecret('') };
      }
    } else if (nextSecrets[entry.id] === undefined) {
      // No env_key at all — likely a keyless proxy.
      nextSecrets[entry.id] = { ciphertext: encryptSecret('') };
    }
  }
  const fallbackActive = imported.providers[0];
  if (fallbackActive === undefined) {
    throw new CodesignError('Codex config parse produced no providers', 'CONFIG_MISSING');
  }
  const activeProvider =
    imported.activeProvider !== null && nextProviders[imported.activeProvider] !== undefined
      ? imported.activeProvider
      : fallbackActive.id;
  const activeModel = imported.activeModel ?? nextProviders[activeProvider]?.defaultModel ?? '';
  const next = hydrateConfig({
    version: 3,
    activeProvider,
    activeModel,
    secrets: nextSecrets,
    providers: nextProviders,
    ...(cachedConfig?.designSystem !== undefined
      ? { designSystem: cachedConfig.designSystem }
      : {}),
  });
  await writeConfig(next);
  cachedConfig = next;
  configLoaded = true;
  return toState(cachedConfig);
}

async function runImportClaudeCode(imported: ClaudeCodeImport): Promise<OnboardingState> {
  if (imported.provider === null) {
    throw new CodesignError('Claude Code config produced no provider', 'CONFIG_MISSING');
  }
  const nextProviders: Record<string, ProviderEntry> = { ...(cachedConfig?.providers ?? {}) };
  const nextSecrets = { ...(cachedConfig?.secrets ?? {}) };
  if (cachedConfig === null) {
    for (const [id, entry] of Object.entries(BUILTIN_PROVIDERS)) {
      if (nextProviders[id] === undefined) nextProviders[id] = { ...entry };
    }
  }
  nextProviders[imported.provider.id] = imported.provider;
  if (imported.apiKey !== null) {
    nextSecrets[imported.provider.id] = { ciphertext: encryptSecret(imported.apiKey) };
  }
  const next = hydrateConfig({
    version: 3,
    activeProvider: imported.provider.id,
    activeModel: imported.activeModel ?? imported.provider.defaultModel,
    secrets: nextSecrets,
    providers: nextProviders,
    ...(cachedConfig?.designSystem !== undefined
      ? { designSystem: cachedConfig.designSystem }
      : {}),
  });
  await writeConfig(next);
  cachedConfig = next;
  configLoaded = true;
  return toState(cachedConfig);
}

interface ListEndpointModelsResponse {
  ok: boolean;
  models?: string[];
  error?: string;
}

async function runListEndpointModels(raw: unknown): Promise<ListEndpointModelsResponse> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'expected an object payload' };
  }
  const r = raw as Record<string, unknown>;
  const wireRaw = r['wire'];
  const baseUrl = r['baseUrl'];
  const apiKey = r['apiKey'];
  const parsedWire = WireApiSchema.safeParse(wireRaw);
  if (!parsedWire.success) return { ok: false, error: `unsupported wire: ${String(wireRaw)}` };
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
    return { ok: false, error: 'baseUrl required' };
  }
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    return { ok: false, error: 'apiKey required' };
  }
  const cleaned = baseUrl.replace(/\/+$/, '');
  const url =
    parsedWire.data === 'anthropic'
      ? `${cleaned.replace(/\/v1$/, '')}/v1/models`
      : `${cleaned.endsWith('/v1') ? cleaned : `${cleaned}/v1`}/models`;
  const headers: Record<string, string> =
    parsedWire.data === 'anthropic'
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { authorization: `Bearer ${apiKey}` };
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = (await res.json()) as Record<string, unknown>;
    const data = body['data'] ?? body['models'];
    if (!Array.isArray(data)) return { ok: false, error: 'unexpected response shape' };
    const ids = data
      .filter(
        (it) =>
          typeof it === 'object' && it !== null && typeof (it as { id?: unknown }).id === 'string',
      )
      .map((it) => (it as { id: string }).id);
    return { ok: true, models: ids };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function registerOnboardingIpc(): void {
  ipcMain.handle('onboarding:get-state', (): OnboardingState => toState(getCachedConfig()));

  ipcMain.handle('onboarding:validate-key', async (_e, raw: unknown): Promise<ValidateResult> => {
    const input = parseValidateKey(raw);
    return pingProvider(input.provider, input.apiKey, input.baseUrl);
  });

  ipcMain.handle('onboarding:save-key', async (_e, raw: unknown): Promise<OnboardingState> => {
    // Onboarding always activates the provider it just saved — that's the
    // whole point of the first-time flow. Delegated to the canonical handler
    // so behavior matches Settings exactly.
    return runSetProviderAndModels({ ...parseSaveKey(raw), setAsActive: true });
  });

  ipcMain.handle('onboarding:skip', async (): Promise<OnboardingState> => {
    return toState(cachedConfig);
  });

  // ── Canonical config mutation (preferred entry point) ─────────────────────

  ipcMain.handle(
    'config:v1:set-provider-and-models',
    async (_e, raw: unknown): Promise<OnboardingState> => {
      return runSetProviderAndModels(parseSetProviderAndModels(raw));
    },
  );

  // ── v3 custom provider IPC surface ────────────────────────────────────────

  ipcMain.handle('config:v1:add-provider', async (_e, raw: unknown): Promise<OnboardingState> => {
    return runAddCustomProvider(parseAddProviderPayload(raw));
  });

  ipcMain.handle(
    'config:v1:update-provider',
    async (_e, raw: unknown): Promise<OnboardingState> => {
      return runUpdateProvider(parseUpdateProviderPayload(raw));
    },
  );

  ipcMain.handle(
    'config:v1:remove-provider',
    async (_e, raw: unknown): Promise<OnboardingState> => {
      if (typeof raw !== 'string' || raw.length === 0) {
        throw new CodesignError('config:v1:remove-provider expects a provider id', 'IPC_BAD_INPUT');
      }
      await runDeleteProvider(raw);
      return toState(cachedConfig);
    },
  );

  ipcMain.handle(
    'config:v1:set-active-provider-and-model',
    async (_e, raw: unknown): Promise<OnboardingState> => {
      return runSetActiveProvider(raw);
    },
  );

  ipcMain.handle(
    'config:v1:detect-external-configs',
    async (): Promise<ExternalConfigsDetection> => {
      const [codex, claudeCode] = await Promise.all([
        readCodexConfig().catch(() => null),
        readClaudeCodeSettings().catch(() => null),
      ]);
      const providerIds = Object.keys(cachedConfig?.providers ?? {});
      const alreadyHasCodex = providerIds.some((id) => id.startsWith('codex-'));
      const alreadyHasClaudeCode = providerIds.includes('claude-code-imported');
      const out: ExternalConfigsDetection = {};
      if (codex !== null && codex.providers.length > 0 && !alreadyHasCodex) out.codex = codex;
      if (
        claudeCode !== null &&
        claudeCode.provider !== null &&
        !alreadyHasClaudeCode
      )
        out.claudeCode = claudeCode;
      return out;
    },
  );

  ipcMain.handle('config:v1:import-codex-config', async (): Promise<OnboardingState> => {
    const imported = await readCodexConfig();
    if (imported === null) {
      throw new CodesignError('No Codex config found at ~/.codex/config.toml', 'CONFIG_MISSING');
    }
    return runImportCodex(imported);
  });

  ipcMain.handle('config:v1:import-claude-code-config', async (): Promise<OnboardingState> => {
    const imported = await readClaudeCodeSettings();
    if (imported === null || imported.provider === null) {
      throw new CodesignError(
        'No Claude Code settings found at ~/.claude/settings.json',
        'CONFIG_MISSING',
      );
    }
    return runImportClaudeCode(imported);
  });

  ipcMain.handle('config:v1:list-endpoint-models', async (_e, raw: unknown) => {
    return runListEndpointModels(raw);
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
