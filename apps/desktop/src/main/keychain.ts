import { CodesignError, type Config, ERROR_CODES, type SecretRef } from '@open-codesign/shared';
import { safeStorage } from './electron-runtime';
import { getLogger } from './logger';

const ENCRYPTED_PREFIX = 'safe:';
const PLAIN_PREFIX = 'plain:';
const logger = getLogger('keychain');

let warnedPlaintextFallback = false;

function warnPlaintextFallback(): void {
  if (warnedPlaintextFallback) return;
  warnedPlaintextFallback = true;
  logger.warn('keychain.safeStorage.unavailable_plaintext_fallback');
}

export function encryptSecret(plaintext: string): string {
  if (plaintext.length === 0) {
    throw new CodesignError('Cannot store empty secret', ERROR_CODES.KEYCHAIN_EMPTY_INPUT);
  }
  if (safeStorage.isEncryptionAvailable()) {
    const ciphertext = safeStorage.encryptString(plaintext).toString('base64');
    return `${ENCRYPTED_PREFIX}${ciphertext}`;
  }
  warnPlaintextFallback();
  return `${PLAIN_PREFIX}${plaintext}`;
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
      `Failed to decrypt a ${format} API key. Please re-enter your API key in Settings.`,
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
  const nextCiphertext =
    safeStorage.isEncryptionAvailable() && !isEncrypted ? encryptSecret(plaintext) : ref.ciphertext;

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
    const migrated = migrateSecretRef(ref);
    if (migrated === null) continue;
    nextSecrets[provider] = migrated;
    changed = true;
  }
  return { config: { ...cfg, secrets: nextSecrets }, changed };
}
