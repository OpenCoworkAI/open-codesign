import path from 'node:path';
import { AuthStorage, type ModelRegistry } from '@open-codesign/core';
import type { Config, ProviderEntry } from '@open-codesign/shared';
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
    const apiKey = readPlaintextKey(entry, decrypt);
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
    const apiKey = readPlaintextKey(entry, decrypt);
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
  const providers = (config as Config & { providers?: Record<string, ProviderEntry> }).providers;
  if (!providers) return [];
  return Object.entries(providers);
}

function readPlaintextKey(
  entry: ProviderEntry,
  decrypt: (stored: string) => string,
): string | null {
  const raw = (entry as ProviderEntry & { apiKey?: { value?: string } | null }).apiKey;
  if (!raw || typeof raw.value !== 'string' || raw.value.length === 0) return null;
  try {
    return decrypt(raw.value);
  } catch {
    // a corrupt secret blocks the key but should not crash boot — main can
    // still surface a settings error elsewhere
    return null;
  }
}
