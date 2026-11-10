/**
 * Web search routing — pure capability resolution shared by main + renderer.
 *
 * The router answers one question: *for the currently configured provider,
 * which web-search capability should the agent use?* It never performs I/O
 * and never reads credentials; it only inspects the config that is already
 * in memory. Callers translate a route into an actual network call.
 *
 * Security rules encoded here:
 *   - Only the provider's *official* HTTPS origin is trusted. Gateways,
 *     proxy paths, coding endpoints (`/api/coding/...`), nondefault ports,
 *     embedded user/password, query strings, hashes, and any unexpected
 *     path suffix are rejected outright.
 *   - Model support is decided by explicit ID lists, never by a broad
 *     family regex (`gpt-*`, `claude-*`). A future model that happens to
 *     share a prefix must not silently gain native search.
 *   - Codex OAuth (`openai-codex-responses`) never routes to native search:
 *     that wire speaks the ChatGPT subscription API, not the public one.
 */

import { z } from 'zod';
import type { Config } from './config';

// ── Enums + types ────────────────────────────────────────────────────────────

/** How the user asked us to choose a backend. `auto` may fall back at
 *  selection time; `provider` never does. */
export const WebSearchBackendSchema = z.enum(['auto', 'provider', 'tavily']);
export type WebSearchBackend = z.infer<typeof WebSearchBackendSchema>;

/** Downstream search capability. `tavily` is the standalone vendor API; the
 *  rest are inherited from the configured provider. */
export const WebSearchServiceSchema = z.enum([
  'tavily',
  'deepseek',
  'kimi',
  'zhipu',
  'openai',
  'anthropic',
]);
export type WebSearchService = z.infer<typeof WebSearchServiceSchema>;

/** Transport a resolved service uses. `search-api` is an explicit HTTP call
 *  to the service's search endpoint; `native-tool` hands a provider-side
 *  tool to the model on the normal inference request. */
export type WebSearchMode = 'search-api' | 'native-tool';

/** Why a route could not be resolved. `null` means the route is usable. */
export type WebSearchUnavailableReason =
  | 'missing-key'
  | 'unsupported-provider'
  | 'native-disabled'
  | 'unsupported-model';

export interface WebSearchRoute {
  service: WebSearchService | null;
  mode: WebSearchMode | null;
  /** Provider id the service was inherited from; null for standalone Tavily. */
  providerId: string | null;
  /** Absolute HTTPS endpoint for `search-api` routes; null otherwise. */
  endpoint: string | null;
  reason: WebSearchUnavailableReason | null;
}

// ── Official origins ─────────────────────────────────────────────────────────

const DEEPSEEK_ORIGIN = 'https://api.deepseek.com';
const KIMI_ORIGIN = 'https://api.moonshot.cn';
const ZHIPU_ORIGIN = 'https://open.bigmodel.cn';
const OPENAI_ORIGIN = 'https://api.openai.com';
const ANTHROPIC_ORIGIN = 'https://api.anthropic.com';

/**
 * Parse a base URL under strict "official endpoint" rules. Returns null for
 * anything that is not a plain HTTPS URL with no credentials, no query/hash,
 * no nondefault port, and no path traversal trickery.
 */
function parseOfficialUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  // `https://` implies port 443; anything else (explicit or implicit) is a
  // custom port we refuse to trust for credential-bearing requests.
  if (url.port !== '') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.search !== '' || url.hash !== '') return null;
  // Reject percent-encoding / dot-segments / doubled slashes in the path:
  // they are never part of a documented official endpoint.
  if (/%|\/\.\.?($|\/)|^\/\//.test(url.pathname)) return null;
  return url;
}

function segmentsOf(pathname: string): string[] {
  return pathname.split('/').filter((segment) => segment.length > 0);
}

function sameSegments(actual: string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((s, i) => s === expected[i]);
}

/** `root`, `root/v1`, or both accepted. Anything else means "unknown path". */
function matchesRootOrV1(actual: string[]): boolean {
  return actual.length === 0 || sameSegments(actual, ['v1']);
}

// ── Model allow-lists ─────────────────────────────────────────────────────────

/** Explicit native-search-capable OpenAI model IDs. Deliberately closed:
 *  add new IDs here after verifying the provider actually supports the tool. */
export const OPENAI_NATIVE_WEB_SEARCH_MODELS: readonly string[] = Object.freeze([
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-5.4',
  'gpt-5.5',
  'gpt-6-astra',
]);

/** Explicit native-search-capable Anthropic model IDs. */
export const ANTHROPIC_NATIVE_WEB_SEARCH_MODELS: readonly string[] = Object.freeze([
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-opus-5-5',
]);

function hasStoredKey(config: Config, providerId: string): boolean {
  const ref = config.secrets?.[providerId];
  return ref !== undefined && typeof ref.ciphertext === 'string' && ref.ciphertext.length > 0;
}

// ── Resolution ───────────────────────────────────────────────────────────────

/** Route for an inherited search-API provider, or null when the provider's
 *  base URL is not one of the recognised official endpoints. */
