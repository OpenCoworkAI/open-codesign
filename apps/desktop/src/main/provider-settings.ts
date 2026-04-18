import {
  CodesignError,
  type Config,
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
    modelFast: string;
  },
): {
  activeProvider: SupportedOnboardingProvider;
  modelPrimary: string;
  modelFast: string;
} {
  if (
    cfg === null ||
    !isSupportedOnboardingProvider(cfg.provider) ||
    cfg.secrets[cfg.provider] === undefined
  ) {
    return {
      activeProvider: input.provider,
      modelPrimary: input.modelPrimary,
      modelFast: input.modelFast,
    };
  }
  const activeProvider: SupportedOnboardingProvider = cfg.provider;

  return {
    activeProvider,
    modelPrimary: cfg.modelPrimary,
    modelFast: cfg.modelFast,
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
