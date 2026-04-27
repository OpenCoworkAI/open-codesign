import {
  BUILTIN_PROVIDERS,
  CodesignError,
  type Config,
  ERROR_CODES,
  hydrateConfig,
  isSupportedOnboardingProvider,
  modelsEndpointUrl,
  type OnboardingState,
  type ProviderEntry,
  type SupportedOnboardingProvider,
  WireApiSchema,
} from '@open-codesign/shared';
import { buildAuthHeadersForWire } from '../auth-headers';
import { writeConfig } from '../config';
import { buildSecretRef, decryptSecret } from '../keychain';
import {
  assertProviderHasStoredSecret,
  computeDeleteProviderResult,
  getAddProviderDefaults,
  isKeylessProviderAllowed,
  type ProviderRow,
  toProviderRows,
} from '../provider-settings';
import { getCachedConfig, setCachedConfig, toState } from './config-cache';
import type {
  AddCustomProviderInput,
  SaveKeyInput,
  SetProviderAndModelsInput,
  UpdateProviderInput,
} from './provider-parsers';
import { parseSaveKey } from './provider-parsers';

export function runListProviders(): ProviderRow[] {
  // Secret migration happens once at boot (see `loadConfigOnBoot` →
  // `migrateSecrets`). By the time Settings is opened, every row has a
  // persisted plaintext + mask and `toProviderRows` never touches any
  // decrypt path for render. `decryptSecret` is only passed in as a
  // Late-stage normalization for exotic rows that somehow slipped through.
  return toProviderRows(getCachedConfig(), decryptSecret);
}

/**
 * Canonical "add or update a provider" mutation. Atomic: writes secret +
 * baseUrl + (optionally) flips active provider in a single writeConfig.
 *
 * Returns the full OnboardingState so renderer can hydrate Zustand without a
 * follow-up read — that store-sync gap is what made TopBar drift out of date
 * after Settings mutations.
 */
export async function runSetProviderAndModels(
  input: SetProviderAndModelsInput,
): Promise<OnboardingState> {
  const cachedConfig = getCachedConfig();
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
  const nextSecrets = { ...(cachedConfig?.secrets ?? {}) };
  if (input.apiKey.length > 0) {
    nextSecrets[input.provider] = buildSecretRef(input.apiKey);
  } else {
    delete nextSecrets[input.provider];
  }
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
  setCachedConfig(next);
  return toState(next);
}

export async function runAddProvider(raw: unknown): Promise<ProviderRow[]> {
  const input = parseSaveKey(raw);
  const defaults = getAddProviderDefaults(getCachedConfig(), input);
  await runSetProviderAndModels({
    ...input,
    setAsActive: defaults.activeProvider === input.provider,
    modelPrimary: defaults.modelPrimary,
  });
  return toProviderRows(getCachedConfig(), decryptSecret);
}

export async function runDeleteProvider(raw: unknown): Promise<ProviderRow[]> {
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
    setCachedConfig(emptyNext);
    return toProviderRows(emptyNext, decryptSecret);
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
  setCachedConfig(next);
  return toProviderRows(next, decryptSecret);
}

