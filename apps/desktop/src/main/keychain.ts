import { CodesignError, type Config, ERROR_CODES, type SecretRef } from '@open-codesign/shared';
import { safeStorage } from './electron-runtime';
import { getLogger } from './logger';

const ENCRYPTED_PREFIX = 'safe:';
const PLAIN_PREFIX = 'plain:';
const logger = getLogger('keychain');

/**
 * Electron reports encryption as available for the Linux "basic_text" backend,
 * but that backend uses a hardcoded key and does not protect secrets at rest.
 * Fail closed on write for that backend; existing rows remain readable so users
 * can migrate once a real Secret Service provider is available.
 */
function isInsecureStorageBackend(): boolean {
  const getter = (safeStorage as { getSelectedStorageBackend?: () => string })
    .getSelectedStorageBackend;
  if (typeof getter !== 'function') return false;
  try {
    return getter.call(safeStorage) === 'basic_text';
  } catch {
    return false;
  }
}

function assertEncryptionAvailableForStore(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new CodesignError(
      'OS keychain (secure storage) is not available. API keys cannot be stored. Finish installing the app (do not run from a mounted DMG) or enable your OS secret service, then try again.',
      ERROR_CODES.KEYCHAIN_UNAVAILABLE,
    );
  }
  if (isInsecureStorageBackend()) {
    throw new CodesignError(
      'OS keychain is using Electron basic_text backend, which does not protect API keys. Install a Secret Service provider (e.g. gnome-keyring or KWallet) and restart.',
      ERROR_CODES.KEYCHAIN_UNAVAILABLE,
    );
  }
}

export function encryptSecret(plaintext: string): string {
  if (plaintext.length === 0) {
    throw new CodesignError('Cannot store empty secret', ERROR_CODES.KEYCHAIN_EMPTY_INPUT);
  }
  assertEncryptionAvailableForStore();
  const ciphertext = safeStorage.encryptString(plaintext).toString('base64');
  return `${ENCRYPTED_PREFIX}${ciphertext}`;
}

export function decryptSecret(stored: string): string {
  if (stored.length === 0) {
    throw new CodesignError('Cannot read empty secret', ERROR_CODES.KEYCHAIN_EMPTY_INPUT);
  }
  const plaintext = stored.startsWith(ENCRYPTED_PREFIX)
    ? decryptSafeStorage(stored.slice(ENCRYPTED_PREFIX.length), 'encrypted')
    : stored.startsWith(PLAIN_PREFIX)
      ? stored.slice(PLAIN_PREFIX.length)
      : decryptSafeStorage(stored, 'legacy');
  if (plaintext.length === 0) {
    throw new CodesignError('Cannot read empty secret', ERROR_CODES.KEYCHAIN_EMPTY_INPUT);
  }
  return plaintext;
}

function decryptSafeStorage(base64: string, format: 'encrypted' | 'legacy'): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new CodesignError(
      `A ${format} API key was found but the OS keychain is unavailable. Please re-enter your API key in Settings.`,
      ERROR_CODES.KEYCHAIN_UNAVAILABLE,
    );
  }
  try {
    return safeStorage.decryptString(Buffer.from(base64, 'base64'));
  } catch (err) {
    throw new CodesignError(
      `Failed to decrypt a ${format} API key. Re-enter it in Settings, or replace the relevant config.toml secret with ciphertext = "plain:YOUR_API_KEY" using a fresh plaintext key, not the existing encrypted value.`,
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

function migrateSecretRef(ref: SecretRef): SecretRef | null {
  const isEncrypted = ref.ciphertext.startsWith(ENCRYPTED_PREFIX);
  const needsMask = ref.mask === undefined || ref.mask.length === 0;
  if (isEncrypted && !needsMask) return null;

  const plaintext = decryptSecret(ref.ciphertext);
  // Prefer upgrading plaintext rows when a real OS backend is available.
  // Skip encryptSecret when unavailable/insecure so migration stays non-blocking.
  const canUpgrade =
    safeStorage.isEncryptionAvailable() && !isEncrypted && !isInsecureStorageBackend();
  const nextCiphertext = canUpgrade ? encryptSecret(plaintext) : ref.ciphertext;

  return {
    ciphertext: nextCiphertext,
    mask: maskSecret(plaintext),
  };
}

export function migrateSecrets(cfg: Config): { config: Config; changed: boolean } {
  const secrets = cfg.secrets ?? {};
  const entries = Object.entries(secrets);
  if (entries.length === 0) return { config: cfg, changed: false };

  const nextSecrets: Record<string, SecretRef> = { ...secrets };
  let changed = false;
  for (const [provider, ref] of entries) {
    try {
      const migrated = migrateSecretRef(ref);
      if (migrated === null) continue;
      nextSecrets[provider] = migrated;
      changed = true;
    } catch {
      // Migration must not prevent users from opening Settings to repair a key.
      // Never log the exception: OS/adapter errors may contain credential data.
      logger.warn('keychain.migration.skipped', {
        provider,
        reason:
          'Stored credential could not be migrated; original value was preserved. Re-enter the key in Settings or repair its config.toml entry.',
      });
    }
  }
  return { config: { ...cfg, secrets: nextSecrets }, changed };
}
