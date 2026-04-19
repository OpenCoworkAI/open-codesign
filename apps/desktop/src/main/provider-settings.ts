import {
  CodesignError,
  type Config,
  type ModelRef,
  PROVIDER_SHORTLIST,
  type SupportedOnboardingProvider,
  isSupportedOnboardingProvider,
} from '@open-codesign/shared';

export interface ProviderRow {
  provider: SupportedOnboardingProvider;
  maskedKey: string;
  baseUrl: string | null;
  isActive: boolean;
  error?: 'decryption_failed' | string;
}

export function maskKey(plain: string): string {
  if (plain.length <= 8) return '***';
  const prefix = plain.startsWith('sk-') ? 'sk-' : plain.slice(0, 4);
  const suffix = plain.slice(-4);
  return `${prefix}***${suffix}`;
}

export function getAddProviderDefaults(
  cfg: Config | null,
  input: {
    provider: SupportedOnboardingProvider;
    modelPrimary: string;
  },
): {
  activeProvider: SupportedOnboardingProvider;
  modelPrimary: string;
} {
  if (
    cfg === null ||
    !isSupportedOnboardingProvider(cfg.provider) ||
    cfg.secrets[cfg.provider] === undefined
  ) {
    return {
      activeProvider: input.provider,
      modelPrimary: input.modelPrimary,
    };
  }
  const activeProvider: SupportedOnboardingProvider = cfg.provider;

  return {
    activeProvider,
    modelPrimary: cfg.modelPrimary,
  };
}

export function assertProviderHasStoredSecret(
  cfg: Config,
  provider: SupportedOnboardingProvider,
): void {
  if (cfg.secrets[provider] !== undefined) return;
  throw new CodesignError(`No API key stored for provider "${provider}".`, 'PROVIDER_KEY_MISSING');
}

export function toProviderRows(
  cfg: Config | null,
  decrypt: (ciphertext: string) => string,
): ProviderRow[] {
  if (cfg === null) return [];

  const rows: ProviderRow[] = [];
  for (const [provider, ref] of Object.entries(cfg.secrets)) {
    if (!isSupportedOnboardingProvider(provider) || ref === undefined) continue;
    const supportedProvider: SupportedOnboardingProvider = provider;

    let maskedKey: string;
    let rowError: ProviderRow['error'];
    try {
      const plain = decrypt(ref.ciphertext);
      maskedKey = maskKey(plain);
    } catch {
      // Surface decryption failure to the UI instead of silently masking or hard-crashing.
      maskedKey = '';
      rowError = 'decryption_failed';
    }

    rows.push({
      provider: supportedProvider,
      maskedKey,
      baseUrl: cfg.baseUrls?.[supportedProvider]?.baseUrl ?? null,
      isActive: cfg.provider === supportedProvider,
      ...(rowError !== undefined ? { error: rowError } : {}),
    });
  }

  return rows;
}

export interface DeleteProviderResult {
  /** null means tombstone: all providers removed, onboarding should re-run. */
  nextActive: SupportedOnboardingProvider | null;
  modelPrimary: string;
}

/**
 * Pure helper: given the current config and the provider to remove, computes
 * what the next active provider and model values should be.
 * Extracted for unit-testability without Electron IPC.
 */
export function computeDeleteProviderResult(
  cfg: Config,
  toDelete: SupportedOnboardingProvider,
): DeleteProviderResult {
  const remaining = Object.keys(cfg.secrets)
    .filter((p) => p !== toDelete)
    .filter(isSupportedOnboardingProvider);

  if (remaining.length === 0) {
    return { nextActive: null, modelPrimary: '' };
  }

  const keepCurrent = cfg.provider !== toDelete && isSupportedOnboardingProvider(cfg.provider);
  const nextActive: SupportedOnboardingProvider = keepCurrent
    ? (cfg.provider as SupportedOnboardingProvider)
    : (remaining[0] as SupportedOnboardingProvider);

  if (cfg.provider === toDelete) {
    const defaults = PROVIDER_SHORTLIST[nextActive];
    return {
      nextActive,
      modelPrimary: defaults.defaultPrimary,
    };
  }

  return { nextActive, modelPrimary: cfg.modelPrimary };
}

/**
 * Result of resolving which provider/model to call against, given the canonical
 * cached config and the renderer's hint payload.
 *
 * Why this exists: the renderer keeps its own copy of `cfg.provider` /
 * `cfg.modelPrimary` in the Zustand store and forwards them in
 * `GeneratePayloadV1.model`. If that copy drifts (settings IPC succeeds in
 * main but the store mutation is missed, or a second window is open), the
 * generate handler would silently call a different provider than what the
 * Settings UI shows as Active. We treat the renderer payload as a hint and
 * always snap back to the canonical active provider in `cachedConfig`, which
 * is the SAME source `toProviderRows` uses to render the Active badge.
 */
export interface ActiveModelResolution {
  model: ModelRef;
  baseUrl: string | null;
  /** True when the renderer-supplied hint provider didn't match the canonical active. */
  overridden: boolean;
}

export function resolveActiveModel(
  cfg: Config,
  hint: { provider: string; modelId: string },
): ActiveModelResolution {
  if (!isSupportedOnboardingProvider(cfg.provider)) {
    throw new CodesignError(
      `Active provider "${cfg.provider}" is not in the onboarding shortlist.`,
      'PROVIDER_NOT_SUPPORTED',
    );
  }
  if (cfg.secrets[cfg.provider] === undefined) {
    throw new CodesignError(
      `No API key stored for active provider "${cfg.provider}". Re-run onboarding to add one.`,
      'PROVIDER_KEY_MISSING',
    );
  }
  const overridden = cfg.provider !== hint.provider;
  // When the hint's provider doesn't match active, snap to the active
  // provider's primary model to keep the call coherent.
  const modelId = overridden ? cfg.modelPrimary : hint.modelId;
  return {
    model: { provider: cfg.provider, modelId },
    baseUrl: cfg.baseUrls?.[cfg.provider]?.baseUrl ?? null,
    overridden,
  };
}
