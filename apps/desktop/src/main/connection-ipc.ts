import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { openaiChatShouldProbeDeveloperRole } from '@open-codesign/providers';
import {
  BUILTIN_PROVIDERS,
  CodesignError,
  type ConnectionCapabilityReason,
  canonicalBaseUrl,
  capabilityReason,
  classifyInferenceProbe,
  type DiagnosticCategory,
  ERROR_CODES,
  ensureVersionedBase,
  isSupportedOnboardingProvider,
  modelDiscoveryReason,
  type ProviderEntry,
  type SupportedOnboardingProvider,
  skippedReason,
  stripInferenceEndpointSuffix,
  summarizeConnectionCapabilities,
  type WireApi,
} from '@open-codesign/shared';
import { buildAuthHeaders, buildAuthHeadersForWire } from './auth-headers';
import { getCodexTokenStore } from './codex-oauth-ipc';
import { ipcMain } from './electron-runtime';
import { getApiKeyForProvider, getCachedConfig, hasApiKeyForProvider } from './onboarding-ipc';
import { isKeylessProviderAllowed } from './provider-settings';
import { withTlsBypass } from './tls-override';

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

const CONNECTION_TEST_FIELDS = ['provider', 'apiKey', 'baseUrl'] as const;
const MODELS_LIST_FIELDS = ['provider', 'apiKey', 'baseUrl'] as const;
const TEST_ENDPOINT_FIELDS = [
  'wire',
  'baseUrl',
  'apiKey',
  'httpHeaders',
  'allowPrivateNetwork',
  'tlsRejectUnauthorized',
] as const;

function assertKnownFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new CodesignError(
        `${context} contains unsupported field "${key}"`,
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
  }
}

export interface ConnectionTestResult {
  ok: true;
  /**
   * `models` when the standard GET /models probe succeeded.
   * `chat_completion_degraded` when /models 404'd but POST /chat/completions
   * proved the openai-chat wire is alive (e.g. Zhipu GLM — no public /models).
   * `responses_degraded` when /models 404'd but POST /responses proved the
   * openai-responses wire is alive. We probe the wire's real inference
   * endpoint so a gateway that only implements /chat/completions can't
   * false-positive for a user whose provider is on the Responses API.
   */
  probeMethod?:
    | 'models'
    | 'chat_completion_degraded'
    | 'responses_degraded'
    | 'anthropic_messages_degraded';
  compatibility?: 'compatible' | 'degraded-compatible';
  reasonCategory?: DiagnosticCategory;
  /** Layered capability reasons for the renderer. Always set by runProviderTest. */
  reasons?: ConnectionCapabilityReason[];
}

export interface ConnectionTestError {
  ok: false;
  code: 'IPC_BAD_INPUT' | '401' | '404' | 'ECONNREFUSED' | 'NETWORK' | 'PARSE';
  message: string;
  hint: string;
  compatibility?: 'incompatible';
  reasonCategory?: DiagnosticCategory;
  reasons?: ConnectionCapabilityReason[];
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
  assertKnownFields(r, CONNECTION_TEST_FIELDS, 'connection:v1:test');
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
  return {
    provider,
    apiKey,
    baseUrl: parseHttpBaseUrl(r['baseUrl'], 'baseUrl'),
  };
}

function parseModelsListPayload(raw: unknown): ModelsListPayloadV1 {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('models:v1:list expects an object payload', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  assertKnownFields(r, MODELS_LIST_FIELDS, 'models:v1:list');
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
  return {
    provider,
    apiKey,
    baseUrl: parseHttpBaseUrl(r['baseUrl'], 'baseUrl'),
  };
}

function parseHttpBaseUrl(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CodesignError(`${field} must be a non-empty string`, ERROR_CODES.IPC_BAD_INPUT);
  }
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new CodesignError(`${field} "${trimmed}" is not a valid URL`, ERROR_CODES.IPC_BAD_INPUT);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CodesignError(
      `${field} must use http(s), got "${parsed.protocol}"`,
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  return trimmed;
}

export type NetworkTargetClass = 'public' | 'loopback' | 'private' | 'link-local' | 'metadata';

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  const [a, b, c, d] = parts as [number, number, number, number];
  return ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
}

