import { z } from 'zod';

// ── Legacy enum (v1/v2) — kept for backward compat & UI shortlist ─────────────

const ProviderIdEnum = z.enum([
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'groq',
  'cerebras',
  'xai',
  'mistral',
  'amazon-bedrock',
  'azure-openai-responses',
  'vercel-ai-gateway',
]);

export const SUPPORTED_ONBOARDING_PROVIDERS = [
  'anthropic',
  'openai',
  'openrouter',
  'ollama',
] as const;
export type SupportedOnboardingProvider = (typeof SUPPORTED_ONBOARDING_PROVIDERS)[number];

/** Default Ollama local endpoint. Users override via Settings if they run
 *  Ollama on a different host/port. */
export const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434/v1';
export const OLLAMA_DEFAULT_MODEL = 'llama3.2';

// ── Wire types (v3) ──────────────────────────────────────────────────────────

export const WireApiSchema = z.enum(['openai-chat', 'openai-responses', 'anthropic']);
export type WireApi = z.infer<typeof WireApiSchema>;

// ── Secrets & StoredDesignSystem ─────────────────────────────────────────────

export const SecretRef = z.object({
  ciphertext: z.string().min(1),
  /**
   * Display-only mask like "sk-ant-***xyz9". Persisted at save time so the
   * Settings page can render the row without calling `safeStorage.decryptString`
   * (which on unsigned macOS builds triggers a keychain password prompt).
   * Optional for backwards compat: older configs without a mask will be
   * migrated on first read by decrypting once and writing the mask back.
   */
  mask: z.string().optional(),
});
export type SecretRef = z.infer<typeof SecretRef>;

export const BaseUrlRef = z.object({
  baseUrl: z.string().url(),
});
export type BaseUrlRef = z.infer<typeof BaseUrlRef>;

export const STORED_DESIGN_SYSTEM_SCHEMA_VERSION = 1 as const;

const StoredDesignSystemShape = z.object({
  schemaVersion: z.literal(STORED_DESIGN_SYSTEM_SCHEMA_VERSION),
  rootPath: z.string().min(1),
  summary: z.string().min(1),
  extractedAt: z.string().min(1),
  sourceFiles: z.array(z.string().min(1)).max(24).default([]),
  colors: z.array(z.string().min(1)).max(24).default([]),
  fonts: z.array(z.string().min(1)).max(16).default([]),
  spacing: z.array(z.string().min(1)).max(16).default([]),
  radius: z.array(z.string().min(1)).max(16).default([]),
  shadows: z.array(z.string().min(1)).max(16).default([]),
});

export const StoredDesignSystem = z.preprocess((raw) => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  if ('schemaVersion' in record) return record;
  return { schemaVersion: STORED_DESIGN_SYSTEM_SCHEMA_VERSION, ...record };
}, StoredDesignSystemShape);
export type StoredDesignSystem = z.infer<typeof StoredDesignSystem>;

// ── ProviderEntry (v3) ───────────────────────────────────────────────────────

export const ReasoningLevelSchema = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']);
export type ReasoningLevel = z.infer<typeof ReasoningLevelSchema>;

export const ProviderEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  builtin: z.boolean(),
  wire: WireApiSchema,
  baseUrl: z.string().url(),
  envKey: z.string().min(1).optional(),
  defaultModel: z.string().min(1),
  modelsHint: z.array(z.string()).optional(),
  httpHeaders: z.record(z.string(), z.string()).optional(),
  queryParams: z.record(z.string(), z.string()).optional(),
  /**
   * Imported providers can explicitly require a stored secret. Codex uses this
   * for providers with `requires_openai_auth = true`; providers without it may
   * still be keyless proxy endpoints.
   */
  requiresApiKey: z.boolean().optional(),
  /**
   * Per-provider reasoning effort override. When set, overrides the
   * model-family default from `reasoningForModel` in core. Useful for
   * proxies that gate reasoning tiers by plan (Claude Code consumer-tier
   * accepts only 'medium') or for users who want to dial depth up/down
   * per endpoint. The UI surfaces this as a "Reasoning depth" dropdown.
   */
  reasoningLevel: ReasoningLevelSchema.optional(),
});
export type ProviderEntry = z.infer<typeof ProviderEntrySchema>;

