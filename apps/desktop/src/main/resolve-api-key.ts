import { CHATGPT_CODEX_PROVIDER_ID, CodesignError, ERROR_CODES } from '@open-codesign/shared';

/**
 * Abstract dependencies of `resolveActiveApiKey` so unit tests can stub the
 * codex token store and the onboarding API-key reader without pulling in the
 * full main-process singleton graph (electron, logger, SQLite, …).
 */
export interface ResolveActiveApiKeyDeps {
  /** Returns a fresh ChatGPT OAuth bearer token. Throws when not signed in. */
  getCodexAccessToken: () => Promise<string>;
  /** Returns the stored API key for the given provider. Throws when missing. */
  getApiKeyForProvider: (providerId: string) => string;
}

/**
 * Resolve the bearer credential for the active provider.
 *
 * For ChatGPT subscription (OAuth), reads from the codex token store — which
 * auto-refreshes within its 5-min buffer. A missing / expired login surfaces
 * as `CodesignError(PROVIDER_AUTH_MISSING)` so the renderer's error-code
 * routing matches the API-key-missing path.
 *
 * For all other providers, reads the stored API key and propagates any
 * underlying error as a `CodesignError(PROVIDER_AUTH_MISSING)` with the
 * original attached as `cause`. Callers that support keyless endpoints
 * (Ollama, IP-whitelisted LiteLLM, etc.) are expected to gate this call on
 * `entry.requiresApiKey !== false` and fall back to an empty bearer
 * themselves; the helper never silently swallows a failure, so a keychain
 * corruption or missing secret always leaves a breadcrumb.
 */
export async function resolveActiveApiKey(
  providerId: string,
  deps: ResolveActiveApiKeyDeps,
): Promise<string> {
  if (providerId === CHATGPT_CODEX_PROVIDER_ID) {
    try {
      return await deps.getCodexAccessToken();
    } catch (err) {
      throw new CodesignError(
        err instanceof Error ? err.message : 'ChatGPT subscription not signed in',
        ERROR_CODES.PROVIDER_AUTH_MISSING,
        { cause: err },
      );
    }
  }
  try {
    return deps.getApiKeyForProvider(providerId);
  } catch (err) {
    if (err instanceof CodesignError) throw err;
    throw new CodesignError(
      err instanceof Error ? err.message : `Failed to read API key for provider "${providerId}"`,
      ERROR_CODES.PROVIDER_AUTH_MISSING,
      { cause: err },
    );
  }
}

/**
 * Wrap `resolveActiveApiKey` with the keyless-fallback rule every IPC handler
 * wants: Ollama / IP-gated LiteLLM proxies (providers with
 * `requiresApiKey: false`) may run with an empty bearer, so a missing-
 * credential error from the resolver is swallowed only when `allowKeyless`
 * is true AND the provider is not the ChatGPT subscription (codex must
 * always surface a structured auth error so the renderer shows the
 * sign-in-again affordance).
 *
 * Both `PROVIDER_KEY_MISSING` (raised by `getApiKeyForProvider` when no
 * secret is stored) and `PROVIDER_AUTH_MISSING` (raised by the resolver
 * when it wraps an arbitrary read failure) count as missing-credential
 * errors. Any other failure (codex logout surfacing a different code, a
 * downstream shim error) rethrows verbatim.
 */
export async function resolveApiKeyWithKeylessFallback(
  providerId: string,
  allowKeyless: boolean,
  deps: ResolveActiveApiKeyDeps,
): Promise<string> {
  try {
    return await resolveActiveApiKey(providerId, deps);
  } catch (err) {
    if (
      allowKeyless &&
      providerId !== CHATGPT_CODEX_PROVIDER_ID &&
      err instanceof CodesignError &&
      (err.code === ERROR_CODES.PROVIDER_AUTH_MISSING ||
        err.code === ERROR_CODES.PROVIDER_KEY_MISSING)
    ) {
      return '';
    }
    throw err;
  }
}