function resolveSearchApiRoute(config: Config): WebSearchRoute | null {
  const providerId = config.activeProvider;
  const entry = config.providers?.[providerId];
  if (entry === undefined || providerId.length === 0 || entry.wire === 'openai-codex-responses')
    return null;
  const url = parseOfficialUrl(entry.baseUrl);
  if (url === null) return null;
  const segments = segmentsOf(url.pathname);
  const unavailable = (reason: WebSearchUnavailableReason): WebSearchRoute => ({
    service: null,
    mode: null,
    providerId,
    endpoint: null,
    reason,
  });

  // DeepSeek — https://api.deepseek.com, https://api.deepseek.com/v1
  if (url.origin === DEEPSEEK_ORIGIN && matchesRootOrV1(segments)) {
    if (!hasStoredKey(config, providerId)) return unavailable('missing-key');
    return {
      service: 'deepseek',
      mode: 'search-api',
      providerId,
      endpoint: `${DEEPSEEK_ORIGIN}/v1/tools/search`,
      reason: null,
    };
  }

  // Kimi / Moonshot — https://api.moonshot.cn, https://api.moonshot.cn/v1
  if (url.origin === KIMI_ORIGIN && matchesRootOrV1(segments)) {
    if (!hasStoredKey(config, providerId)) return unavailable('missing-key');
    return {
      service: 'kimi',
      mode: 'search-api',
      providerId,
      endpoint: `${KIMI_ORIGIN}/v1/tools/search_pro`,
      reason: null,
    };
  }

  // Zhipu / GLM — https://open.bigmodel.cn/api/paas/v4 only. The
  // `/api/coding/paas/v4` variant is a coding plan and is not eligible.
  if (url.origin === ZHIPU_ORIGIN && sameSegments(segments, ['api', 'paas', 'v4'])) {
    if (!hasStoredKey(config, providerId)) return unavailable('missing-key');
    return {
      service: 'zhipu',
      mode: 'search-api',
      providerId,
      endpoint: `${ZHIPU_ORIGIN}/api/paas/v4/web_search`,
      reason: null,
    };
  }

  return null;
}

function resolveNativeRoute(config: Config): WebSearchRoute | null {
  const providerId = config.activeProvider;
  const entry = config.providers?.[providerId];
  if (entry === undefined || providerId.length === 0) return null;
  const url = parseOfficialUrl(entry.baseUrl);
  if (url === null) return null;
  const segments = segmentsOf(url.pathname);
  const model = config.activeModel;
  const nativeEnabled = config.webSearch?.nativeEnabled === true;
  const unavailable = (reason: WebSearchUnavailableReason): WebSearchRoute => ({
    service: null,
    mode: null,
    providerId,
    endpoint: null,
    reason,
  });

  // Codex OAuth speaks the ChatGPT subscription API; never route it here.
  const isOpenAiWire = entry.wire === 'openai-responses';
  const isAnthropicWire = entry.wire === 'anthropic';

  if (url.origin === OPENAI_ORIGIN && isOpenAiWire && sameSegments(segments, ['v1'])) {
    if (!nativeEnabled) return unavailable('native-disabled');
    if (!hasStoredKey(config, providerId)) return unavailable('missing-key');
    if (!OPENAI_NATIVE_WEB_SEARCH_MODELS.includes(model)) return unavailable('unsupported-model');
    return {
      service: 'openai',
      mode: 'native-tool',
      providerId,
      endpoint: null,
      reason: null,
    };
  }

  if (url.origin === ANTHROPIC_ORIGIN && isAnthropicWire && matchesRootOrV1(segments)) {
    if (!nativeEnabled) return unavailable('native-disabled');
    if (!hasStoredKey(config, providerId)) return unavailable('missing-key');
    if (!ANTHROPIC_NATIVE_WEB_SEARCH_MODELS.includes(model)) {
      return unavailable('unsupported-model');
    }
    return {
      service: 'anthropic',
      mode: 'native-tool',
      providerId,
      endpoint: null,
      reason: null,
    };
  }

  return null;
}

/**
 * Resolve the effective web-search route for `config`.
 *
 * Backend semantics:
 *   - `webSearch` entirely absent  → `auto` (fresh install).
 *   - `webSearch` present, `backend` absent → `tavily` (legacy behaviour).
 *   - `backend: 'provider'` → inherit from the active provider. Never falls
 *     back to Tavily.
 *   - `backend: 'tavily'` → standalone Tavily, never inherits.
 *   - `backend: 'auto'` → prefer a usable provider capability, else fall back
 *     to a stored Tavily key. Fallback happens here, at selection time only.
 *
 * `webSearch.enabled` is intentionally ignored: it gates whether the agent
 * *asks* for search, not whether the capability exists. Settings needs the
 * latter to render an accurate state while search is switched off.
 */
export function resolveWebSearchRoute(config: Config | null | undefined): WebSearchRoute {
  const unavailable = (reason: WebSearchUnavailableReason): WebSearchRoute => ({
    service: null,
    mode: null,
    providerId: null,
    endpoint: null,
    reason,
  });

  if (config === null || config === undefined) return unavailable('missing-key');

  const backend: WebSearchBackend =
    config.webSearch?.backend ?? (config.webSearch === undefined ? 'auto' : 'tavily');

  const tavilyRoute = (): WebSearchRoute => {
    if (!hasStoredKey(config, 'tavily')) return unavailable('missing-key');
    return {
      service: 'tavily',
      mode: 'search-api',
      providerId: null,
      endpoint: null,
      reason: null,
    };
  };

  if (backend === 'tavily') return tavilyRoute();

  // Resolve once before authorization; failures during execution never change services.
  const native = resolveNativeRoute(config);
  const searchApi = resolveSearchApiRoute(config);
  const candidate =
    native?.reason === 'native-disabled' ? (searchApi ?? native) : (native ?? searchApi);
  if (candidate?.reason === null) return candidate;

  if (backend === 'auto') {
    const tavily = tavilyRoute();
    if (tavily.reason === null) return tavily;
    if (!candidate && !config.activeProvider) return tavily;
  }

  // Report a native-disabled route when that is the real reason (the
  // provider *can* provide native search, the user just hasn't opted in).
  // Anything else means the active provider is not an eligible search host.
  return candidate ?? unavailable('unsupported-provider');
}