function inIpv4Range(ip: string, base: string, bits: number): boolean {
  const value = ipv4ToNumber(ip);
  const baseValue = ipv4ToNumber(base);
  if (value === null || baseValue === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

export function classifyNetworkTarget(rawBaseUrl: string): NetworkTargetClass {
  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    return 'public';
  }
  const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
  if (
    host === 'metadata.google.internal' ||
    host === 'metadata' ||
    host === '169.254.169.254' ||
    host === 'fd00:ec2::254'
  ) {
    return 'metadata';
  }
  if (host === 'localhost') return 'loopback';
  const family = isIP(host);
  if (family === 4) {
    if (inIpv4Range(host, '127.0.0.0', 8)) return 'loopback';
    if (inIpv4Range(host, '10.0.0.0', 8)) return 'private';
    if (inIpv4Range(host, '172.16.0.0', 12)) return 'private';
    if (inIpv4Range(host, '192.168.0.0', 16)) return 'private';
    if (inIpv4Range(host, '169.254.0.0', 16)) return 'link-local';
    return 'public';
  }
  if (family === 6) {
    if (host === '::1') return 'loopback';
    if (host.startsWith('fe80:')) return 'link-local';
    if (host.startsWith('fc') || host.startsWith('fd')) return 'private';
  }
  return 'public';
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

function connectionCategoryForStatus(status: number, baseUrl: string): DiagnosticCategory {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) {
    return /\/v\d+[a-z]*(?:\/|$)/i.test(baseUrl) ? 'endpoint-not-found' : 'missing-base-v1';
  }
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'upstream-server-error';
  return 'unknown';
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
      // prefer it unconditionally. The `name` alternative exists solely for
      // Ollama's /api/tags shape (`{models: [{ name: "llama3.2:latest" }]}`)
      // which has no `id` field. No known API-key provider returns objects
      // with `name` but no `id`, so this branch never silently misroutes
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

export interface ActiveProviderCredentials {
  provider: string;
  wire: WireApi;
  apiKey: string;
  baseUrl: string;
  httpHeaders?: Record<string, string>;
  /**
   * True when the provider entry came from BUILTIN_PROVIDERS rather than user
   * config. Built-ins force-ignore `tlsRejectUnauthorized` so a tampered
   * config can never weaken outbound TLS for official endpoints. Optional so
   * that test fixtures can omit it (treated as non-builtin, which is the safe
   * default — the flag is checked against `!== true` everywhere).
   */
  builtin?: boolean;
  /** Opt-in TLS verification bypass; only honored when `builtin === false`. */
  tlsRejectUnauthorized?: boolean;
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
  let apiKey = '';
  if (isKeylessProviderAllowed(providerId, entry) && !hasApiKeyForProvider(providerId)) {
    apiKey = '';
  } else {
    try {
      apiKey = getApiKeyForProvider(providerId);
    } catch (err) {
      return {
        ok: false,
        code: 'IPC_BAD_INPUT',
        message:
          err instanceof Error ? err.message : `No API key stored for provider "${providerId}"`,
        hint: 'Open Settings and import Codex again, or add an API key for this provider',
      };
    }
  }
  return {
    provider: providerId,
    wire: entry.wire,
    apiKey,
    baseUrl: entry.baseUrl,
    builtin: entry.builtin === true,
    ...(entry.httpHeaders !== undefined ? { httpHeaders: entry.httpHeaders } : {}),
    ...(entry.tlsRejectUnauthorized !== undefined
      ? { tlsRejectUnauthorized: entry.tlsRejectUnauthorized }
      : {}),
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

type InferenceWire = 'openai-chat' | 'openai-responses' | 'anthropic';

function isInferenceWire(wire: WireApi): wire is InferenceWire {
  return wire === 'openai-chat' || wire === 'openai-responses' || wire === 'anthropic';
}

function passReason(
  layer: ConnectionCapabilityReason['layer'],
  source: ConnectionCapabilityReason['source'],
  detail: string,
): ConnectionCapabilityReason {
  return capabilityReason({
    layer,
    status: 'pass',
    category: 'unknown',
    cause: 'diagnostics.cause.capabilityPass',
    source,
    detail,
  });
}

function authFailReason(detail: string): ConnectionCapabilityReason {
  return capabilityReason({
    layer: 'authentication',
    status: 'fail',
    category: 'auth',
    cause: 'diagnostics.cause.keyInvalid',
    source: 'shared-contract',
    detail,
  });
}

function degradedProbeMethod(
  wire: InferenceWire,
): NonNullable<ConnectionTestResult['probeMethod']> {
  if (wire === 'openai-responses') return 'responses_degraded';
  if (wire === 'anthropic') return 'anthropic_messages_degraded';
  return 'chat_completion_degraded';
}

function successFromReport(
  report: ReturnType<typeof summarizeConnectionCapabilities>,
  probeMethod: ConnectionTestResult['probeMethod'],
): ConnectionTestResult {
  const compatibility =
    report.compatibility === 'incompatible' ? 'degraded-compatible' : report.compatibility;
  return {
    ok: true,
    ...(probeMethod !== undefined ? { probeMethod } : {}),
    compatibility,
    ...(report.primary !== undefined ? { reasonCategory: report.primary.category } : {}),
    reasons: report.reasons,
  };
}

function failureFromReport(
  report: ReturnType<typeof summarizeConnectionCapabilities>,
  fields: Pick<ConnectionTestError, 'code' | 'message' | 'hint'>,
): ConnectionTestError {
  return {
    ok: false,
    ...fields,
    compatibility: 'incompatible',
    ...(report.primary !== undefined ? { reasonCategory: report.primary.category } : {}),
    reasons: report.reasons,
  };
}

function parseJsonBody(bodyText: string): unknown {
  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    return null;
  }
}

async function testChatGPTCodexOAuth(): Promise<ConnectionTestResponse> {
  let stored: Awaited<ReturnType<ReturnType<typeof getCodexTokenStore>['read']>>;
  try {
    stored = await getCodexTokenStore().read();
  } catch (err) {
    return {
      ok: false,
      code: '401',
      message: err instanceof Error ? err.message : String(err),
      hint: 'ChatGPT 订阅凭证读取失败，请到 Settings 重新登录',
    };
  }
  if (stored === null) {
    return failureFromReport(
      summarizeConnectionCapabilities([authFailReason('No ChatGPT OAuth token stored')]),
      {
        code: '401',
        message: 'No ChatGPT OAuth token stored',
        hint: 'ChatGPT 订阅未登录，请到 Settings 登录',
      },
    );
  }
  if (stored.expiresAt < Date.now()) {
    return failureFromReport(
      summarizeConnectionCapabilities([authFailReason('ChatGPT OAuth token expired')]),
      {
        code: '401',
        message: 'ChatGPT OAuth token expired',
        hint: 'ChatGPT 订阅登录已过期，请重新登录',
      },
    );
  }
  return successFromReport(
    summarizeConnectionCapabilities([
      passReason(
        'authentication',
        'shared-contract',
        'ChatGPT OAuth token is present and unexpired',
      ),
    ]),
    undefined,
  );
}

export async function runProviderTest(
  creds: ActiveProviderCredentials,
): Promise<ConnectionTestResponse> {
  // ChatGPT subscription uses OAuth + ChatGPT-Account-Id headers; its host
  // has no `/models` endpoint that a generic Bearer probe can reach. A plain
  // HTTP probe would return 401 here and render as the misleading "API key
  // 错误或权限不足" hint — so we check the OAuth token store directly and
  // surface a login-specific hint instead.
  if (creds.wire === 'openai-codex-responses') {
    return testChatGPTCodexOAuth();
  }

  // Bypass is the per-provider opt-in, force-gated so a tampered config can
  // never weaken TLS for built-in providers. Wrapping the whole body covers
  // both the GET /models probe and the inner POST inside tryDegradeProbe.
  const bypass = creds.builtin !== true && creds.tlsRejectUnauthorized === true;
  return withTlsBypass(bypass, async () => {
    const { url, normalizedBaseUrl } = buildEndpointForWire(creds.wire, creds.baseUrl);
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
      return failureFromReport(
        summarizeConnectionCapabilities([
          skippedReason('authentication', 'No HTTP response to classify auth'),
          capabilityReason({
            layer: 'endpoint-shape',
            status: 'fail',
            category: code === 'ECONNREFUSED' ? 'network-unreachable' : 'unknown',
            cause: 'diagnostics.cause.hostUnreachable',
            source: 'probe-only',
            detail: err instanceof Error ? err.message : String(err),
          }),
        ]),
        {
          code,
          message: err instanceof Error ? err.message : 'Network request failed',
          hint,
        },
      );
    }

    if (res.status === 401 || res.status === 403) {
      const { code, hint } = classifyHttpError(res.status);
      return failureFromReport(
        summarizeConnectionCapabilities([
          authFailReason(`GET /models returned HTTP ${res.status}`),
        ]),
        { code, message: `HTTP ${res.status}`, hint },
      );
    }

    const modelsOk = res.ok;
    const models404 = res.status === 404;
    if (!modelsOk && !models404) {
      const { code, hint } = classifyHttpError(res.status);
      return failureFromReport(
        summarizeConnectionCapabilities([
          passReason(
            'authentication',
            'shared-contract',
            'Non-auth HTTP status from GET /models using runtime auth headers',
          ),
          capabilityReason({
            layer: 'endpoint-shape',
            status: 'fail',
            category: connectionCategoryForStatus(res.status, normalizedBaseUrl),
            cause: 'diagnostics.cause.serverError',
            source: 'probe-only',
            detail: `GET /models returned HTTP ${res.status}`,
          }),
        ]),
        { code, message: `HTTP ${res.status}`, hint },
      );
    }

    if (!isInferenceWire(creds.wire)) {
      if (modelsOk) {
        return successFromReport(
          summarizeConnectionCapabilities([
            passReason('authentication', 'shared-contract', 'GET /models accepted runtime auth'),
            passReason('endpoint-shape', 'shared-contract', 'GET /models succeeded'),
            modelDiscoveryReason({ modelsAvailable: true, inferenceAlive: false }),
          ]),
          'models',
        );
      }
      const { code, hint } = classifyHttpError(res.status);
      return failureFromReport(
        summarizeConnectionCapabilities([
          passReason('authentication', 'shared-contract', 'Non-auth HTTP from GET /models'),
          capabilityReason({
            layer: 'endpoint-shape',
            status: 'fail',
            category: connectionCategoryForStatus(res.status, normalizedBaseUrl),
            cause: 'diagnostics.cause.endpointNotFound',
            source: 'probe-only',
          }),
        ]),
        { code, message: `HTTP ${res.status}`, hint },
      );
    }

    return assessInferenceCapabilities({
      wire: creds.wire,
      baseUrl: creds.baseUrl,
      normalizedBaseUrl,
      headers,
      modelsOk,
    });
  });
}

async function assessInferenceCapabilities(input: {
  wire: InferenceWire;
  baseUrl: string;
  normalizedBaseUrl: string;
  headers: Record<string, string>;
  modelsOk: boolean;
}): Promise<ConnectionTestResponse> {
  const { wire, normalizedBaseUrl, headers, modelsOk } = input;
  const developerRoleProbed = openaiChatShouldProbeDeveloperRole(wire, input.baseUrl);
  const probe = await probeInferenceEndpoint(wire, normalizedBaseUrl, headers, {
    includeDeveloperRole: developerRoleProbed,
  });

  if (probe.kind === 'network') {
    if (modelsOk) {
      return successFromReport(
        summarizeConnectionCapabilities([
          passReason('authentication', 'shared-contract', 'GET /models accepted runtime auth'),
          passReason('endpoint-shape', 'shared-contract', 'GET /models succeeded'),
          skippedReason('wire-support', `Inference probe network error: ${probe.message}`),
          modelDiscoveryReason({ modelsAvailable: true, inferenceAlive: false }),
        ]),
        'models',
      );
    }
    return modelsCatalogFailure(normalizedBaseUrl, 404);
  }

  let classified = classifyInferenceProbe({
    wire,
    status: probe.status,
    bodyText: probe.bodyText,
    developerRoleProbed,
    anthropicErrorShape: hasAnthropicApiErrorShape(parseJsonBody(probe.bodyText)),
  });

  if (classified.roleCompatibility === 'fail' && developerRoleProbed) {
    const retry = await probeInferenceEndpoint(wire, normalizedBaseUrl, headers, {
      includeDeveloperRole: false,
    });
    if (retry.kind === 'response') {
      const retryClass = classifyInferenceProbe({
        wire,
        status: retry.status,
        bodyText: retry.bodyText,
        developerRoleProbed: false,
        anthropicErrorShape: hasAnthropicApiErrorShape(parseJsonBody(retry.bodyText)),
      });
      classified = { ...retryClass, roleCompatibility: 'fail' };
    }
  }

  if (classified.authentication === 'fail') {
    const { code, hint } = classifyHttpError(probe.status);
    return failureFromReport(
      summarizeConnectionCapabilities([
        authFailReason(`Inference probe returned HTTP ${probe.status}`),
      ]),
      { code, message: `HTTP ${probe.status}`, hint },
    );
  }

  if (classified.tryAlternateWire) {
    const alt =
      wire === 'openai-responses'
        ? 'openai-chat'
        : wire === 'openai-chat'
          ? 'openai-responses'
          : null;
    if (alt !== null) {
      const altProbe = await probeInferenceEndpoint(alt, normalizedBaseUrl, headers, {
        includeDeveloperRole: false,
      });
      if (altProbe.kind === 'response') {
        const altClass = classifyInferenceProbe({
          wire: alt,
          status: altProbe.status,
          bodyText: altProbe.bodyText,
          developerRoleProbed: false,
        });
        if (altClass.wireSupport === 'pass') {
          const suggestedWire = classified.suggestedWire ?? alt;
          return failureFromReport(
            summarizeConnectionCapabilities([
              passReason(
                'authentication',
                'shared-contract',
                'Non-auth HTTP using runtime auth headers',
              ),
              passReason(
                'endpoint-shape',
                'probe-only',
                'Alternate OpenAI wire is reachable; selected wire is not',
              ),
              capabilityReason({
                layer: 'wire-support',
                status: 'fail',
                category: 'wrong-wire',
                cause:
                  wire === 'openai-responses'
                    ? 'diagnostics.cause.wireMismatchResponses'
                    : 'diagnostics.cause.wireMismatchChat',
                source: 'probe-only',
                detail: `Selected ${wire} failed; ${alt} responded as a live inference route`,
                suggestedWire,
                suggestedFixKind: 'switchWire',
              }),
              modelDiscoveryReason({ modelsAvailable: modelsOk, inferenceAlive: false }),
            ]),
            {
              code: '404',
              message: `HTTP ${probe.status}`,
              hint:
                wire === 'openai-responses'
                  ? 'This gateway speaks /chat/completions, not /responses. Switch the provider wire to openai-chat.'
                  : 'This gateway speaks /responses, not /chat/completions. Switch the provider wire to openai-responses.',
            },
          );
        }
      }
    }
  }

  if (classified.wireSupport === 'fail') {
    if (!modelsOk) {
      if (probe.status !== 404) {
        const { code, hint } = classifyHttpError(probe.status);
        return failureFromReport(
          summarizeConnectionCapabilities([
            passReason(
              'authentication',
              'shared-contract',
              'Non-auth HTTP using runtime auth headers',
            ),
            capabilityReason({
              layer: 'wire-support',
              status: 'fail',
              category: classified.category,
              cause: classified.cause,
              source: 'probe-only',
            }),
            modelDiscoveryReason({ modelsAvailable: false, inferenceAlive: false }),
          ]),
          { code, message: `HTTP ${probe.status}`, hint },
        );
      }
      return modelsCatalogFailure(normalizedBaseUrl, 404);
    }
    if (probe.status >= 500) {
      return successFromReport(
        summarizeConnectionCapabilities([
          passReason('authentication', 'shared-contract', 'GET /models accepted runtime auth'),
          passReason('endpoint-shape', 'shared-contract', 'GET /models succeeded'),
          skippedReason(
            'wire-support',
            `Inference probe returned HTTP ${probe.status}; treating as unknown because /models succeeded`,
          ),
          modelDiscoveryReason({ modelsAvailable: true, inferenceAlive: false }),
        ]),
        'models',
      );
    }
    const { code, hint } = classifyHttpError(probe.status);
    return failureFromReport(
      summarizeConnectionCapabilities([
        passReason('authentication', 'shared-contract', 'Non-auth HTTP using runtime auth headers'),
        capabilityReason({
          layer: 'wire-support',
          status: 'fail',
          category: classified.category,
          cause: classified.cause,
          source: 'probe-only',
          ...(classified.suggestedWire !== undefined
            ? { suggestedWire: classified.suggestedWire, suggestedFixKind: 'switchWire' as const }
            : {}),
        }),
        modelDiscoveryReason({ modelsAvailable: modelsOk, inferenceAlive: false }),
      ]),
      { code, message: `HTTP ${probe.status}`, hint },
    );
  }

  const observations: ConnectionCapabilityReason[] = [
    passReason('authentication', 'shared-contract', 'Non-auth HTTP using runtime auth headers'),
    passReason('endpoint-shape', 'shared-contract', 'Selected-wire inference route is reachable'),
    passReason('wire-support', 'probe-only', 'Selected-wire inference probe reached the route'),
    modelDiscoveryReason({ modelsAvailable: modelsOk, inferenceAlive: true }),
  ];
  if (classified.roleCompatibility === 'fail') {
    observations.push(
      capabilityReason({
        layer: 'role-compatibility',
        status: 'fail',
        category: 'unsupported-role',
        cause: 'diagnostics.cause.unsupportedRole',
        source: 'probe-only',
        detail: 'Probe-only: request included a developer role message',
        suggestedFixKind: 'switchWire',
        suggestedWire: 'openai-chat',
      }),
    );
  } else if (classified.roleCompatibility === 'pass') {
    observations.push(
      passReason('role-compatibility', 'probe-only', 'Developer role was not rejected'),
    );
  }
  if (classified.reasoningCompatibility === 'fail') {
    observations.push(
      capabilityReason({
        layer: 'reasoning-compatibility',
        status: 'fail',
        category: 'reasoning-policy',
        cause: 'diagnostics.cause.reasoningPolicy',
        source: 'probe-only',
        suggestedFixKind: 'setReasoning',
      }),
    );
  } else {
    observations.push(
      skippedReason(
        'reasoning-compatibility',
        'Connection probe does not send reasoning knobs; generate-time diagnostics still classify reasoning failures',
      ),
    );
  }

  const report = summarizeConnectionCapabilities(observations);
  return successFromReport(report, modelsOk ? 'models' : degradedProbeMethod(wire));
}

function modelsCatalogFailure(
  normalizedBaseUrl: string,
  modelsStatus: number,
): ConnectionTestError {
  const { code, hint } = classifyHttpError(modelsStatus);
  const category = connectionCategoryForStatus(modelsStatus, normalizedBaseUrl);
  return failureFromReport(
    summarizeConnectionCapabilities([
      passReason('authentication', 'shared-contract', 'Non-auth HTTP from GET /models'),
      capabilityReason({
        layer: 'endpoint-shape',
        status: 'fail',
        category,
        cause:
          category === 'missing-base-v1'
            ? 'diagnostics.cause.missingV1'
            : 'diagnostics.cause.endpointNotFound',
        source: 'probe-only',
        ...(category === 'missing-base-v1'
          ? { suggestedFixKind: 'baseUrlTransform' as const }
          : {}),
      }),
      modelDiscoveryReason({ modelsAvailable: false, inferenceAlive: false }),
    ]),
    { code, message: `HTTP ${modelsStatus}`, hint },
  );
}

type ProbeResult =
  | { kind: 'response'; status: number; bodyText: string }
  | { kind: 'network'; message: string };

/**
 * POST a minimal inference request. Dispatched by wire so a chat-only gateway
 * cannot false-positive for openai-responses (and vice versa). `developer`
 * role is included only for third-party openai-chat probes.
 */
async function probeInferenceEndpoint(
  wire: InferenceWire,
  normalizedBaseUrl: string,
  headers: Record<string, string>,
  options: { includeDeveloperRole?: boolean } = {},
): Promise<ProbeResult> {
  const url =
    wire === 'anthropic'
      ? `${normalizedBaseUrl}/v1/messages`
      : wire === 'openai-responses'
        ? `${normalizedBaseUrl}/responses`
        : `${normalizedBaseUrl}/chat/completions`;
  const userMessage = { role: 'user', content: 'ping' };
  const chatMessages = options.includeDeveloperRole
    ? [{ role: 'developer', content: 'ping' }, userMessage]
    : [userMessage];
  const body =
    wire === 'anthropic'
      ? JSON.stringify({
          model: 'probe',
          messages: [userMessage],
          max_tokens: 1,
          stream: false,
        })
      : wire === 'openai-responses'
        ? JSON.stringify({
            model: 'probe',
            input: [{ role: 'user', content: [{ type: 'input_text', text: 'ping' }] }],
            max_output_tokens: 1,
            stream: false,
          })
        : JSON.stringify({
            model: 'probe',
            messages: chatMessages,
            max_tokens: 1,
            stream: false,
          });
  let res: Response;
  try {
    res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body,
    });
  } catch (err) {
    return { kind: 'network', message: err instanceof Error ? err.message : String(err) };
  }
  const bodyText = await res.text().catch(() => '');
  return { kind: 'response', status: res.status, bodyText };
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasAnthropicApiErrorShape(value: unknown): boolean {
  if (!isJsonRecord(value)) return false;
  const error = value['error'];
  return isJsonRecord(error) && typeof error['type'] === 'string';
}

export function registerConnectionIpc(): void {
  ipcMain.handle('connection:v1:test', (_e, raw: unknown) => handleConnectionV1Test(raw));
  ipcMain.handle('models:v1:list', (_e, raw: unknown) => handleModelsV1List(raw));

  // Tests the currently active provider using the stored (encrypted) key — no key passed from renderer.
  ipcMain.handle('connection:v1:test-active', async (): Promise<ConnectionTestResponse> => {
    const creds = resolveActiveCredentials();
    if (!('provider' in creds)) return creds;
    return runProviderTest(creds);
  });

  // Tests a specific provider by id — used by the per-row "Test connection"
  // button in Settings. Same probe as test-active but routed by id.
  ipcMain.handle('connection:v1:test-provider', (_e, raw: unknown) =>
    handleConnectionV1TestProvider(raw),
  );

  // Fetch available models for a stored provider by ID — credentials resolved
  // from the encrypted config so the renderer never touches plaintext keys.
  ipcMain.handle('models:v1:list-for-provider', (_e, raw: unknown) =>
    handleModelsV1ListForProvider(raw),
  );

  // ── Wire-agnostic test endpoint (v3 custom providers) ────────────────────
  ipcMain.handle('config:v1:test-endpoint', (_e, raw: unknown) => handleConfigV1TestEndpoint(raw));

  // ── Ollama probe — used by onboarding to show "detected/not running" ─────
  // We intentionally don't reuse the /v1/models endpoint because /api/tags is
  // Ollama's canonical liveness probe, returns faster, and survives users who
  // disabled the OpenAI-compat server. Short 2s timeout because the user is
  // staring at a spinner in the onboarding flow.
  ipcMain.handle('ollama:v1:probe', (_e, raw: unknown) => handleOllamaV1Probe(raw));
}

async function handleConnectionV1Test(raw: unknown): Promise<ConnectionTestResponse> {
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
}

async function handleModelsV1List(raw: unknown): Promise<ModelsListResponse> {
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

  const result = await fetchModelListResponse(
    ep.url,
    { ...ep.headers, ...authHeaders },
    {
      message: 'Provider returned unexpected models response shape',
      hint: 'Unexpected response shape — check provider /models endpoint compatibility',
    },
  );
  if (result.ok) setCachedModels(provider, baseUrl, apiKey, result.models);
  return result;
}

async function handleConnectionV1TestProvider(raw: unknown): Promise<ConnectionTestResponse> {
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
}

type ResolvedProviderForListing = { providerId: string; entry: ProviderEntry };

function resolveProviderForListing(
  raw: unknown,
): ResolvedProviderForListing | Extract<ModelsListResponse, { ok: false }> {
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
    cfg.providers[raw] ?? (isSupportedOnboardingProvider(raw) ? BUILTIN_PROVIDERS[raw] : undefined);
  if (entry === undefined) {
    return {
      ok: false,
      code: 'IPC_BAD_INPUT',
      message: `Provider "${raw}" not found in config`,
      hint: 'Re-add the provider from Settings',
    };
  }
  return { providerId: raw, entry };
}

function resolveApiKeyForListing(
  providerId: string,
  entry: ProviderEntry,
): { apiKey: string } | Extract<ModelsListResponse, { ok: false }> {
  if (isKeylessProviderAllowed(providerId, entry) && !hasApiKeyForProvider(providerId)) {
    return { apiKey: '' };
  }
  try {
    return { apiKey: getApiKeyForProvider(providerId) };
  } catch (err) {
    return {
      ok: false,
      code: 'IPC_BAD_INPUT',
      message:
        err instanceof Error ? err.message : `No API key stored for provider "${providerId}"`,
      hint: 'Open Settings and import Codex again, or add an API key for this provider',
    };
  }
}

async function handleModelsV1ListForProvider(raw: unknown): Promise<ModelsListResponse> {
  const resolved = resolveProviderForListing(raw);
  if ('ok' in resolved) return resolved;
  const { providerId, entry } = resolved;

  // Providers that expose a static hint (e.g. chatgpt-codex, whose /models
  // endpoint requires OAuth bearer + ChatGPT-Account-Id headers that this
  // keyless discovery path cannot supply) short-circuit with modelsHint.
  if (entry.modelsHint !== undefined && entry.modelsHint.length > 0) {
    return { ok: true, models: entry.modelsHint };
  }

  const keyResult = resolveApiKeyForListing(providerId, entry);
  if ('ok' in keyResult) return keyResult;
  const { apiKey } = keyResult;

  const cached = getCachedModels(providerId, entry.baseUrl, apiKey);
  if (cached !== null) return { ok: true, models: cached };

  const { url } = buildEndpointForWire(entry.wire, entry.baseUrl);
  const headers = buildAuthHeadersForWire(entry.wire, apiKey, entry.httpHeaders, entry.baseUrl);

  const bypass = entry.builtin !== true && entry.tlsRejectUnauthorized === true;
  const result = await withTlsBypass(bypass, () =>
    fetchModelListResponse(url, headers, {
      message: 'Unexpected models response shape',
      hint: 'Check provider /models endpoint compatibility',
    }),
  );
  if (result.ok) setCachedModels(providerId, entry.baseUrl, apiKey, result.models);
  return result;
}

async function fetchModelListResponse(
  url: string,
  headers: Record<string, string>,
  shapeError: { message: string; hint: string },
): Promise<ModelsListResponse> {
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
      message: shapeError.message,
      hint: shapeError.hint,
    };
  }
  return { ok: true, models: ids };
}

