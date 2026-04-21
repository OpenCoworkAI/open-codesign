import { CodesignError, type Config, ERROR_CODES, type SecretRef } from '@open-codesign/shared';
import { safeStorage } from './electron-runtime';

export function ensureKeychainAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new CodesignError(
      'OS keychain (safeStorage) is not available. Cannot persist API keys securely.',
      ERROR_CODES.KEYCHAIN_UNAVAILABLE,
    );
  }
}

export function encryptSecret(plaintext: string): string {
  ensureKeychainAvailable();
  if (plaintext.length === 0) {
    throw new CodesignError('Cannot encrypt empty secret', ERROR_CODES.KEYCHAIN_EMPTY_INPUT);
  }
  const buf = safeStorage.encryptString(plaintext);
  return buf.toString('base64');
}

export function decryptSecret(ciphertextBase64: string): string {
  ensureKeychainAvailable();
  if (ciphertextBase64.length === 0) {
    throw new CodesignError('Cannot decrypt empty ciphertext', ERROR_CODES.KEYCHAIN_EMPTY_INPUT);
  }
  const buf = Buffer.from(ciphertextBase64, 'base64');
  return safeStorage.decryptString(buf);
}

/**
 * Derive a display-safe mask for a secret — e.g. "sk-ant-***xyz9". Stored
 * alongside the ciphertext so Settings can render the provider row without
 * invoking `safeStorage.decryptString` (which prompts for the keychain
 * password on unsigned macOS builds).
 */
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 8) return '***';
  const prefix = plaintext.startsWith('sk-') ? 'sk-' : plaintext.slice(0, 4);
  const suffix = plaintext.slice(-4);
  return `${prefix}***${suffix}`;
}

/**
 * Convenience wrapper: encrypt a plaintext API key and return the full
 * `SecretRef` (ciphertext + mask) in one shot. Use this at every save site
 * so mask metadata is always written. Older configs missing `mask` are
 * migrated by `migrateSecretMasks` on first read.
 */
export function buildSecretRef(plaintext: string): SecretRef {
  return {
    ciphertext: encryptSecret(plaintext),
    mask: maskSecret(plaintext),
  };
}

/**
 * Non-throwing variant of `buildSecretRef` — returns `null` when safeStorage
 * is unavailable (unsigned macOS without keychain entitlements, Linux
 * without a secret-service daemon, etc.). Callers should skip persisting
 * the secret and surface a warning so the REST of the imported config
 * still lands; the user can re-add the key by hand once keychain is fixed.
 *
 * Only `KEYCHAIN_UNAVAILABLE` is caught — real unexpected errors still
 * propagate so they're not silently swallowed.
 */
export function tryBuildSecretRef(plaintext: string): SecretRef | null {
  try {
    return buildSecretRef(plaintext);
  } catch (err) {
    if (err instanceof CodesignError && err.code === ERROR_CODES.KEYCHAIN_UNAVAILABLE) {
      return null;
    }
    throw err;
  }
}

/**
 * One-shot migration: for any secret missing the `mask` field, decrypt it
 * once and populate the mask. Designed to run on config load — after this
 * pass, `toProviderRows` never touches safeStorage again. Returns the
 * migrated config plus a flag indicating whether anything changed (so the
 * caller can decide whether to persist).
 *
 * Each decrypt-for-migration triggers exactly one keychain prompt per
 * provider on unsigned macOS builds — unavoidable since we have to read
 * the plaintext once to derive the mask. This is a one-time cost; all
 * future launches read masks directly from disk.
 *
 * Robust to partial failures: if a single provider fails to decrypt (e.g.
 * keychain revoked access mid-migration), we leave that row's mask
 * unset and carry on with the rest.
 */
export function migrateSecretMasks(cfg: Config): { config: Config; changed: boolean } {
  const secrets = cfg.secrets ?? {};
  const entries = Object.entries(secrets);
  const needs = entries.filter(([, ref]) => ref.mask === undefined || ref.mask.length === 0);
  if (needs.length === 0) return { config: cfg, changed: false };

  const nextSecrets: Record<string, SecretRef> = { ...secrets };
  let changed = false;
  for (const [provider, ref] of needs) {
    try {
      const plain = decryptSecret(ref.ciphertext);
      nextSecrets[provider] = { ...ref, mask: maskSecret(plain) };
      changed = true;
    } catch {
      /* skip — row will retry on next boot or when user edits it */
    }
  }
  return { config: { ...cfg, secrets: nextSecrets }, changed };
}