export const BUILTIN_PROVIDERS: Readonly<Record<SupportedOnboardingProvider, ProviderEntry>> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic Claude',
    builtin: true,
    wire: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-6',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    builtin: true,
    wire: 'openai-chat',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    builtin: true,
    wire: 'openai-chat',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-4.6',
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (local)',
    builtin: true,
    wire: 'openai-chat',
    baseUrl: OLLAMA_DEFAULT_BASE_URL,
    defaultModel: OLLAMA_DEFAULT_MODEL,
    requiresApiKey: false,
  },
} as const;

// ── ConfigSchema v3 — canonical on-disk shape ────────────────────────────────

/**
 * Canonical v3 config shape written to disk. All `writeConfig` calls emit
 * exactly this shape. Reads accept v1/v2 as well (see `parseConfigFlexible`),
 * migrating transparently.
 *
 * The `Config` TypeScript type additionally exposes legacy `provider` /
 * `modelPrimary` / `baseUrls` accessors as read-only derived views — existing
 * consumers keep working without rewrites. These derived fields are NOT
 * persisted. Writers must use v3 fields only.
 */
export const ConfigV3Schema = z.object({
  version: z.literal(3),
  // `activeProvider` / `activeModel` are ALLOWED to be empty: that's the
  // legal "no active provider" state the app lands in once the last
  // provider is deleted. Consumers (`toState`, `resolveActiveCredentials`,
  // Settings UI) already branch on hasKey/undefined-entry for this case.
  // The previous `.min(1)` invariant made the empty state unrepresentable
  // on disk — writing it succeeded but the next boot rejected the file,
  // hanging the main process before the window could open.
  activeProvider: z.string(),
  activeModel: z.string(),
  secrets: z.record(z.string(), SecretRef).default({}),
  providers: z.record(z.string(), ProviderEntrySchema).default({}),
  designSystem: StoredDesignSystem.optional(),
});
export type ConfigV3 = z.infer<typeof ConfigV3Schema>;

/**
 * Runtime config view — v3 on disk, plus derived legacy accessors for
 * backward compat with v0.1 consumer code. Only the v3 fields are written.
 */
export interface Config extends ConfigV3 {
  /** @deprecated Use `activeProvider`. Derived from v3 state. */
  readonly provider: string;
  /** @deprecated Use `activeModel`. Derived from v3 state. */
  readonly modelPrimary: string;
  /** @deprecated Use `providers[id].baseUrl`. Derived from v3 state. */
  readonly baseUrls: Record<string, BaseUrlRef | undefined>;
}

export const ConfigSchema = ConfigV3Schema;

const LegacyConfigSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]).optional(),
  provider: ProviderIdEnum,
  modelPrimary: z.string(),
  modelFast: z.string().optional(),
  secrets: z.record(ProviderIdEnum, SecretRef).default({}),
  baseUrls: z.record(ProviderIdEnum, BaseUrlRef).default({}),
  designSystem: StoredDesignSystem.optional(),
});
type LegacyConfig = z.infer<typeof LegacyConfigSchema>;

function cloneBuiltin(id: SupportedOnboardingProvider): ProviderEntry {
  return { ...BUILTIN_PROVIDERS[id] };
}

/**
 * Pure: migrate a validated v1/v2 config to v3. Seeds the three builtin
 * providers and overlays any stored baseUrls onto them.
 */
export function migrateLegacyToV3(legacy: LegacyConfig): ConfigV3 {
  const providers: Record<string, ProviderEntry> = {};
  for (const key of SUPPORTED_ONBOARDING_PROVIDERS) {
    providers[key] = cloneBuiltin(key);
  }
  for (const [id, ref] of Object.entries(legacy.baseUrls ?? {})) {
    if (ref === undefined) continue;
    const existing = providers[id];
    if (existing !== undefined) {
      providers[id] = { ...existing, baseUrl: ref.baseUrl };
    }
  }
  const secrets: Record<string, SecretRef> = {};
  for (const [id, ref] of Object.entries(legacy.secrets ?? {})) {
    if (ref !== undefined) secrets[id] = ref;
  }
  const out: ConfigV3 = {
    version: 3,
    activeProvider: legacy.provider,
    activeModel: legacy.modelPrimary,
    secrets,
    providers,
  };
  if (legacy.designSystem !== undefined) out.designSystem = legacy.designSystem;
  return out;
}

