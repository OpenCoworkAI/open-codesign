import { CodesignError, type Config, ERROR_CODES, type SecretRef } from '@open-codesign/shared';
import { safeStorage } from './electron-runtime';
import { getLogger } from './logger';

/**
 * Secret storage is now plaintext-in-config.toml (mode 0600), matching
 * Claude Code / Codex / gh / aws / gcloud. safeStorage was removed because
 * unsigned macOS builds triggered a system keychain password prompt on
 * every decrypt — real UX tax for no real security gain (an attacker with
 * filesystem access could read the plaintext ciphertext either way).
 *
 * The file name stays `keychain.ts` to minimise churn across importers;
 * the module is now really a plaintext passthrough with one-shot legacy
 * migration (safeStorage ciphertext → plaintext on first boot after
 * upgrade).
 */

const log = getLogger('secret-store');

/** Prefix that marks a new-format (plaintext) stored secret. */
const PLAIN_PREFIX = 'plain:';

export function encryptSecret(plaintext: string): string {
  if (plaintext.length === 0) {
    throw new CodesignError('Cannot store empty secret', ERROR_CODES.KEYCHAIN_EMPTY_INPUT);
  }
  return `${PLAIN_PREFIX}${plaintext}`;
}

export function decryptSecret(stored: string): string {
  if (stored.length === 0) {
    throw new CodesignError('Cannot read empty secret', ERROR_CODES.KEYCHAIN_EMPTY_INPUT);
  }
  if (stored.startsWith(PLAIN_PREFIX)) {
    return stored.slice(PLAIN_PREFIX.length);
  }
  return decryptLegacy(stored);
}

/**
 * Legacy safeStorage fallback. Invoked only for secrets written by older
 * app versions that encrypted via Electron's `safeStorage`. On macOS this
 * will prompt for the keychain password the FIRST time it's called (and
 * only then — subsequent calls in the same process are served from
 * safeStorage's in-process key cache). After `migrateSecrets` rewrites the
 * config, this path is never hit again.
 */
function decryptLegacy(base64: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new CodesignError(
      'A legacy encrypted API key was found but the OS keychain is unavailable. Please re-enter your API key in Settings.',
      ERROR_CODES.KEYCHAIN_UNAVAILABLE,
    );
  }
  try {
    return safeStorage.decryptString(Buffer.from(base64, 'base64'));
  } catch (err) {
    throw new CodesignError(
      'Failed to decrypt a legacy API key. Please re-enter your API key in Settings.',
      ERROR_CODES.KEYCHAIN_UNAVAILABLE,
      { cause: err },
    );
  }
}

export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 8) return '***';
  const prefix = plaintext.startsWith('sk-') ? 'sk-' : plaintext.slice(0, 4);
  const suffix = plaintext.slice(-4);
  return `${prefix}***${suffix}`;
}

export function buildSecretRef(plaintext: string): SecretRef {
  return {
    ciphertext: encryptSecret(plaintext),
    mask: maskSecret(plaintext),
  };
}

/**
 * One-shot migration run on boot:
 *   1. Any secret stored in legacy safeStorage base64 format → decrypt
 *      once (last keychain prompt ever) → rewrite as `plain:<apikey>`.
 *   2. Any plaintext secret missing its display `mask` → fill it.
 *
 * Idempotent. Partial failures (a single row that can't be decrypted)
 * leave that row untouched so the rest of the migration can land; the
 * user can re-enter that key from Settings.
 */
export function migrateSecrets(cfg: Config): { config: Config; changed: boolean } {
  const secrets = cfg.secrets ?? {};
  const entries = Object.entries(secrets);
  if (entries.length === 0) return { config: cfg, changed: false };

  const nextSecrets: Record<string, SecretRef> = { ...secrets };
  let changed = false;
  for (const [provider, ref] of entries) {
    const isLegacy = !ref.ciphertext.startsWith(PLAIN_PREFIX);
    const needsMask = ref.mask === undefined || ref.mask.length === 0;
    if (!isLegacy && !needsMask) continue;

    let plaintext: string;
    if (isLegacy) {
      try {
        plaintext = decryptLegacy(ref.ciphertext);
      } catch (err) {
        log.warn('secret.migration.decrypt_failed', {
          provider,
          err: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
    } else {
      plaintext = ref.ciphertext.slice(PLAIN_PREFIX.length);
    }

    nextSecrets[provider] = {
      ciphertext: `${PLAIN_PREFIX}${plaintext}`,
      mask: maskSecret(plaintext),
    };
    changed = true;
  }
  return { config: { ...cfg, secrets: nextSecrets }, changed };
}