export async function handleConfigV1TestEndpoint(raw: unknown): Promise<TestEndpointResponse> {
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

  const targetClass = classifyNetworkTarget(payload.baseUrl);
  if (targetClass === 'metadata') {
    return {
      ok: false,
      error: 'blocked-network-target',
      message: 'Metadata service endpoints cannot be used as model provider base URLs.',
    };
  }
  if (targetClass !== 'public' && payload.allowPrivateNetwork !== true) {
    return {
      ok: false,
      error: 'private-network-confirmation-required',
      message: 'Private or local network provider URLs require explicit confirmation.',
    };
  }

  const { url, normalizedBaseUrl } = buildEndpointForWire(payload.wire, payload.baseUrl);
  const headers = buildAuthHeadersForWire(
    payload.wire,
    payload.apiKey,
    payload.httpHeaders,
    payload.baseUrl,
  );

  // This endpoint is only reachable for custom (non-built-in) providers — the
  // onboarding test path covers built-ins — so trust the payload flag directly.
  // There is no `builtin` field on the entry yet because the user hasn't saved
  // it; gating on the source instead of the entry is the right layer here.
  let res: Response;
  try {
    res = await withTlsBypass(payload.tlsRejectUnauthorized === true, () =>
      fetchWithTimeout(url, { method: 'GET', headers }),
    );
  } catch (err) {
    return {
      ok: false,
      error: 'network',
      message: err instanceof Error ? err.message : 'Network request failed',
    };
  }

  if (res.status === 404 && isInferenceWire(payload.wire)) {
    const inferenceWire = payload.wire;
    const assessed = await withTlsBypass(payload.tlsRejectUnauthorized === true, () =>
      assessInferenceCapabilities({
        wire: inferenceWire,
        baseUrl: payload.baseUrl,
        normalizedBaseUrl,
        headers,
        modelsOk: false,
      }),
    );
    if (assessed.ok) {
      return {
        ok: true,
        modelCount: 0,
        models: [],
        compatibility: assessed.compatibility ?? 'degraded-compatible',
        ...(assessed.reasons !== undefined ? { reasons: assessed.reasons } : {}),
      };
    }
    return {
      ok: false,
      error: assessed.reasonCategory === 'wrong-wire' ? 'wrong-wire' : 'not-a-model-endpoint',
      message: assessed.hint,
      compatibility: 'incompatible',
      ...(assessed.reasons !== undefined ? { reasons: assessed.reasons } : {}),
    };
  }

  const statusError = classifyTestEndpointStatus(res.status);
  if (statusError !== null) return statusError;

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: 'parse', message: 'Provider returned non-JSON' };
  }
  const ids = extractModelIds(body);
  if (ids === null) {
    return {
      ok: false,
      error: 'parse',
      message: 'Provider returned unexpected models response shape',
    };
  }
  return { ok: true, modelCount: ids.length, models: ids };
}

