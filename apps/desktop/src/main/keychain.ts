import { CodesignError } from '@open-codesign/shared';
import { safeStorage } from 'electron';

export function ensureKeychainAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new CodesignError(
      'OS keychain (safeStorage) is not available. Cannot persist API keys securely.',
      'KEYCHAIN_UNAVAILABLE',
    );
  }
}

export function encryptSecret(plaintext: string): string {
  ensureKeychainAvailable();
  if (plaintext.length === 0) {
    throw new CodesignError('Cannot encrypt empty secret', 'KEYCHAIN_EMPTY_INPUT');
  }
  const buf = safeStorage.encryptString(plaintext);
  return buf.toString('base64');
}

export function decryptSecret(ciphertextBase64: string): string {
  ensureKeychainAvailable();
  if (ciphertextBase64.length === 0) {
    throw new CodesignError('Cannot decrypt empty ciphertext', 'KEYCHAIN_EMPTY_INPUT');
  }
  const buf = Buffer.from(ciphertextBase64, 'base64');
  return safeStorage.decryptString(buf);
}
