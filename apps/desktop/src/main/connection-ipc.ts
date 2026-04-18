import { createHash } from 'node:crypto';
import {
  CodesignError,
  type SupportedOnboardingProvider,
  isSupportedOnboardingProvider,
} from '@open-codesign/shared';
import { ipcMain } from './electron-runtime';

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
    throw new CodesignError('connection:v1:test expects an object payload', 'IPC_BAD_INPUT');
  }
  const r = raw as Record<string, unknown>;
  if (typeof r['provider'] !== 'string' || !isSupportedOnboardingProvider(r['provider'])) {
    throw new CodesignError(`Unsupported provider: ${String(r['provider'])}`, 'IPC_BAD_INPUT');
  }
  if (typeof r['apiKey'] !== 'string' || r['apiKey'].trim().length === 0) {
    throw new CodesignError('apiKey must be a non-empty string', 'IPC_BAD_INPUT');
  }
  if (typeof r['baseUrl'] !== 'string' || r['baseUrl'].trim().length === 0) {
    throw new CodesignError('baseUrl must be a non-empty string', 'IPC_BAD_INPUT');
  }
  return {
    provider: r['provider'],
    apiKey: r['apiKey'].trim(),
    baseUrl: r['baseUrl'].trim(),
  };
}

function parseModelsListPayload(raw: unknown): ModelsListPayloadV1 {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('models:v1:list expects an object payload', 'IPC_BAD_INPUT');
  }
  const r = raw as Record<string, unknown>;
  if (typeof r['provider'] !== 'string' || !isSupportedOnboardingProvider(r['provider'])) {
    throw new CodesignError(`Unsupported provider: ${String(r['provider'])}`, 'IPC_BAD_INPUT');
  }
  if (typeof r['apiKey'] !== 'string' || r['apiKey'].trim().length === 0) {
    throw new CodesignError('apiKey must be a non-empty string', 'IPC_BAD_INPUT');
  }
  if (typeof r['baseUrl'] !== 'string' || r['baseUrl'].trim().length === 0) {
    throw new CodesignError('baseUrl must be a non-empty string', 'IPC_BAD_INPUT');
  }
  return {
    provider: r['provider'],
    apiKey: r['apiKey'].trim(),
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
 * - openai / openrouter: ensure /v1 suffix — the API lives at <root>/v1/models
 * - google: strip trailing /v1 or /v1beta — we append the full path internally
 */
export function normalizeBaseUrl(
  baseUrl: string,
  provider: 'openai' | 'anthropic' | 'google' | 'openrouter',
): string {
  const cleaned = baseUrl.replace(/\/+$/, ''); // strip trailing slashes
  if (provider === 'openai' || provider === 'openrouter') {
    return cleaned.endsWith('/v1') ? cleaned : `${cleaned}/v1`;
  }
  if (provider === 'anthropic') {
    return cleaned.replace(/\/v1$/, '');
  }
  if (provider === 'google') {
    return cleaned.replace(/\/v1(beta)?$/, '');
  }
  return cleaned;
}

function buildModelsEndpoint(
  provider: SupportedOnboardingProvider,
  baseUrl: string,
): ProviderEndpoint {
  const root = normalizeBaseUrl(baseUrl, provider);
  switch (provider) {
    case 'anthropic':
      // Anthropic root has no /v1; we append the full versioned path.
      return { url: `${root}/v1/models`, headers: {} };
    case 'openai':
    case 'openrouter':
      // OpenAI-compatible: root already ends with /v1 after normalization.
      return { url: `${root}/models`, headers: {} };
  }
}

function buildAuthHeaders(
  provider: SupportedOnboardingProvider,
  apiKey: string,
): Record<string, string> {
  if (provider === 'anthropic') {
    return {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
  }
  return { authorization: `Bearer ${apiKey}` };
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

export function extractIds(items: unknown[]): string[] | null {
  const ids: string[] = [];
  for (const item of items) {
    if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
      ids.push((item as { id: string }).id);
    } else {
      // Any item missing a string id field means the shape is unexpected — reject entirely.
      return null;
    }
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
      const authHeaders = buildAuthHeaders(provider, apiKey);

      let res: Response;
      try {
        res = await fetch(ep.url, {
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
    const authHeaders = buildAuthHeaders(provider, apiKey);

    let res: Response;
    try {
      res = await fetch(ep.url, {
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
}