function classifyTestEndpointStatus(status: number): TestEndpointResponse | null {
  if (status === 401 || status === 403) {
    return { ok: false, error: 'auth', message: `HTTP ${status}` };
  }
  if (status === 404) {
    return { ok: false, error: 'not-a-model-endpoint', message: 'HTTP 404' };
  }
  if (status < 200 || status >= 300) {
    return { ok: false, error: `http-${status}`, message: `HTTP ${status}` };
  }
  return null;
}

export async function handleOllamaV1Probe(raw: unknown): Promise<OllamaProbeResponse> {
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
  return parseOllamaTagsBody(res);
}

async function parseOllamaTagsBody(res: Response): Promise<OllamaProbeResponse> {
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
}

export type OllamaProbeResponse =
  | { ok: true; models: string[] }
  | { ok: false; code: string; message: string };

function parseOllamaProbePayload(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new CodesignError('ollama:v1:probe expects a baseUrl string', ERROR_CODES.IPC_BAD_INPUT);
  }
  return normalizeOllamaBaseUrl(raw);
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
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
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
  allowPrivateNetwork?: boolean;
  tlsRejectUnauthorized?: boolean;
}

export type TestEndpointResponse =
  | {
      ok: true;
      modelCount: number;
      models: string[];
      compatibility?: 'compatible' | 'degraded-compatible';
      reasons?: ConnectionCapabilityReason[];
    }
  | {
      ok: false;
      error: string;
      message: string;
      compatibility?: 'incompatible';
      reasons?: ConnectionCapabilityReason[];
    };