export async function runSetActiveProvider(raw: unknown): Promise<OnboardingState> {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('set-active-provider expects an object', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (key !== 'provider' && key !== 'modelPrimary') {
      throw new CodesignError(
        `set-active-provider contains unsupported field "${key}"`,
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
  }
  const provider = r['provider'];
  const modelPrimary = r['modelPrimary'];
  if (typeof provider !== 'string' || provider.trim().length === 0) {
    throw new CodesignError('provider must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const providerId = provider.trim();
  if (typeof modelPrimary !== 'string' || modelPrimary.trim().length === 0) {
    throw new CodesignError('modelPrimary must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const activeModel = modelPrimary.trim();
  const cfg = getCachedConfig();
  if (cfg === null) {
    throw new CodesignError('No configuration found', ERROR_CODES.CONFIG_MISSING);
  }
  assertProviderHasStoredSecret(cfg, providerId);
  const next: Config = hydrateConfig({
    version: 3,
    activeProvider: providerId,
    activeModel,
    secrets: cfg.secrets,
    providers: cfg.providers,
    ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
  });
  await writeConfig(next);
  setCachedConfig(next);
  return toState(next);
}

export async function runAddCustomProvider(
  input: AddCustomProviderInput,
): Promise<OnboardingState> {
  const cachedConfig = getCachedConfig();
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
  setCachedConfig(next);
  return toState(next);
}

export async function runUpdateProvider(input: UpdateProviderInput): Promise<OnboardingState> {
  const cfg = getCachedConfig();
  if (cfg === null) {
    throw new CodesignError('No configuration found', ERROR_CODES.CONFIG_MISSING);
  }
  // Builtin providers may not have an entry on disk yet on a fresh install
  // (the providers map is seeded lazily). Read BUILTIN_PROVIDERS so
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
      if (!isKeylessProviderAllowed(input.id, updated)) {
        throw new CodesignError(
          `Cannot clear API key for provider "${input.id}" unless it explicitly supports keyless mode.`,
          ERROR_CODES.PROVIDER_KEY_MISSING,
        );
      }
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
  setCachedConfig(next);
  return toState(next);
}

// ── /models endpoint lookup ───────────────────────────────────────────────

export interface ListEndpointModelsResponse {
  ok: boolean;
  models?: string[];
  error?: string;
}

const LIST_ENDPOINT_MODELS_FIELDS = ['wire', 'baseUrl', 'apiKey'] as const;

function hasOnlyListEndpointModelFields(r: Record<string, unknown>): string | null {
  for (const key of Object.keys(r)) {
    if (!(LIST_ENDPOINT_MODELS_FIELDS as readonly string[]).includes(key)) return key;
  }
  return null;
}

function extractEndpointModelIds(items: unknown[]): string[] | null {
  const ids: string[] = [];
  for (const item of items) {
    if (item === null || typeof item !== 'object') return null;
    const record = item as { id?: unknown; name?: unknown };
    if (typeof record.id === 'string') {
      ids.push(record.id);
      continue;
    }
    if (typeof record.name === 'string') {
      ids.push(record.name);
      continue;
    }
    return null;
  }
  return ids;
}

function parseEndpointBaseUrl(
  value: unknown,
): { ok: true; baseUrl: string } | { ok: false; error: string } {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, error: 'baseUrl required' };
  }
  const baseUrl = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { ok: false, error: `baseUrl "${baseUrl}" is not a valid URL` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `baseUrl must use http(s), got "${parsed.protocol}"` };
  }
  return { ok: true, baseUrl };
}

export async function runListEndpointModels(raw: unknown): Promise<ListEndpointModelsResponse> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'expected an object payload' };
  }
  const r = raw as Record<string, unknown>;
  const unsupportedField = hasOnlyListEndpointModelFields(r);
  if (unsupportedField !== null) {
    return { ok: false, error: `unsupported field "${unsupportedField}"` };
  }
  const wireRaw = r['wire'];
  const baseUrl = r['baseUrl'];
  const apiKey = r['apiKey'];
  const parsedWire = WireApiSchema.safeParse(wireRaw);
  if (!parsedWire.success) return { ok: false, error: `unsupported wire: ${String(wireRaw)}` };
  const parsedBaseUrl = parseEndpointBaseUrl(baseUrl);
  if (!parsedBaseUrl.ok) return { ok: false, error: parsedBaseUrl.error };
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    return { ok: false, error: 'apiKey required' };
  }
  let url: string;
  try {
    url = modelsEndpointUrl(parsedBaseUrl.baseUrl, parsedWire.data);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'unsupported wire for /models lookup',
    };
  }
  const headers = buildAuthHeadersForWire(
    parsedWire.data,
    apiKey.trim(),
    undefined,
    parsedBaseUrl.baseUrl,
  );
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
    const ids = extractEndpointModelIds(data);
    if (ids === null) return { ok: false, error: 'unexpected response shape' };
    return { ok: true, models: ids };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type { SaveKeyInput };
