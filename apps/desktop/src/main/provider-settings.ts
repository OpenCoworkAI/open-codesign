import {
  BUILTIN_PROVIDERS,
  CHATGPT_CODEX_PROVIDER_ID,
  CodesignError,
  type Config,
  ERROR_CODES,
  type ModelRef,
  PROVIDER_SHORTLIST,
  type ProviderEntry,
  type ReasoningLevel,
  SUPPORTED_ONBOARDING_PROVIDERS,
  type WireApi,
  isSupportedOnboardingProvider,
} from '@open-codesign/shared';
import { maskSecret } from './keychain';

export interface ProviderRow {
  provider: string;
  maskedKey: string;
  baseUrl: string | null;
  isActive: boolean;
  /** Human-readable display label. For codex-imported rows this is the
   *  UI alias "Codex (imported)", not the stored entry name. */
  label: string;
  /** Actual stored provider name — the value that round-trips through
   *  updateProvider. Differs from `label` for codex rows. */
  name: string;
  builtin: boolean;
  wire: WireApi;
  defaultModel: string;
  hasKey: boolean;
  reasoningLevel?: ReasoningLevel;
  error?: 'decryption_failed' | string;
}

/**
 * @deprecated Use `maskSecret` from `./keychain`. Re-exported for tests that
 * still import the old name.
 */
export const maskKey = maskSecret;

export function getAddProviderDefaults(
  cfg: Config | null,
  input: {
    provider: string;
    modelPrimary: string;
  },
): {
  activeProvider: string;
  modelPrimary: string;
} {
  if (cfg === null || cfg.secrets[cfg.activeProvider] === undefined) {
    return {
      activeProvider: input.provider,
      modelPrimary: input.modelPrimary,
    };
  }
  return {
    activeProvider: cfg.activeProvider,
    modelPrimary: cfg.activeModel,
  };
}

export function assertProviderHasStoredSecret(cfg: Config, provider: string): void {
  if (cfg.secrets[provider] !== undefined) return;
  if (isKeylessProviderAllowed(provider, resolveEntryFor(cfg, provider))) return;
  throw new CodesignError(
    `No API key stored for provider "${provider}".`,
    ERROR_CODES.PROVIDER_KEY_MISSING,
  );
}

export function isKeylessProviderAllowed(provider: string, entry?: ProviderEntry | null): boolean {
  // Providers that explicitly opt out of API keys (e.g. local Ollama, a
  // self-hosted LiteLLM fronting IP-whitelisted models). The flag lets any
  // provider — builtin or custom — declare keyless-ness at config time.
  if (entry?.requiresApiKey === false) return true;
  const isCodexFamily = provider.startsWith('codex-') || provider === CHATGPT_CODEX_PROVIDER_ID;
  return isCodexFamily && entry?.requiresApiKey !== true && entry?.envKey === undefined;
}

function resolveEntryFor(cfg: Config, id: string): ProviderEntry | null {
  const stored = cfg.providers[id];
  if (stored !== undefined) return stored;
  if (isSupportedOnboardingProvider(id)) return { ...BUILTIN_PROVIDERS[id] };
  return null;
}

