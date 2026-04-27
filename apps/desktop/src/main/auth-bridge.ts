import path from 'node:path';
import { AuthStorage, type ModelRegistry } from '@open-codesign/core';
import {
  CodesignError,
  type Config,
  ERROR_CODES,
  type ProviderEntry,
  resolveProviderCapabilities,
} from '@open-codesign/shared';
import { decryptSecret } from './keychain';

/**
 * Bridge our user-facing `config.toml` (BYOK provider entries + plaintext
 * secrets, see `keychain.ts`) into pi-coding-agent's `AuthStorage` and
 * `ModelRegistry`.
 *
 * Why two boundaries:
 *  - `AuthStorage` holds raw `{ type: 'api_key', key }` credentials that
 *    pi-ai uses when it builds a request. Built-in providers (anthropic /
 *    openai / openrouter) live entirely in pi's catalog; we only need to
 *    populate the credential.
 *  - `ModelRegistry.registerProvider()` is required for any provider that
 *    needs a custom `baseUrl` (gateways, proxies, importer-defined
 *    providers like ChatGPT-via-Codex), or for Ollama-style hosts.
 *
 * Both mutations are sync — `AuthStorage.set()` is sync per spike doc §6.
 */

export interface AuthBridgeOptions {
  /** Absolute path to electron `app.getPath('userData')`. */
  userDataPath: string;
  /** Parsed config (or null when the user has not run onboarding yet). */
  config: Config | null;
  /** Skip plaintext decryption (used by tests). */
  decrypt?: (stored: string) => string;
}

const BUILTIN_PROVIDER_IDS = new Set(['anthropic', 'openai', 'openrouter']);

export function createAppAuthStorage(opts: AuthBridgeOptions): AuthStorage {
  const authPath = path.join(opts.userDataPath, 'auth.json');
  const auth = AuthStorage.create(authPath);
  populateAuthStorage(auth, opts);
  return auth;
}

export function populateAuthStorage(auth: AuthStorage, opts: AuthBridgeOptions): void {
  if (!opts.config) return;
  const decrypt = opts.decrypt ?? decryptSecret;
  for (const [providerId, entry] of providersFromConfig(opts.config)) {
    const apiKey = readStoredCredential(opts.config, providerId, entry, decrypt);
    if (!apiKey) continue;
    auth.set(providerId, { type: 'api_key', key: apiKey });
  }
}

/**
 * Push every non-built-in provider entry into the model registry so its
 * baseUrl / wire / extra headers reach pi-ai.
 */
export function registerCustomProviders(
  registry: ModelRegistry,
  opts: AuthBridgeOptions,
): string[] {
  if (!opts.config) return [];
  const decrypt = opts.decrypt ?? decryptSecret;
  const registered: string[] = [];
  for (const [providerId, entry] of providersFromConfig(opts.config)) {
    if (BUILTIN_PROVIDER_IDS.has(providerId)) continue;
    const apiKey = readStoredCredential(opts.config, providerId, entry, decrypt);
    registry.registerProvider(providerId, {
      baseUrl: entry.baseUrl,
      ...(apiKey ? { apiKey } : {}),
      ...(entry.httpHeaders ? { headers: entry.httpHeaders } : {}),
    });
    registered.push(providerId);
  }
  return registered;
}

function providersFromConfig(config: Config): Array<[string, ProviderEntry]> {
  return Object.entries(config.providers);
}

function readStoredCredential(
  config: Config,
  providerId: string,
  entry: ProviderEntry,
  decrypt: (stored: string) => string,
): string | null {
  const ref = config.secrets[providerId];
  if (ref === undefined) {
    if (resolveProviderCapabilities(providerId, entry).supportsKeyless) return null;
    if (config.activeProvider === providerId) {
      throw new CodesignError(
        `No API key stored for active provider "${providerId}".`,
        ERROR_CODES.PROVIDER_KEY_MISSING,
      );
    }
    return null;
  }
  try {
    return decrypt(ref.ciphertext);
  } catch (err) {
    throw new CodesignError(
      `Failed to decrypt API key for provider "${providerId}".`,
      ERROR_CODES.PROVIDER_AUTH_MISSING,
      { cause: err },
    );
  }
}
