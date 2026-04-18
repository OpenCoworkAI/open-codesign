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
  code: '401' | '404' | 'ECONNREFUSED' | 'NETWORK' | 'PARSE';
  message: string;
  hint: string;
}

export interface ModelsListResult {
  models: string[];
}

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

function buildModelsEndpoint(
  provider: SupportedOnboardingProvider,
  baseUrl: string,
): ProviderEndpoint {
  switch (provider) {
    case 'anthropic':
      // Anthropic baseUrl is typically https://api.anthropic.com (no /v1 suffix)
      // We append /v1/models if baseUrl doesn't already end with /models
      return {
        url: baseUrl.endsWith('/v1/models') ? baseUrl : `${baseUrl}/v1/models`,
        headers: {},
      };
    case 'openai':
    case 'openrouter':
      // OpenAI-compatible: baseUrl should end with /v1
      return {
        url: baseUrl.endsWith('/models') ? baseUrl : `${baseUrl}/models`,
        headers: {},
      };
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

function classifyHttpError(status: number): {
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

function extractModelIds(body: unknown): string[] {
  if (body === null || typeof body !== 'object') return [];
  const data = (body as { data?: unknown }).data;
  if (Array.isArray(data)) {
    return data
      .filter((item) => typeof item === 'object' && item !== null && 'id' in item)
      .map((item) => String((item as { id: unknown }).id));
  }
  const models = (body as { models?: unknown }).models;
  if (Array.isArray(models)) {
    return models
      .filter((item) => typeof item === 'object' && item !== null && 'id' in item)
      .map((item) => String((item as { id: unknown }).id));
  }
  return [];
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

function getCacheKey(provider: string, baseUrl: string): string {
  return `${provider}::${baseUrl}`;
}

function getCachedModels(provider: string, baseUrl: string): string[] | null {
  const key = getCacheKey(provider, baseUrl);
  const entry = modelsCache.get(key);
  if (entry === undefined) return null;
  if (Date.now() > entry.expiresAt) {
    modelsCache.delete(key);
    return null;
  }
  return entry.models;
}

function setCachedModels(provider: string, baseUrl: string, models: string[]): void {
  const key = getCacheKey(provider, baseUrl);
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
    async (_e, raw: unknown): Promise<ConnectionTestResult | ConnectionTestError> => {
      let payload: ConnectionTestPayloadV1;
      try {
        payload = parseConnectionTestPayload(raw);
      } catch (err) {
        return {
          ok: false,
          code: 'NETWORK',
          message: err instanceof Error ? err.message : 'Invalid payload',
          hint: '请检查输入参数',
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

  ipcMain.handle('models:v1:list', async (_e, raw: unknown): Promise<ModelsListResult> => {
    let payload: ModelsListPayloadV1;
    try {
      payload = parseModelsListPayload(raw);
    } catch {
      return { models: [] };
    }

    const { provider, apiKey, baseUrl } = payload;

    const cached = getCachedModels(provider, baseUrl);
    if (cached !== null) return { models: cached };

    const ep = buildModelsEndpoint(provider, baseUrl);
    const authHeaders = buildAuthHeaders(provider, apiKey);

    let res: Response;
    try {
      res = await fetch(ep.url, {
        method: 'GET',
        headers: { ...ep.headers, ...authHeaders },
      });
    } catch {
      return { models: [] };
    }

    if (!res.ok) return { models: [] };

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { models: [] };
    }

    const models = extractModelIds(body);
    setCachedModels(provider, baseUrl, models);
    return { models };
  });
}