export function toProviderRows(
  cfg: Config | null,
  decrypt: (ciphertext: string) => string,
): ProviderRow[] {
  if (cfg === null) return [];

  const rows: ProviderRow[] = [];
  // Iterate the union of provider entries and stored secrets so that
  // providers added without an API key (e.g. a Codex import where the
  // env_key var wasn't exported) still surface as a row the user can
  // complete via "Edit". Otherwise they'd silently disappear.
  const allIds = new Set<string>([
    ...Object.keys(cfg.providers ?? {}),
    ...Object.keys(cfg.secrets ?? {}),
  ]);
  // Keyless builtins (e.g. Ollama) always surface as rows so users can
  // discover + enable them without going through onboarding first. Without
  // this, a fresh v3 install would hide Ollama entirely — the providers
  // map gets populated lazily during onboarding, but Ollama has no
  // onboarding step to run.
  for (const builtinId of SUPPORTED_ONBOARDING_PROVIDERS) {
    if (BUILTIN_PROVIDERS[builtinId].requiresApiKey === false) {
      allIds.add(builtinId);
    }
  }
  for (const provider of allIds) {
    const ref = cfg.secrets?.[provider];
    const entry = resolveEntryFor(cfg, provider);

    let maskedKey = '';
    let rowError: ProviderRow['error'];
    if (ref !== undefined) {
      // Prefer the persisted mask — avoids triggering a keychain password
      // prompt on unsigned macOS builds just to render the Settings row.
      // Fall back to decrypting once for legacy configs that pre-date the
      // mask field; `migrateSecrets` should have rewritten them, but
      // we stay resilient in case migration didn't complete.
      if (ref.mask !== undefined && ref.mask.length > 0) {
        maskedKey = ref.mask;
      } else {
        try {
          const plain = decrypt(ref.ciphertext);
          maskedKey = maskSecret(plain);
        } catch {
          maskedKey = '';
          rowError = 'decryption_failed';
        }
      }
    }

    const label = provider.startsWith('codex-')
      ? 'Codex (imported)'
      : (entry?.name ??
        (isSupportedOnboardingProvider(provider) ? PROVIDER_SHORTLIST[provider].label : provider));

    rows.push({
      provider,
      maskedKey,
      baseUrl: entry?.baseUrl ?? null,
      isActive: cfg.activeProvider === provider,
      label,
      // The real stored name (or the builtin default) — used by the edit
      // modal so a codex-imported row doesn't overwrite `entry.name` with
      // the display alias "Codex (imported)" on save.
      name: entry?.name ?? label,
      builtin: entry?.builtin ?? isSupportedOnboardingProvider(provider),
      wire: entry?.wire ?? 'openai-chat',
      defaultModel:
        entry?.defaultModel ??
        (isSupportedOnboardingProvider(provider)
          ? PROVIDER_SHORTLIST[provider].defaultPrimary
          : ''),
      // codex-* providers are treated as no-auth / IP-gated by default —
      // absent secret is a legitimate state, not a "missing key" warning.
      hasKey: ref !== undefined || isKeylessProviderAllowed(provider, entry),
      ...(entry?.reasoningLevel !== undefined ? { reasoningLevel: entry.reasoningLevel } : {}),
      ...(rowError !== undefined ? { error: rowError } : {}),
    });
  }

  return rows;
}

export interface DeleteProviderResult {
  /** null means tombstone: all providers removed, onboarding should re-run. */
  nextActive: string | null;
  modelPrimary: string;
}

/**
 * Pure helper: given the current config and the provider to remove, computes
 * what the next active provider and model values should be.
 */
export function computeDeleteProviderResult(cfg: Config, toDelete: string): DeleteProviderResult {
  const remaining = Object.keys(cfg.providers).filter(
    (p) =>
      p !== toDelete &&
      (cfg.secrets[p] !== undefined || isKeylessProviderAllowed(p, resolveEntryFor(cfg, p))),
  );

  if (remaining.length === 0) {
    return { nextActive: null, modelPrimary: '' };
  }

  const keepCurrent = cfg.activeProvider !== toDelete;
  const nextActive = keepCurrent ? cfg.activeProvider : (remaining[0] as string);

  if (cfg.activeProvider === toDelete) {
    const entry = resolveEntryFor(cfg, nextActive);
    const fallbackModel = isSupportedOnboardingProvider(nextActive)
      ? PROVIDER_SHORTLIST[nextActive].defaultPrimary
      : (entry?.defaultModel ?? '');
    return {
      nextActive,
      modelPrimary: fallbackModel,
    };
  }

  return { nextActive, modelPrimary: cfg.activeModel };
}

/**
 * Result of resolving which provider/model to call against, given the canonical
 * cached config and the renderer's hint payload.
 */
export interface ActiveModelResolution {
  model: ModelRef;
  baseUrl: string | null;
  wire: WireApi;
  httpHeaders: Record<string, string> | undefined;
  queryParams: Record<string, string> | undefined;
  reasoningLevel: ReasoningLevel | undefined;
  allowKeyless: boolean;
  /** True when the renderer-supplied hint provider didn't match the canonical active. */
  overridden: boolean;
}

export function resolveActiveModel(
  cfg: Config,
  hint: { provider: string; modelId: string },
): ActiveModelResolution {
  const activeId = cfg.activeProvider;
  const entry = resolveEntryFor(cfg, activeId);
  if (entry === null) {
    throw new CodesignError(
      `Active provider "${activeId}" has no provider entry on disk.`,
      ERROR_CODES.PROVIDER_NOT_SUPPORTED,
    );
  }
  const allowKeyless = isKeylessProviderAllowed(activeId, entry);
  if (cfg.secrets[activeId] === undefined && !allowKeyless) {
    throw new CodesignError(
      `No API key stored for active provider "${activeId}". Re-run onboarding to add one.`,
      ERROR_CODES.PROVIDER_KEY_MISSING,
    );
  }
  const overridden = activeId !== hint.provider;
  const modelId = overridden ? cfg.activeModel : hint.modelId;
  return {
    model: { provider: activeId, modelId },
    baseUrl: entry.baseUrl,
    wire: entry.wire,
    httpHeaders: entry.httpHeaders,
    queryParams: entry.queryParams,
    reasoningLevel: entry.reasoningLevel,
    allowKeyless,
    overridden,
  };
}
