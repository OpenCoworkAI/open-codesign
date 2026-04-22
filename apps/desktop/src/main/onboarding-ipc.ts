import { readFile } from 'node:fs/promises';
import { type ValidateResult, pingProvider } from '@open-codesign/providers';
import {
  BUILTIN_PROVIDERS,
  type ClaudeCodeDetectionMeta,
  CodesignError,
  type CodexDetectionMeta,
  type Config,
  ERROR_CODES,
  type ExternalConfigsDetection,
  type GeminiDetectionMeta,
  type OnboardingState,
  type OpencodeDetectionMeta,
  type ProviderEntry,
  type ReasoningLevel,
  ReasoningLevelSchema,
  StoredDesignSystem,
  type StoredDesignSystem as StoredDesignSystemValue,
  type SupportedOnboardingProvider,
  type WireApi,
  WireApiSchema,
  hydrateConfig,
  isSupportedOnboardingProvider,
  modelsEndpointUrl,
} from '@open-codesign/shared';
import { buildAuthHeadersForWire } from './auth-headers';
import { defaultConfigDir, readConfig, writeConfig } from './config';
import { dialog, ipcMain, shell } from './electron-runtime';
import { type ClaudeCodeImport, readClaudeCodeSettings } from './imports/claude-code-config';
import {
  ALLOWED_IMPORT_ENV_KEYS,
  type CodexImport,
  codexAuthPath,
  readCodexConfig,
} from './imports/codex-config';
import { type GeminiImport, readGeminiCliConfig } from './imports/gemini-cli-config';
import { type OpencodeImport, readOpencodeConfig } from './imports/opencode-config';
import { buildSecretRef, decryptSecret, migrateSecrets } from './keychain';
import { defaultLogsDir, getLogger } from './logger';
import {
  type ProviderRow,
  assertProviderHasStoredSecret,
  computeDeleteProviderResult,
  getAddProviderDefaults,
  isKeylessProviderAllowed,
  toProviderRows,
} from './provider-settings';
import {
  type AppPaths,
  type StorageKind,
  buildAppPathsForLocations,
  getDefaultUserDataDir,
  patchForStorageKind,
  readPersistedStorageLocations,
  writeStorageLocations,
} from './storage-settings';
import { createWarnOnce } from './warnOnce';