/**
 * Single entry point for parsing raw config objects. Detects version and
 * either returns a v3 `Config` directly or runs the legacy migrator first.
 * Always returns the full `Config` runtime view with derived legacy fields.
 */
export function parseConfigFlexible(raw: unknown): Config {
  const v3 = parseV3OrMigrate(raw);
  return hydrateConfig(v3);
}

function parseV3OrMigrate(raw: unknown): ConfigV3 {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return ConfigV3Schema.parse(raw);
  }
  const r = raw as Record<string, unknown>;
  if (r['version'] === 3) {
    return ConfigV3Schema.parse(raw);
  }
  const legacy = LegacyConfigSchema.parse(raw);
  return migrateLegacyToV3(legacy);
}

/**
 * Attach derived legacy accessors to a bare v3 config. Idempotent.
 */
export function hydrateConfig(v3: ConfigV3): Config {
  const baseUrls: Record<string, BaseUrlRef | undefined> = {};
  for (const [id, entry] of Object.entries(v3.providers)) {
    if (entry !== undefined) baseUrls[id] = { baseUrl: entry.baseUrl };
  }
  return {
    ...v3,
    provider: v3.activeProvider,
    modelPrimary: v3.activeModel,
    baseUrls,
  };
}

/**
 * Strip derived fields before writing to disk. Always returns a pure v3 shape.
 */
export function toPersistedV3(cfg: Config | ConfigV3): ConfigV3 {
  return {
    version: 3,
    activeProvider: cfg.activeProvider,
    activeModel: cfg.activeModel,
    secrets: cfg.secrets,
    providers: cfg.providers,
    ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
  };
}

// ── OnboardingState ──────────────────────────────────────────────────────────

export interface OnboardingState {
  hasKey: boolean;
  provider: string | null;
  modelPrimary: string | null;
  baseUrl: string | null;
  designSystem: StoredDesignSystem | null;
}

export interface ProviderShortlist {
  provider: SupportedOnboardingProvider;
  label: string;
  keyHelpUrl: string;
  primary: string[];
  defaultPrimary: string;
}

export const PROVIDER_SHORTLIST: Record<SupportedOnboardingProvider, ProviderShortlist> = {
  anthropic: {
    provider: 'anthropic',
    label: 'Anthropic Claude',
    keyHelpUrl: 'https://console.anthropic.com/settings/keys',
    primary: ['claude-sonnet-4-6', 'claude-opus-4-1'],
    defaultPrimary: 'claude-sonnet-4-6',
  },
  openai: {
    provider: 'openai',
    label: 'OpenAI',
    keyHelpUrl: 'https://platform.openai.com/api-keys',
    primary: ['gpt-4o', 'gpt-4.1'],
    defaultPrimary: 'gpt-4o',
  },
  openrouter: {
    provider: 'openrouter',
    label: 'OpenRouter',
    keyHelpUrl: 'https://openrouter.ai/keys',
    primary: ['anthropic/claude-sonnet-4.6', 'openai/gpt-4o'],
    defaultPrimary: 'anthropic/claude-sonnet-4.6',
  },
  ollama: {
    provider: 'ollama',
    label: 'Ollama (local)',
    keyHelpUrl: 'https://ollama.com/download',
    primary: [OLLAMA_DEFAULT_MODEL, 'llama3.1', 'qwen2.5'],
    defaultPrimary: OLLAMA_DEFAULT_MODEL,
  },
};

export function isSupportedOnboardingProvider(p: string): p is SupportedOnboardingProvider {
  return (SUPPORTED_ONBOARDING_PROVIDERS as readonly string[]).includes(p);
}

/**
 * Auto-detect a sensible wire from a base URL. Used by the Custom provider
 * form to preselect the radio — user can always override.
 */
export function detectWireFromBaseUrl(baseUrl: string): WireApi {
  const lower = baseUrl.toLowerCase();
  if (lower.includes('anthropic')) return 'anthropic';
  if (lower.includes('openai.azure.com') || lower.includes('/responses')) {
    return 'openai-responses';
  }
  return 'openai-chat';
}