function parseTestEndpointPayload(raw: unknown): TestEndpointPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('config:v1:test-endpoint expects an object', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  assertKnownFields(r, TEST_ENDPOINT_FIELDS, 'config:v1:test-endpoint');
  const wire = r['wire'];
  const baseUrl = r['baseUrl'];
  const apiKey = r['apiKey'];
  if (wire !== 'openai-chat' && wire !== 'openai-responses' && wire !== 'anthropic') {
    throw new CodesignError(`Unsupported wire: ${String(wire)}`, ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof apiKey !== 'string') {
    throw new CodesignError('apiKey must be a string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const trimmedApiKey = apiKey.trim();
  if (trimmedApiKey.length === 0) {
    throw new CodesignError('apiKey must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const out: TestEndpointPayload = {
    wire,
    baseUrl: parseHttpBaseUrl(baseUrl, 'baseUrl'),
    apiKey: trimmedApiKey,
  };
  if (r['allowPrivateNetwork'] !== undefined) {
    if (typeof r['allowPrivateNetwork'] !== 'boolean') {
      throw new CodesignError('allowPrivateNetwork must be a boolean', ERROR_CODES.IPC_BAD_INPUT);
    }
    out.allowPrivateNetwork = r['allowPrivateNetwork'];
  }
  if (r['tlsRejectUnauthorized'] !== undefined) {
    if (typeof r['tlsRejectUnauthorized'] !== 'boolean') {
      throw new CodesignError('tlsRejectUnauthorized must be a boolean', ERROR_CODES.IPC_BAD_INPUT);
    }
    out.tlsRejectUnauthorized = r['tlsRejectUnauthorized'];
  }
  const headers = parseTestEndpointHttpHeaders(r['httpHeaders']);
  if (headers !== undefined) out.httpHeaders = headers;
  return out;
}

function parseTestEndpointHttpHeaders(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CodesignError('httpHeaders must be an object', ERROR_CODES.IPC_BAD_INPUT);
  }
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== 'string') {
      throw new CodesignError(`httpHeaders.${k} must be a string`, ERROR_CODES.IPC_BAD_INPUT);
    }
    map[k] = v;
  }
  return map;
}
