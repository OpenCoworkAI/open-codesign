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

export interface ResolveCredentialForProviderDeps extends ResolveActiveApiKeyDeps {
  /** True when config has a persisted secret row for this provider. */
  hasApiKeyForProvider: (providerId: string) => boolean;
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
 * original attached as `cause`. Keyless endpoints are handled by
 * `resolveCredentialForProvider`; this helper never suppresses a failure.
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
 * Resolve the bearer credential for an IPC handler.
 *
 * Keyless mode is explicit: providers with `requiresApiKey: false` may run
 * with an empty bearer only when there is no persisted secret row. If a secret
 * row exists, read it so keychain/plaintext corruption still surfaces. ChatGPT
 * subscription auth is never keyless.
 */
export async function resolveCredentialForProvider(
  providerId: string,
  allowKeyless: boolean,
  deps: ResolveCredentialForProviderDeps,
): Promise<string> {
  if (
    allowKeyless &&
    providerId !== CHATGPT_CODEX_PROVIDER_ID &&
    !deps.hasApiKeyForProvider(providerId)
  ) {
    return '';
  }
  return resolveActiveApiKey(providerId, deps);
}
