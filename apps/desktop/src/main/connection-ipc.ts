import { createHash } from 'node:crypto';
import {
  BUILTIN_PROVIDERS,
  CodesignError,
  ERROR_CODES,
  type SupportedOnboardingProvider,
  type WireApi,
  canonicalBaseUrl,
  ensureVersionedBase,
  isSupportedOnboardingProvider,
  stripInferenceEndpointSuffix,
} from '@open-codesign/shared';
import { buildAuthHeaders, buildAuthHeadersForWire } from './auth-headers';
import { ipcMain } from './electron-runtime';
import { getApiKeyForProvider, getCachedConfig } from './onboarding-ipc';
import { isKeylessProviderAllowed } from './provider-settings';

// Re-export so existing importers (tests, other main-process modules) keep
// working after the helpers moved to `./auth-headers` to break a circular
// import between connection-ipc and onboarding-ipc.
export { buildAuthHeaders, buildAuthHeadersForWire } from './auth-headers';

// ---------------------------------------------------------------------------
// Payload schemas (plain validation, no zod in main to keep bundle lean)
// ---------------------------------------------------------------------------

interface ConnectionTestPayloadV1 {
  provider: SupportedOnboardingProvider;
  apiKey: string;
  baseUrl: string;
}

interface ModelsListPayloadV1 {
  provider: SupportedOnboardingProvider;
  apiKey: string;
  baseUrl: string;
}

export interface ConnectionTestResult {
  ok: true;
}

export interface ConnectionTestError {
  ok: false;
  code: 'IPC_BAD_INPUT' | '401' | '404' | 'ECONNREFUSED' | 'NETWORK' | 'PARSE';
  message: string;
  hint: string;
}

export type ConnectionTestResponse = ConnectionTestResult | ConnectionTestError;

export type ModelsListResponse =
  | { ok: true; models: string[] }
  | {
      ok: false;
      code: 'IPC_BAD_INPUT' | 'NETWORK' | 'HTTP' | 'PARSE';
      message: string;
      hint: string;
    };