const logger = getLogger('settings-ipc');
const warnLegacy = createWarnOnce(logger);

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
  const parsed = await readConfig();
  configLoaded = true;
  if (parsed === null) {
    cachedConfig = null;
    return;
  }
  // Boot-time migration: rewrite any legacy safeStorage-encrypted secrets
  // as plaintext, and fill in missing display masks. This is the ONLY path
  // that can trigger a keychain prompt (and only on an upgrade from an
  // older build that still used safeStorage). After one successful run the
  // config is pure plaintext forever.
  const migrated = migrateSecrets(parsed);
  cachedConfig = migrated.config;
  if (migrated.changed) {
    try {
      await writeConfig(migrated.config);
    } catch (err) {
      logger.warn('boot.migrate_secrets.writeConfig_failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Overwrite the cached config reference. For use by sibling IPC modules (e.g.
 * `codex-oauth-ipc`) that mutate `config.providers` via their own write path
 * and need `getCachedConfig` / `toState` to reflect the change immediately.
 * Callers are responsible for having already persisted `next` to disk.
 */
export function setCachedConfig(next: Config): void {
  cachedConfig = next;
  configLoaded = true;
}

export function getCachedConfig(): Config | null {
  if (!configLoaded) {
    throw new CodesignError(
      'getCachedConfig called before loadConfigOnBoot',
      ERROR_CODES.CONFIG_NOT_LOADED,
    );
  }
  return cachedConfig;
}

export function getApiKeyForProvider(provider: string): string {
  const cfg = getCachedConfig();
  if (cfg === null) {
    throw new CodesignError(
      'No configuration found. Complete onboarding first.',
      ERROR_CODES.CONFIG_MISSING,
    );
  }
  const ref = cfg.secrets[provider as keyof typeof cfg.secrets];
  if (ref !== undefined) return decryptSecret(ref.ciphertext);

  // Fallback: if the provider entry declares an envKey (e.g. imported
  // Claude Code providers always declare ANTHROPIC_AUTH_TOKEN), resolve
  // the key from the process environment. This rescues two cases that
  // would otherwise be dead ends:
  //   1. User exported ANTHROPIC_API_KEY in their shell and launched
  //      from a terminal — the env is inherited but our onboarding never
  //      called `encryptSecret`, so cfg.secrets[provider] is empty.
  //   2. User deleted the persisted key from Settings but the env var is
  //      still present. Treat it as a valid credential rather than
  //      throwing a misleading "key missing" error.
  const entry = cfg.providers[provider];
  if (entry?.envKey !== undefined) {
    // Defense in depth against legacy configs: Codex's config.toml env_key
    // field is now allowlisted at import time, but older configs may have
    // stored arbitrary env-var names (pre-allowlist). Re-check here so a
    // stale `envKey: "AWS_SECRET_ACCESS_KEY"` can't still exfiltrate on
    // every LLM call.
    if (!ALLOWED_IMPORT_ENV_KEYS.has(entry.envKey)) {
      logger.warn('get_api_key.envKey_blocked', {
        provider,
        envKey: entry.envKey,
      });
    } else {
      const fromEnv = process.env[entry.envKey]?.trim();
      if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
    }
  }

  throw new CodesignError(
    `No API key stored for provider "${provider}". Re-run onboarding to add one.`,
    ERROR_CODES.PROVIDER_KEY_MISSING,
  );
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
  if (ref === undefined && !isKeylessProviderAllowed(active, cfg.providers[active])) {
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
      ERROR_CODES.CONFIG_MISSING,
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
    throw new CodesignError('save-key expects an object payload', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  const provider = r['provider'];
  const apiKey = r['apiKey'];
  const modelPrimary = r['modelPrimary'];
  const baseUrl = r['baseUrl'];
  if (typeof provider !== 'string' || provider.trim().length === 0) {
    throw new CodesignError(
      `Provider "${String(provider)}" is invalid.`,
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new CodesignError('apiKey must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof modelPrimary !== 'string' || modelPrimary.trim().length === 0) {
    throw new CodesignError('modelPrimary must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const out: SaveKeyInput = { provider, apiKey, modelPrimary };
  if (typeof baseUrl === 'string' && baseUrl.trim().length > 0) {
    try {
      new URL(baseUrl);
    } catch {
      throw new CodesignError(`baseUrl "${baseUrl}" is not a valid URL`, ERROR_CODES.IPC_BAD_INPUT);
    }
    out.baseUrl = baseUrl.trim();
  }
  return out;
}

function parseValidateKey(raw: unknown): ValidateKeyInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('validate-key expects an object payload', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  const provider = r['provider'];
  const apiKey = r['apiKey'];
  const baseUrl = r['baseUrl'];
  if (typeof provider !== 'string') {
    throw new CodesignError('provider must be a string', ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new CodesignError('apiKey must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  if (!isSupportedOnboardingProvider(provider)) {
    throw new CodesignError(
      `Provider "${provider}" is not supported in v0.1. Only anthropic, openai, openrouter.`,
      ERROR_CODES.PROVIDER_NOT_SUPPORTED,
    );
  }
  const out: ValidateKeyInput = { provider, apiKey };
  if (typeof baseUrl === 'string' && baseUrl.length > 0) out.baseUrl = baseUrl;
  return out;
}

// ── Settings handler implementations (shared by v1 and legacy channels) ───────

function runListProviders(): ProviderRow[] {
  // Secret migration happens once at boot (see `loadConfigOnBoot` →
  // `migrateSecrets`). By the time Settings is opened, every row has a
  // persisted plaintext + mask and `toProviderRows` never touches any
  // decrypt path for render. `decryptSecret` is only passed in as a
  // late-stage fallback for exotic rows that somehow slipped through.
  return toProviderRows(getCachedConfig(), decryptSecret);
}

interface SetProviderAndModelsInput extends SaveKeyInput {
  setAsActive: boolean;
}

function parseSetProviderAndModels(raw: unknown): SetProviderAndModelsInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError(
      'set-provider-and-models expects an object payload',
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  const r = raw as Record<string, unknown>;
  const sv = r['schemaVersion'];
  if (sv !== undefined && sv !== 1) {
    throw new CodesignError(
      `Unsupported schemaVersion ${String(sv)} (expected 1)`,
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  const setAsActive = r['setAsActive'];
  if (typeof setAsActive !== 'boolean') {
    throw new CodesignError('setAsActive must be a boolean', ERROR_CODES.IPC_BAD_INPUT);
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
  const secretRef = buildSecretRef(input.apiKey);
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
    [input.provider]: secretRef,
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
    throw new CodesignError('delete-provider expects a provider string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const cfg = getCachedConfig();
  if (cfg === null) return [];
  const nextSecrets = { ...cfg.secrets };
  delete nextSecrets[raw];
  const nextProviders: Record<string, ProviderEntry> = { ...cfg.providers };
  // Remove the provider entry unconditionally. Earlier revisions kept
  // builtin entries around (only clearing the secret) so a user could
  // "re-add" without losing wire/baseUrl defaults — but that left the row
  // visibly undeletable while the UI still toasted "removed". Users who
  // want the builtin back can re-add from the "+ Add provider" menu,
  // which seeds a fresh copy from BUILTIN_PROVIDERS with no data loss.
  delete nextProviders[raw];

  const { nextActive, modelPrimary } = computeDeleteProviderResult(cfg, raw);

  if (nextActive === null) {
    // All providers gone. Reset BOTH activeProvider and activeModel to ''
    // so the config doesn't carry a dangling reference to the just-deleted
    // provider id (which was the old bug: the app would boot next time
    // with activeProvider='openrouter' pointing at a missing entry and
    // activeModel='' failing zod's min(1)).
    const emptyNext: Config = hydrateConfig({
      version: 3,
      activeProvider: '',
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
    throw new CodesignError('set-active-provider expects an object', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  const provider = r['provider'];
  const modelPrimary = r['modelPrimary'];
  if (typeof provider !== 'string' || provider.length === 0) {
    throw new CodesignError('provider must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof modelPrimary !== 'string' || modelPrimary.trim().length === 0) {
    throw new CodesignError('modelPrimary must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const cfg = getCachedConfig();
  if (cfg === null) {
    throw new CodesignError('No configuration found', ERROR_CODES.CONFIG_MISSING);
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

function defaultDataDir(): string {
  return getDefaultUserDataDir();
}

function getStoragePathDefaults() {
  return {
    configDir: defaultConfigDir(),
    logsDir: defaultLogsDir(),
    dataDir: defaultDataDir(),
  };
}

async function runGetPaths(): Promise<AppPaths> {
  const persisted = await readPersistedStorageLocations();
  return buildAppPathsForLocations(persisted, getStoragePathDefaults());
}

function parseStorageKind(raw: unknown): StorageKind {
  if (raw === 'config' || raw === 'logs' || raw === 'data') return raw;
  throw new CodesignError(
    'storage kind must be "config", "logs", or "data"',
    ERROR_CODES.IPC_BAD_INPUT,
  );
}

async function runChooseStorageFolder(raw: unknown): Promise<AppPaths> {
  const kind = parseStorageKind(raw);
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return runGetPaths();
  }
  const selected = result.filePaths[0];
  if (selected === undefined || selected.trim().length === 0) {
    return runGetPaths();
  }
  await writeStorageLocations(patchForStorageKind(kind, selected));
  return runGetPaths();
}

async function runOpenFolder(raw: unknown): Promise<void> {
  if (typeof raw !== 'string') {
    throw new CodesignError('open-folder expects a path string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const error = await shell.openPath(raw);
  if (error) {
    throw new CodesignError(`Could not open ${raw}: ${error}`, ERROR_CODES.OPEN_PATH_FAILED);
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
    throw new CodesignError('config:v1:add-provider expects an object', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  const id = r['id'];
  const name = r['name'];
  const wire = r['wire'];
  const baseUrl = r['baseUrl'];
  const apiKey = r['apiKey'];
  const defaultModel = r['defaultModel'];
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new CodesignError('id must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new CodesignError('name must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const parsedWire = WireApiSchema.safeParse(wire);
  if (!parsedWire.success) {
    throw new CodesignError(`Unsupported wire: ${String(wire)}`, ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
    throw new CodesignError('baseUrl must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  try {
    new URL(baseUrl);
  } catch {
    throw new CodesignError(`baseUrl "${baseUrl}" is not a valid URL`, ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof apiKey !== 'string') {
    throw new CodesignError('apiKey must be a string', ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof defaultModel !== 'string' || defaultModel.trim().length === 0) {
    throw new CodesignError('defaultModel must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
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
  const secretRef = buildSecretRef(input.apiKey);
  const nextProviders = { ...(cachedConfig?.providers ?? {}), [entry.id]: entry };
  const nextSecrets = { ...(cachedConfig?.secrets ?? {}), [entry.id]: secretRef };
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
  reasoningLevel?: ReasoningLevel | null;
  /** When present AND non-empty, re-encrypt and replace the stored secret.
   *  Empty string means "clear stored secret" for providers that became
   *  keyless (e.g. switched to local Ollama). `undefined` means "leave alone". */
  apiKey?: string;
}

function parseUpdateProviderPayload(raw: unknown): UpdateProviderInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError(
      'config:v1:update-provider expects an object',
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  const r = raw as Record<string, unknown>;
  const id = r['id'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new CodesignError('id must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
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
  if (r['reasoningLevel'] === null) {
    // Explicit null clears the override so the core default kicks in.
    out.reasoningLevel = null;
  } else if (typeof r['reasoningLevel'] === 'string') {
    const parsed = ReasoningLevelSchema.safeParse(r['reasoningLevel']);
    if (parsed.success) out.reasoningLevel = parsed.data;
  }
  if (typeof r['apiKey'] === 'string') out.apiKey = r['apiKey'];
  return out;
}

async function runUpdateProvider(input: UpdateProviderInput): Promise<OnboardingState> {
  const cfg = getCachedConfig();
  if (cfg === null) {
    throw new CodesignError('No configuration found', ERROR_CODES.CONFIG_MISSING);
  }
  // Builtin providers may not have an entry on disk yet on a fresh install
  // (the providers map is seeded lazily). Fall back to BUILTIN_PROVIDERS so
  // "change my Ollama baseUrl" works before the user ever opened onboarding.
  const existing =
    cfg.providers[input.id] ??
    (isSupportedOnboardingProvider(input.id) ? { ...BUILTIN_PROVIDERS[input.id] } : undefined);
  if (existing === undefined) {
    throw new CodesignError(`Provider "${input.id}" not found`, ERROR_CODES.IPC_BAD_INPUT);
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
  // reasoningLevel has a tri-state semantic: undefined means "untouched",
  // null means "explicitly clear the override so core picks the default",
  // a string level means "set it". Handle separately from the spread above
  // because the `...undefined ? {} : {...}` pattern can't express "delete".
  if (input.reasoningLevel === null) {
    updated.reasoningLevel = undefined;
  } else if (input.reasoningLevel !== undefined) {
    updated.reasoningLevel = input.reasoningLevel;
  }
  // Secret rotation: only touch secrets when the caller explicitly supplied
  // an apiKey field. Empty string clears the secret (keyless providers);
  // a non-empty value re-encrypts under the current safeStorage session key.
  let nextSecrets = cfg.secrets;
  if (input.apiKey !== undefined) {
    const trimmed = input.apiKey.trim();
    if (trimmed.length === 0) {
      const { [input.id]: _removed, ...rest } = cfg.secrets;
      nextSecrets = rest;
    } else {
      nextSecrets = { ...cfg.secrets, [input.id]: buildSecretRef(trimmed) };
    }
  }
  const next = hydrateConfig({
    version: 3,
    activeProvider: cfg.activeProvider,
    activeModel: cfg.activeModel,
    secrets: nextSecrets,
    providers: { ...cfg.providers, [input.id]: updated },
    ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
  });
  await writeConfig(next);
  cachedConfig = next;
  return toState(cachedConfig);
}

// `ExternalConfigsDetection` and its four `*DetectionMeta` satellites now
// live in `packages/shared/src/detection.ts` so the main process and the
// preload facade can import one source — see that file's header for the
// "we were drifting silently" background.

/** Test seam: the real IPC handler calls `detectChatgptSubscription()` with
 *  no args, which resolves the path via `codexAuthPath()`. Tests can pass
 *  a fabricated path pointing at a tmpdir file without having to mock
 *  `node:fs/promises`. */
export async function detectChatgptSubscription(
  authPath: string = codexAuthPath(),
): Promise<boolean> {
  try {
    const raw = await readFile(authPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return false;
    return (parsed as Record<string, unknown>)['auth_mode'] === 'chatgpt';
  } catch (err) {
    // ENOENT is the "no Codex installed" case; every other error (EACCES,
    // corrupt JSON, etc.) drives the wrong error-message branch for the
    // caller, so log it instead of swallowing silently.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      logger.warn('detect_chatgpt_subscription.failed', {
        code: code ?? 'unknown',
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return false;
  }
}

async function runImportCodex(imported: CodexImport): Promise<OnboardingState> {
  if (imported.providers.length === 0) {
    throw new CodesignError(
      (await detectChatgptSubscription())
        ? 'Detected Codex ChatGPT subscription login (auth_mode: chatgpt). It cannot be imported as an API-key provider yet — the "Sign in with ChatGPT subscription" feature is still being polished and will ship in the next release. For now, configure [model_providers] in ~/.codex/config.toml manually, or switch to API-key mode in Codex. / 检测到 Codex 使用 ChatGPT 订阅登录，无法自动导入为 API key provider。"用 ChatGPT 订阅登录"功能仍在打磨中，下个版本开放 —— 目前请在 ~/.codex/config.toml 里手动配置 [model_providers]，或改用 API key 登录 Codex。'
        : 'No importable API provider found in Codex config (~/.codex/config.toml is missing a [model_providers] section). / Codex 配置里没有可导入的 API provider（~/.codex/config.toml 里缺少 [model_providers] 段）。',
      ERROR_CODES.CONFIG_MISSING,
    );
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
    const importedApiKey = imported.apiKeyMap[entry.id]?.trim();
    if (entry.envKey !== undefined) {
      const envValue = process.env[entry.envKey]?.trim();
      if (envValue !== undefined && envValue.length > 0) {
        // buildSecretRef throws only on empty input — length is already
        // guarded. Bare call instead of wrapping in try/catch so any future
        // invariant break fails loudly rather than quietly writing a row
        // with no key and reporting success.
        nextSecrets[entry.id] = buildSecretRef(envValue);
        continue;
      }
    }
    const fallbackApiKey =
      importedApiKey !== undefined && importedApiKey.length > 0
        ? importedApiKey
        : entry.requiresApiKey === true
          ? process.env['OPENAI_API_KEY']?.trim()
          : undefined;
    if (fallbackApiKey !== undefined && fallbackApiKey.length > 0) {
      nextSecrets[entry.id] = buildSecretRef(fallbackApiKey);
    }
  }
  const fallbackActive = imported.providers[0];
  if (fallbackActive === undefined) {
    throw new CodesignError('Codex config parse produced no providers', ERROR_CODES.CONFIG_MISSING);
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
  // OAuth-only users: bail loudly without touching config. The renderer
  // catches this error code and shows the "subscription can't be shared"
  // banner instead of a fake "imported" toast that would then immediately
  // leave the user in a dead-locked hasKey:false state.
  if (imported.userType === 'oauth-only') {
    throw new CodesignError(
      'Claude Code uses OAuth subscription auth. Generate an API key at https://console.anthropic.com to use it here.',
      ERROR_CODES.CLAUDE_CODE_OAUTH_ONLY,
    );
  }
  if (imported.provider === null) {
    throw new CodesignError('Claude Code config produced no provider', ERROR_CODES.CONFIG_MISSING);
  }

  const nextProviders: Record<string, ProviderEntry> = { ...(cachedConfig?.providers ?? {}) };
  const nextSecrets = { ...(cachedConfig?.secrets ?? {}) };
  if (cachedConfig === null) {
    for (const [id, entry] of Object.entries(BUILTIN_PROVIDERS)) {
      if (nextProviders[id] === undefined) nextProviders[id] = { ...entry };
    }
  }
  nextProviders[imported.provider.id] = imported.provider;
  const importedApiKey = imported.apiKey?.trim();
  const keySaved = importedApiKey !== undefined && importedApiKey.length > 0;
  if (keySaved) {
    nextSecrets[imported.provider.id] = buildSecretRef(importedApiKey);
  }

  // Flip active only when we have a key the new provider can actually use,
  // or when the user is on a fresh install (no existing active to preserve).
  // This is what kills the "active swapped to claude-code-imported but no
  // key stored → hasKey:false → Onboarding is not complete" death path.
  const shouldActivate = keySaved || cachedConfig === null;
  const nextActiveProvider = shouldActivate
    ? imported.provider.id
    : (cachedConfig?.activeProvider ?? '');
  const nextActiveModel = shouldActivate
    ? (imported.activeModel ?? imported.provider.defaultModel)
    : (cachedConfig?.activeModel ?? '');

  const next = hydrateConfig({
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

async function runImportGemini(imported: GeminiImport): Promise<OnboardingState> {
  // Blocked state: Vertex detection etc. — no provider to write. The
  // renderer catches CONFIG_MISSING and surfaces the warning in a toast.
  if (imported.kind === 'blocked') {
    throw new CodesignError(
      imported.warnings[0] ?? 'Gemini CLI config produced no provider',
      ERROR_CODES.CONFIG_MISSING,
    );
  }

  const nextProviders: Record<string, ProviderEntry> = { ...(cachedConfig?.providers ?? {}) };
  const nextSecrets = { ...(cachedConfig?.secrets ?? {}) };
  if (cachedConfig === null) {
    for (const [id, entry] of Object.entries(BUILTIN_PROVIDERS)) {
      if (nextProviders[id] === undefined) nextProviders[id] = { ...entry };
    }
  }
  nextProviders[imported.provider.id] = imported.provider;
  const importedApiKey = imported.apiKey.trim();
  const keySaved = importedApiKey.length > 0;
  if (keySaved) {
    nextSecrets[imported.provider.id] = buildSecretRef(importedApiKey);
  }

  const shouldActivate = keySaved || cachedConfig === null;
  const nextActiveProvider = shouldActivate
    ? imported.provider.id
    : (cachedConfig?.activeProvider ?? '');
  const nextActiveModel = shouldActivate
    ? imported.provider.defaultModel
    : (cachedConfig?.activeModel ?? '');

  const next = hydrateConfig({
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

async function runImportOpencode(imported: OpencodeImport): Promise<OnboardingState> {
  if (imported.providers.length === 0) {
    throw new CodesignError(
      'No importable API provider found in OpenCode auth.json (~/.local/share/opencode/auth.json). Log in to a provider with an API key in OpenCode first. / OpenCode 配置里没有可导入的 API provider，请先在 OpenCode 里用 API key 登录。',
      ERROR_CODES.CONFIG_MISSING,
    );
  }
  const nextProviders: Record<string, ProviderEntry> = { ...(cachedConfig?.providers ?? {}) };
  const nextSecrets = { ...(cachedConfig?.secrets ?? {}) };
  if (cachedConfig === null) {
    for (const [id, entry] of Object.entries(BUILTIN_PROVIDERS)) {
      if (nextProviders[id] === undefined) nextProviders[id] = { ...entry };
    }
  }
  for (const entry of imported.providers) {
    nextProviders[entry.id] = entry;
    const importedApiKey = imported.apiKeyMap[entry.id]?.trim();
    if (importedApiKey !== undefined && importedApiKey.length > 0) {
      nextSecrets[entry.id] = buildSecretRef(importedApiKey);
    }
  }
  const fallbackActive = imported.providers[0];
  if (fallbackActive === undefined) {
    throw new CodesignError('OpenCode import produced no providers', ERROR_CODES.CONFIG_MISSING);
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
  let url: string;
  try {
    url = modelsEndpointUrl(baseUrl, parsedWire.data);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'unsupported wire for /models lookup',
    };
  }
  const headers = buildAuthHeadersForWire(parsedWire.data, apiKey, undefined, baseUrl);
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
        throw new CodesignError(
          'config:v1:remove-provider expects a provider id',
          ERROR_CODES.IPC_BAD_INPUT,
        );
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
      // Log non-ENOENT failures so an unreadable config (EACCES, EISDIR,
      // corrupted file) leaves a diagnostic trail instead of silently
      // degrading into "no config found". The file-not-present case
      // (ENOENT) is the common one and stays noiseless.
      const logDetectFailure = (source: string) => (err: unknown) => {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          logger.warn('detect_external_configs.read_failed', {
            source,
            code: code ?? 'unknown',
            err: err instanceof Error ? err.message : String(err),
          });
        }
        return null;
      };
      const [codex, claudeCode, gemini, opencode] = await Promise.all([
        readCodexConfig().catch(logDetectFailure('codex')),
        readClaudeCodeSettings().catch(logDetectFailure('claude-code')),
        readGeminiCliConfig().catch(logDetectFailure('gemini')),
        readOpencodeConfig().catch(logDetectFailure('opencode')),
      ]);
      const providerIds = Object.keys(cachedConfig?.providers ?? {});
      const alreadyHasCodex = providerIds.some((id) => id.startsWith('codex-'));
      const alreadyHasClaudeCode = providerIds.includes('claude-code-imported');
      const alreadyHasGemini = providerIds.includes('gemini-import');
      const alreadyHasOpencode = providerIds.some((id) => id.startsWith('opencode-'));
      const out: ExternalConfigsDetection = {};
      if (codex !== null && codex.providers.length > 0 && !alreadyHasCodex) {
        // Project to CodexDetectionMeta — strip `apiKeyMap` and `envKeyMap`
        // so plaintext keys never cross the IPC boundary. The import IPC
        // (`config:v1:import-codex-config`) re-reads the file at use time.
        out.codex = {
          providers: codex.providers,
          activeProvider: codex.activeProvider,
          activeModel: codex.activeModel,
          warnings: codex.warnings,
        };
      }
      // Surface Claude Code unless we already imported it. We still surface
      // `oauth-only` users (provider === null) because they need the
      // "subscription can't be shared" banner too — `alreadyHasClaudeCode`
      // is false in that case since no provider entry was ever created.
      if (claudeCode !== null && claudeCode.userType !== 'no-config' && !alreadyHasClaudeCode) {
        out.claudeCode = {
          userType: claudeCode.userType,
          baseUrl: claudeCode.provider?.baseUrl ?? 'https://api.anthropic.com',
          defaultModel:
            claudeCode.provider?.defaultModel ?? claudeCode.activeModel ?? 'claude-sonnet-4-6',
          hasApiKey: claudeCode.apiKey !== null,
          apiKeySource: claudeCode.apiKeySource,
          settingsPath: claudeCode.settingsPath,
          warnings: claudeCode.warnings,
        };
      }
      // Gemini: surface whenever we found either a usable key OR a Vertex AI
      // signal (kind='blocked'). `alreadyHasGemini` gates the regular import
      // path; Vertex users see the banner regardless since their config was
      // already imported by a previous Gemini session — the banner tells
      // them what they need to do manually.
      if (gemini !== null) {
        const blocked = gemini.kind === 'blocked';
        if (!alreadyHasGemini || blocked) {
          out.gemini = {
            hasApiKey: gemini.kind === 'found',
            apiKeySource: gemini.kind === 'found' ? gemini.apiKeySource : 'none',
            keyPath: gemini.kind === 'found' ? gemini.keyPath : null,
            baseUrl:
              gemini.kind === 'found'
                ? gemini.provider.baseUrl
                : 'https://generativelanguage.googleapis.com/v1beta/openai',
            defaultModel:
              gemini.kind === 'found' ? gemini.provider.defaultModel : 'gemini-2.5-flash',
            warnings: gemini.warnings,
            blocked,
          };
        }
      }
      if (opencode !== null && !alreadyHasOpencode) {
        // Surface whenever we found opencode evidence — either (a) there's
        // at least one importable provider (happy path), or (b) auth.json
        // exists but produced no usable entries (corrupt JSON, all OAuth,
        // all unsupported). Case (b) gets a warning-only banner so the
        // user at least sees we detected their setup.
        const blocked = opencode.providers.length === 0;
        if (!blocked || opencode.warnings.length > 0) {
          out.opencode = {
            providers: opencode.providers,
            activeProvider: opencode.activeProvider,
            activeModel: opencode.activeModel,
            warnings: opencode.warnings,
            blocked,
          };
        }
      }
      return out;
    },
  );

  ipcMain.handle('config:v1:import-codex-config', async (): Promise<OnboardingState> => {
    const imported = await readCodexConfig();
    if (imported === null) {
      throw new CodesignError(
        'No Codex config found at ~/.codex/config.toml',
        ERROR_CODES.CONFIG_MISSING,
      );
    }
    return runImportCodex(imported);
  });

  ipcMain.handle('config:v1:import-claude-code-config', async (): Promise<OnboardingState> => {
    const imported = await readClaudeCodeSettings();
    if (imported === null) {
      throw new CodesignError(
        'No Claude Code settings found at ~/.claude/settings.json',
        ERROR_CODES.CONFIG_MISSING,
      );
    }
    // Pass OAuth-only imports through to runImportClaudeCode so it can
    // throw the CLAUDE_CODE_OAUTH_ONLY error. The renderer distinguishes
    // that case and shows the subscription-warning banner — a generic
    // "no config found" swallows the nuance.
    if (imported.provider === null && imported.userType !== 'oauth-only') {
      throw new CodesignError(
        'No Claude Code settings found at ~/.claude/settings.json',
        ERROR_CODES.CONFIG_MISSING,
      );
    }
    return runImportClaudeCode(imported);
  });

  ipcMain.handle('config:v1:import-gemini-config', async (): Promise<OnboardingState> => {
    const imported = await readGeminiCliConfig();
    if (imported === null) {
      throw new CodesignError(
        'No GEMINI_API_KEY found in ~/.gemini/.env, ~/.env, or the shell environment.',
        ERROR_CODES.CONFIG_MISSING,
      );
    }
    return runImportGemini(imported);
  });

  ipcMain.handle('config:v1:import-opencode-config', async (): Promise<OnboardingState> => {
    const imported = await readOpencodeConfig();
    if (imported === null) {
      throw new CodesignError(
        'No OpenCode auth found at ~/.local/share/opencode/auth.json',
        ERROR_CODES.CONFIG_MISSING,
      );
    }
    return runImportOpencode(imported);
  });

  ipcMain.handle('config:v1:list-endpoint-models', async (_e, raw: unknown) => {
    return runListEndpointModels(raw);
  });

  // ── Settings v1 channels ────────────────────────────────────────────────────

  ipcMain.handle(
    'settings:v1:list-providers',
    async (): Promise<ProviderRow[]> => runListProviders(),
  );

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

  ipcMain.handle('settings:v1:get-paths', async (): Promise<AppPaths> => runGetPaths());

  ipcMain.handle(
    'settings:v1:choose-storage-folder',
    async (_e, raw: unknown): Promise<AppPaths> => runChooseStorageFolder(raw),
  );

  ipcMain.handle(
    'settings:v1:open-folder',
    async (_e, raw: unknown): Promise<void> => runOpenFolder(raw),
  );

  ipcMain.handle('settings:v1:reset-onboarding', async (): Promise<void> => runResetOnboarding());

  ipcMain.handle('settings:v1:toggle-devtools', (_e) => {
    _e.sender.toggleDevTools();
  });

  // ── Settings legacy shims (schedule removal next minor) ────────────────────

  ipcMain.handle('settings:list-providers', async (): Promise<ProviderRow[]> => {
    warnLegacy('legacy.settings.list-providers', 'channel used, schedule removal next minor');
    return runListProviders();
  });

  ipcMain.handle('settings:add-provider', async (_e, raw: unknown): Promise<ProviderRow[]> => {
    warnLegacy('legacy.settings.add-provider', 'channel used, schedule removal next minor');
    return runAddProvider(raw);
  });

  ipcMain.handle('settings:delete-provider', async (_e, raw: unknown): Promise<ProviderRow[]> => {
    warnLegacy('legacy.settings.delete-provider', 'channel used, schedule removal next minor');
    return runDeleteProvider(raw);
  });

  ipcMain.handle(
    'settings:set-active-provider',
    async (_e, raw: unknown): Promise<OnboardingState> => {
      warnLegacy(
        'legacy.settings.set-active-provider',
        'channel used, schedule removal next minor',
      );
      return runSetActiveProvider(raw);
    },
  );

  ipcMain.handle('settings:get-paths', async (): Promise<AppPaths> => {
    warnLegacy('legacy.settings.get-paths', 'channel used, schedule removal next minor');
    return runGetPaths();
  });

  ipcMain.handle('settings:choose-storage-folder', async (_e, raw: unknown): Promise<AppPaths> => {
    warnLegacy(
      'legacy.settings.choose-storage-folder',
      'channel used, schedule removal next minor',
    );
    return runChooseStorageFolder(raw);
  });

  ipcMain.handle('settings:open-folder', async (_e, raw: unknown) => {
    warnLegacy('legacy.settings.open-folder', 'channel used, schedule removal next minor');
    return runOpenFolder(raw);
  });

  ipcMain.handle('settings:reset-onboarding', async (): Promise<void> => {
    warnLegacy('legacy.settings.reset-onboarding', 'channel used, schedule removal next minor');
    return runResetOnboarding();
  });

  ipcMain.handle('settings:toggle-devtools', (_e) => {
    warnLegacy('legacy.settings.toggle-devtools', 'channel used, schedule removal next minor');
    _e.sender.toggleDevTools();
  });
}