function parseConnectionTestPayload(raw: unknown): ConnectionTestPayloadV1 {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError(
      'connection:v1:test expects an object payload',
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  const r = raw as Record<string, unknown>;
  if (typeof r['provider'] !== 'string' || !isSupportedOnboardingProvider(r['provider'])) {
    throw new CodesignError(
      `Unsupported provider: ${String(r['provider'])}`,
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  if (typeof r['apiKey'] !== 'string') {
    throw new CodesignError('apiKey must be a string', ERROR_CODES.IPC_BAD_INPUT);
  }
  // Keyless builtins (Ollama) legitimately send an empty apiKey from the
  // onboarding form. Non-keyless providers still require a non-empty key.
  const provider = r['provider'] as SupportedOnboardingProvider;
  const apiKey = r['apiKey'].trim();
  if (apiKey.length === 0 && BUILTIN_PROVIDERS[provider].requiresApiKey !== false) {
    throw new CodesignError('apiKey must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof r['baseUrl'] !== 'string' || r['baseUrl'].trim().length === 0) {
    throw new CodesignError('baseUrl must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  return {
    provider,
    apiKey,
    baseUrl: r['baseUrl'].trim(),
  };
}

function parseModelsListPayload(raw: unknown): ModelsListPayloadV1 {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('models:v1:list expects an object payload', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  if (typeof r['provider'] !== 'string' || !isSupportedOnboardingProvider(r['provider'])) {
    throw new CodesignError(
      `Unsupported provider: ${String(r['provider'])}`,
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  if (typeof r['apiKey'] !== 'string') {
    throw new CodesignError('apiKey must be a string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const provider = r['provider'] as SupportedOnboardingProvider;
  const apiKey = r['apiKey'].trim();
  if (apiKey.length === 0 && BUILTIN_PROVIDERS[provider].requiresApiKey !== false) {
    throw new CodesignError('apiKey must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof r['baseUrl'] !== 'string' || r['baseUrl'].trim().length === 0) {
    throw new CodesignError('baseUrl must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  return {
    provider,
    apiKey,
    baseUrl: r['baseUrl'].trim(),
  };
}

// ---------------------------------------------------------------------------
// Models endpoint construction
// ---------------------------------------------------------------------------

interface ProviderEndpoint {
  url: string;
  headers: Record<string, string>;
}

/**
 * Normalize a user-supplied baseUrl to the root form each provider expects,
 * so downstream path concatenation never produces duplicate segments.
 *
 * - anthropic: strip trailing /v1 — we append /v1/models internally
 * - openai / openrouter: ensure a version segment exists — the API lives at
 *   <root>/<version>/models (usually /v1, but Zhipu uses /v4, Volcengine
 *   uses /v3, Google AI Studio uses /v1beta/openai). If the user already
 *   encoded a version we trust it; otherwise we default to /v1.
 * - google: strip trailing /v1 or /v1beta — we append the full path internally
 */
export function normalizeBaseUrl(
  baseUrl: string,
  provider: 'openai' | 'anthropic' | 'google' | 'openrouter',
): string {
  const cleaned = stripInferenceEndpointSuffix(baseUrl);
  if (provider === 'openai' || provider === 'openrouter') {
    return ensureVersionedBase(cleaned);
  }
  if (provider === 'anthropic') {
    return cleaned.replace(/\/v1$/, '');
  }
  if (provider === 'google') {
    return cleaned.replace(/\/v1(beta)?$/, '');
  }
  return cleaned;
}

/**
 * Wire-level test endpoint — used by the custom-provider Add form AND by
 * the existing builtin `connection:v1:test`. Unlike `buildModelsEndpoint`,
 * this signature takes the wire directly and adds any static headers a
 * gateway requires.
 */
function buildEndpointForWire(
  wire: WireApi,
  baseUrl: string,
): { url: string; normalizedBaseUrl: string } {
  const normalizedBaseUrl = canonicalBaseUrl(baseUrl, wire);
  const url =
    wire === 'anthropic' ? `${normalizedBaseUrl}/v1/models` : `${normalizedBaseUrl}/models`;
  return { url, normalizedBaseUrl };
}

function buildModelsEndpoint(
  provider: SupportedOnboardingProvider,
  baseUrl: string,
): ProviderEndpoint {
  const wire: WireApi = provider === 'anthropic' ? 'anthropic' : 'openai-chat';
  const { url } = buildEndpointForWire(wire, baseUrl);
  return { url, headers: {} };
}

export function classifyHttpError(status: number): {
  code: ConnectionTestError['code'];
  hint: string;
} {
  if (status === 401 || status === 403) {
    return { code: '401', hint: 'API key 错误或权限不足' };
  }
  if (status === 404) {
    return {
      code: '404',
      hint: 'baseUrl 路径错误。OpenAI 兼容代理通常需要 /v1 后缀（试试 https://your-host/v1）',
    };
  }
  return { code: 'NETWORK', hint: `服务器返回 HTTP ${status}` };
}

function classifyNetworkError(err: unknown): { code: ConnectionTestError['code']; hint: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof Error && err.name === 'AbortError') {
    return {
      code: 'NETWORK',
      hint: `请求超时（>${CONNECTION_FETCH_TIMEOUT_MS / 1000}s），检查 baseUrl 与网络可达性`,
    };
  }
  if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
    return {
      code: 'ECONNREFUSED',
      hint: '无法连接到 baseUrl，检查域名 / 端口 / 网络',
    };
  }
  if (message.includes('CORS') || message.includes('cross-origin')) {
    return {
      code: 'NETWORK',
      hint: '跨域错误（理论上 main 端 fetch 不该有，看日志）',
    };
  }
  return {
    code: 'NETWORK',
    hint: `网络错误：${message}。查看日志：~/Library/Logs/open-codesign/main.log`,
  };
}

// Provider /models endpoints normally return in <1s. Anything past 10s means the
// host is unreachable or stuck — better to surface a clear NETWORK error than to
// pin the renderer's "Test connection" spinner forever.
export const CONNECTION_FETCH_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = CONNECTION_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function extractIds(items: unknown[]): string[] | null {
  const ids: string[] = [];
  for (const item of items) {
    if (item && typeof item === 'object') {
      const rec = item as { id?: unknown; name?: unknown };
      // OpenAI/Anthropic/OpenRouter all return a canonical `id` string; we
      // prefer it unconditionally. The `name` fallback exists solely for
      // Ollama's /api/tags shape (`{models: [{ name: "llama3.2:latest" }]}`)
      // which has no `id` field. No known API-key provider returns objects
      // with `name` but no `id`, so this fallback never silently misroutes
      // for existing providers — but a future provider that ships display
      // names without ids would also land here.
      if (typeof rec.id === 'string') {
        ids.push(rec.id);
        continue;
      }
      if (typeof rec.name === 'string') {
        ids.push(rec.name);
        continue;
      }
    }
    return null;
  }
  return ids;
}

export function extractModelIds(body: unknown): string[] | null {
  if (body === null || typeof body !== 'object') return null;

  // OpenAI / OpenAI-compat: { data: [{ id: string }, ...] }
  const data = (body as { data?: unknown }).data;
  if (Array.isArray(data)) return extractIds(data);

  // Anthropic: { models: [{ id: string }, ...] }
  const models = (body as { models?: unknown }).models;
  if (Array.isArray(models)) return extractIds(models);

  return null;
}

// ---------------------------------------------------------------------------
// Models cache (5-minute TTL keyed by provider+baseUrl)
// ---------------------------------------------------------------------------

interface CacheEntry {
  models: string[];
  expiresAt: number;
}

const modelsCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export function getCacheKey(provider: string, baseUrl: string, apiKey: string): string {
  // SHA-256 here is a cache-key discriminator, not a password hash — the
  // Map lives in-process with a 5-minute TTL, never persists, and never
  // leaves the main process. Using bcrypt/scrypt (as CodeQL's default
  // rule suggests) would make every cache lookup take hundreds of ms
  // and defeat the purpose of caching. Hashing apiKey (rather than
  // embedding it verbatim in the Map key) is defense-in-depth so plaintext
  // keys don't end up in memory-dump strings a third-party crash reporter
  // might pick up.
  // codeql[js/insufficient-password-hash]
  const keyHash = createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
  return `${provider}::${baseUrl}::${keyHash}`;
}

function getCachedModels(provider: string, baseUrl: string, apiKey: string): string[] | null {
  const key = getCacheKey(provider, baseUrl, apiKey);
  const entry = modelsCache.get(key);
  if (entry === undefined) return null;
  if (Date.now() > entry.expiresAt) {
    modelsCache.delete(key);
    return null;
  }
  return entry.models;
}

function setCachedModels(
  provider: string,
  baseUrl: string,
  apiKey: string,
  models: string[],
): void {
  const key = getCacheKey(provider, baseUrl, apiKey);
  modelsCache.set(key, { models, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Exposed for testing only.
export function _clearModelsCache(): void {
  modelsCache.clear();
}

export function _getModelsCache(): Map<string, CacheEntry> {
  return modelsCache;
}

// ---------------------------------------------------------------------------
// IPC registration
// ---------------------------------------------------------------------------

interface ActiveProviderCredentials {
  provider: string;
  wire: WireApi;
  apiKey: string;
  baseUrl: string;
  httpHeaders?: Record<string, string>;
}

function resolveCredentialsForProvider(
  providerId: string,
): ActiveProviderCredentials | ConnectionTestError {
  const cfg = getCachedConfig();
  if (cfg === null || providerId.length === 0) {
    return {
      ok: false,
      code: 'IPC_BAD_INPUT',
      message: 'No active provider configured',
      hint: 'Complete onboarding first',
    };
  }
  const entry =
    cfg.providers[providerId] ??
    (isSupportedOnboardingProvider(providerId) ? BUILTIN_PROVIDERS[providerId] : undefined);
  if (entry === undefined) {
    return {
      ok: false,
      code: 'IPC_BAD_INPUT',
      message: `Provider "${providerId}" not found in config`,
      hint: 'Re-add the provider from Settings',
    };
  }
  let apiKey: string;
  try {
    apiKey = getApiKeyForProvider(providerId);
  } catch (err) {
    // No stored key — provider may be keyless (IP-whitelisted proxy).
    if (!isKeylessProviderAllowed(providerId, entry)) {
      return {
        ok: false,
        code: 'IPC_BAD_INPUT',
        message:
          err instanceof Error ? err.message : `No API key stored for provider "${providerId}"`,
        hint: 'Open Settings and import Codex again, or add an API key for this provider',
      };
    }
    apiKey = '';
  }
  return {
    provider: providerId,
    wire: entry.wire,
    apiKey,
    baseUrl: entry.baseUrl,
    ...(entry.httpHeaders !== undefined ? { httpHeaders: entry.httpHeaders } : {}),
  };
}

function resolveActiveCredentials(): ActiveProviderCredentials | ConnectionTestError {
  const cfg = getCachedConfig();
  const active = cfg?.activeProvider;
  if (active === undefined || active.length === 0) {
    return {
      ok: false,
      code: 'IPC_BAD_INPUT',
      message: 'No active provider configured',
      hint: 'Complete onboarding first',
    };
  }
  return resolveCredentialsForProvider(active);
}

async function runProviderTest(creds: ActiveProviderCredentials): Promise<ConnectionTestResponse> {
  const { url } = buildEndpointForWire(creds.wire, creds.baseUrl);
  const headers = buildAuthHeadersForWire(
    creds.wire,
    creds.apiKey,
    creds.httpHeaders,
    creds.baseUrl,
  );

  let res: Response;
  try {
    res = await fetchWithTimeout(url, { method: 'GET', headers });
  } catch (err) {
    const { code, hint } = classifyNetworkError(err);
    return {
      ok: false,
      code,
      message: err instanceof Error ? err.message : 'Network request failed',
      hint,
    };
  }
  if (!res.ok) {
    const { code, hint } = classifyHttpError(res.status);
    return { ok: false, code, message: `HTTP ${res.status}`, hint };
  }
  return { ok: true };
}

export function registerConnectionIpc(): void {
  ipcMain.handle(
    'connection:v1:test',
    async (_e, raw: unknown): Promise<ConnectionTestResponse> => {
      let payload: ConnectionTestPayloadV1;
      try {
        payload = parseConnectionTestPayload(raw);
      } catch (err) {
        return {
          ok: false,
          code: 'IPC_BAD_INPUT',
          message: err instanceof Error ? err.message : String(err),
          hint: 'Invalid connection test payload',
        };
      }

      const { provider, apiKey, baseUrl } = payload;
      const ep = buildModelsEndpoint(provider, baseUrl);
      const authHeaders = buildAuthHeaders(provider, apiKey, baseUrl);

      let res: Response;
      try {
        res = await fetchWithTimeout(ep.url, {
          method: 'GET',
          headers: { ...ep.headers, ...authHeaders },
        });
      } catch (err) {
        const { code, hint } = classifyNetworkError(err);
        return {
          ok: false,
          code,
          message: err instanceof Error ? err.message : 'Network request failed',
          hint,
        };
      }

      if (!res.ok) {
        const { code, hint } = classifyHttpError(res.status);
        return {
          ok: false,
          code,
          message: `HTTP ${res.status}`,
          hint,
        };
      }

      return { ok: true };
    },
  );

  ipcMain.handle('models:v1:list', async (_e, raw: unknown): Promise<ModelsListResponse> => {
    let payload: ModelsListPayloadV1;
    try {
      payload = parseModelsListPayload(raw);
    } catch (err) {
      return {
        ok: false,
        code: 'IPC_BAD_INPUT',
        message: err instanceof Error ? err.message : String(err),
        hint: 'Invalid models:v1:list payload',
      };
    }

    const { provider, apiKey, baseUrl } = payload;

    const cached = getCachedModels(provider, baseUrl, apiKey);
    if (cached !== null) return { ok: true, models: cached };

    const ep = buildModelsEndpoint(provider, baseUrl);
    const authHeaders = buildAuthHeaders(provider, apiKey, baseUrl);

    let res: Response;
    try {
      res = await fetchWithTimeout(ep.url, {
        method: 'GET',
        headers: { ...ep.headers, ...authHeaders },
      });
    } catch (err) {
      return {
        ok: false,
        code: 'NETWORK',
        message: err instanceof Error ? err.message : String(err),
        hint: 'Cannot reach provider /models endpoint',
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        code: 'HTTP',
        message: `HTTP ${res.status}`,
        hint: 'Model list request failed',
      };
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return {
        ok: false,
        code: 'PARSE',
        message: 'Invalid JSON in response',
        hint: 'Provider returned non-JSON',
      };
    }

    const ids = extractModelIds(body);
    if (ids === null) {
      return {
        ok: false,
        code: 'PARSE',
        message: 'Provider returned unexpected models response shape',
        hint: 'Unexpected response shape — check provider /models endpoint compatibility',
      };
    }
    setCachedModels(provider, baseUrl, apiKey, ids);
    return { ok: true, models: ids };
  });

  // Tests the currently active provider using the stored (encrypted) key — no key passed from renderer.
  ipcMain.handle('connection:v1:test-active', async (): Promise<ConnectionTestResponse> => {
    const creds = resolveActiveCredentials();
    if (!('provider' in creds)) return creds;
    return runProviderTest(creds);
  });

  // Tests a specific provider by id — used by the per-row "Test connection"
  // button in Settings. Same probe as test-active but routed by id.
  ipcMain.handle(
    'connection:v1:test-provider',
    async (_e, raw: unknown): Promise<ConnectionTestResponse> => {
      if (typeof raw !== 'string' || raw.length === 0) {
        return {
          ok: false,
          code: 'IPC_BAD_INPUT',
          message: 'test-provider expects a provider id string',
          hint: 'Internal error — missing provider id',
        };
      }
      const creds = resolveCredentialsForProvider(raw);
      if (!('provider' in creds)) return creds;
      return runProviderTest(creds);
    },
  );

  // Fetch available models for a stored provider by ID — credentials resolved
  // from the encrypted config so the renderer never touches plaintext keys.
  ipcMain.handle(
    'models:v1:list-for-provider',
    async (_e, raw: unknown): Promise<ModelsListResponse> => {
      if (typeof raw !== 'string' || raw.length === 0) {
        return {
          ok: false,
          code: 'IPC_BAD_INPUT',
          message: 'list-for-provider expects a provider id string',
          hint: 'Internal error — missing provider id',
        };
      }

      const cfg = getCachedConfig();
      if (cfg === null) {
        return {
          ok: false,
          code: 'IPC_BAD_INPUT',
          message: 'No configuration loaded',
          hint: 'Complete onboarding first',
        };
      }
      const entry =
        cfg.providers[raw] ??
        (isSupportedOnboardingProvider(raw) ? BUILTIN_PROVIDERS[raw] : undefined);
      if (entry === undefined) {
        return {
          ok: false,
          code: 'IPC_BAD_INPUT',
          message: `Provider "${raw}" not found in config`,
          hint: 'Re-add the provider from Settings',
        };
      }

      // Providers that expose a static hint (e.g. chatgpt-codex, whose /models
      // endpoint requires OAuth bearer + ChatGPT-Account-Id headers that this
      // keyless discovery path cannot supply) short-circuit with modelsHint.
      if (entry.modelsHint !== undefined && entry.modelsHint.length > 0) {
        return { ok: true, models: entry.modelsHint };
      }

      let apiKey: string;
      try {
        apiKey = getApiKeyForProvider(raw);
      } catch (err) {
        if (!isKeylessProviderAllowed(raw, entry)) {
          return {
            ok: false,
            code: 'IPC_BAD_INPUT',
            message: err instanceof Error ? err.message : `No API key stored for provider "${raw}"`,
            hint: 'Open Settings and import Codex again, or add an API key for this provider',
          };
        }
        apiKey = '';
      }

      const cached = getCachedModels(raw, entry.baseUrl, apiKey);
      if (cached !== null) return { ok: true, models: cached };

      const { url } = buildEndpointForWire(entry.wire, entry.baseUrl);
      const headers = buildAuthHeadersForWire(entry.wire, apiKey, entry.httpHeaders, entry.baseUrl);

      let res: Response;
      try {
        res = await fetchWithTimeout(url, { method: 'GET', headers });
      } catch (err) {
        return {
          ok: false,
          code: 'NETWORK',
          message: err instanceof Error ? err.message : String(err),
          hint: 'Cannot reach provider /models endpoint',
        };
      }

      if (!res.ok) {
        return {
          ok: false,
          code: 'HTTP',
          message: `HTTP ${res.status}`,
          hint: 'Model list request failed',
        };
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch {
        return {
          ok: false,
          code: 'PARSE',
          message: 'Invalid JSON in response',
          hint: 'Provider returned non-JSON',
        };
      }

      const ids = extractModelIds(body);
      if (ids === null) {
        return {
          ok: false,
          code: 'PARSE',
          message: 'Unexpected models response shape',
          hint: 'Check provider /models endpoint compatibility',
        };
      }
      setCachedModels(raw, entry.baseUrl, apiKey, ids);
      return { ok: true, models: ids };
    },
  );

  // ── Wire-agnostic test endpoint (v3 custom providers) ────────────────────
  ipcMain.handle(
    'config:v1:test-endpoint',
    async (_e, raw: unknown): Promise<TestEndpointResponse> => {
      let payload: TestEndpointPayload;
      try {
        payload = parseTestEndpointPayload(raw);
      } catch (err) {
        return {
          ok: false,
          error: 'bad-input',
          message: err instanceof Error ? err.message : String(err),
        };
      }

      const { url } = buildEndpointForWire(payload.wire, payload.baseUrl);
      const headers = buildAuthHeadersForWire(
        payload.wire,
        payload.apiKey,
        payload.httpHeaders,
        payload.baseUrl,
      );

      let res: Response;
      try {
        res = await fetchWithTimeout(url, { method: 'GET', headers });
      } catch (err) {
        return {
          ok: false,
          error: 'network',
          message: err instanceof Error ? err.message : 'Network request failed',
        };
      }

      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: 'auth', message: `HTTP ${res.status}` };
      }
      if (res.status === 404) {
        return { ok: false, error: 'not-a-model-endpoint', message: 'HTTP 404' };
      }
      if (!res.ok) {
        return { ok: false, error: `http-${res.status}`, message: `HTTP ${res.status}` };
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        return { ok: false, error: 'parse', message: 'Provider returned non-JSON' };
      }
      const ids = extractModelIds(body);
      return { ok: true, modelCount: ids?.length ?? 0, models: ids ?? [] };
    },
  );

  // ── Ollama probe — used by onboarding to show "detected/not running" ─────
  // We intentionally don't reuse the /v1/models endpoint because /api/tags is
  // Ollama's canonical liveness probe, returns faster, and survives users who
  // disabled the OpenAI-compat server. Short 2s timeout because the user is
  // staring at a spinner in the onboarding flow.
  ipcMain.handle('ollama:v1:probe', async (_e, raw: unknown): Promise<OllamaProbeResponse> => {
    let baseUrl: string;
    try {
      baseUrl = parseOllamaProbePayload(raw);
    } catch (err) {
      // Surface invalid URL / unsupported scheme as an explicit IPC error
      // instead of silently coercing back to localhost — the renderer needs
      // to see the mistake to let the user fix their typed baseUrl.
      return {
        ok: false,
        code: 'IPC_BAD_INPUT',
        message: err instanceof Error ? err.message : String(err),
      };
    }
    const url = `${baseUrl.replace(/\/+$/, '')}/api/tags`;
    let res: Response;
    try {
      res = await fetchWithTimeout(url, { method: 'GET' }, 2000);
    } catch (err) {
      const { code } = classifyNetworkError(err);
      return { ok: false, code, message: err instanceof Error ? err.message : String(err) };
    }
    if (!res.ok) {
      return { ok: false, code: 'HTTP', message: `HTTP ${res.status}` };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, code: 'PARSE', message: 'Non-JSON response' };
    }
    const models = extractModelIds(body);
    if (models === null) {
      // Don't silently pretend Ollama is up with zero models — that would
      // push the UI into an "available but empty" state that's actually a
      // parser bug. Surface PARSE so the renderer can flag the probe as
      // broken rather than rendering an empty model picker.
      return { ok: false, code: 'PARSE', message: 'Unexpected /api/tags shape' };
    }
    return { ok: true, models };
  });
}

export type OllamaProbeResponse =
  | { ok: true; models: string[] }
  | { ok: false; code: string; message: string };

function parseOllamaProbePayload(raw: unknown): string {
  return normalizeOllamaBaseUrl(typeof raw === 'string' ? raw : '');
}

/**
 * Exported for unit tests. Turns whatever string the renderer sent into the
 * base URL for the /api/tags probe. Returns the default `http://localhost:11434`
 * ONLY when the input is empty — any other garbage (malformed URL,
 * `file://`, `javascript:` etc.) throws a `CodesignError` so the IPC handler
 * can surface the mistake instead of silently probing localhost.
 */
export function normalizeOllamaBaseUrl(raw: string): string {
  const DEFAULT_BASE_URL = 'http://localhost:11434';
  const trimmed = raw.trim();
  if (trimmed.length === 0) return DEFAULT_BASE_URL;

  // Treat the input as "already has a scheme" only if it starts with a
  // recognizable `scheme://` prefix. That lets us reject `file://` /
  // `ftp://` without also misclassifying `localhost:11434` (which the
  // plain `URL()` constructor parses as scheme="localhost:" because of
  // the host:port shape). `javascript:alert(1)` and similar scheme-only
  // tricks fail the `://` gate and instead get `http://` prepended, which
  // then fails URL parsing in the second pass and is rejected below.
  const hasScheme = /^[a-z][a-z0-9+.\-]*:\/\//i.test(trimmed);
  const withScheme = hasScheme ? trimmed : `http://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new CodesignError(
      `Ollama baseUrl "${trimmed}" is not a valid URL`,
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CodesignError(
      `Ollama baseUrl must use http(s), got "${parsed.protocol}"`,
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  if (parsed.hostname.length === 0) {
    throw new CodesignError(
      `Ollama baseUrl "${trimmed}" is not a valid URL`,
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  // We deliberately do NOT restrict to loopback because some users run
  // Ollama on a LAN box; the threat model matches config:v1:test-endpoint
  // (renderer is trusted, main-process fetch is the intended egress path).
  // Strip any /v1 suffix — /api/tags lives at the root.
  return withScheme.replace(/\/+$/, '').replace(/\/v1$/, '');
}

interface TestEndpointPayload {
  wire: WireApi;
  baseUrl: string;
  apiKey: string;
  httpHeaders?: Record<string, string>;
}

export type TestEndpointResponse =
  | { ok: true; modelCount: number; models: string[] }
  | { ok: false; error: string; message: string };

function parseTestEndpointPayload(raw: unknown): TestEndpointPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('config:v1:test-endpoint expects an object', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  const wire = r['wire'];
  const baseUrl = r['baseUrl'];
  const apiKey = r['apiKey'];
  if (wire !== 'openai-chat' && wire !== 'openai-responses' && wire !== 'anthropic') {
    throw new CodesignError(`Unsupported wire: ${String(wire)}`, ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
    throw new CodesignError('baseUrl must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof apiKey !== 'string') {
    throw new CodesignError('apiKey must be a string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const out: TestEndpointPayload = {
    wire,
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim(),
  };
  const headers = r['httpHeaders'];
  if (headers !== undefined && headers !== null) {
    if (typeof headers !== 'object') {
      throw new CodesignError('httpHeaders must be an object', ERROR_CODES.IPC_BAD_INPUT);
    }
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      if (typeof v === 'string') map[k] = v;
    }
    out.httpHeaders = map;
  }
  return out;
}
