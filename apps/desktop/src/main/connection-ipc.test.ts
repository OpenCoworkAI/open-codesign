import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Unit tests for pure logic extracted from connection-ipc.ts
// These tests do NOT import connection-ipc directly because that file imports
// ./electron-runtime which requires('electron') — unavailable in vitest.
// Instead we test the pure helpers inline.
// ---------------------------------------------------------------------------

// ----- Cache logic (mirrors the implementation in connection-ipc.ts) --------

interface CacheEntry {
  models: string[];
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: Map<string, CacheEntry>;

function getCacheKey(provider: string, baseUrl: string): string {
  return `${provider}::${baseUrl}`;
}

function getCachedModels(provider: string, baseUrl: string): string[] | null {
  const key = getCacheKey(provider, baseUrl);
  const entry = cache.get(key);
  if (entry === undefined) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.models;
}

function setCachedModels(provider: string, baseUrl: string, models: string[]): void {
  const key = getCacheKey(provider, baseUrl);
  cache.set(key, { models, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ----- Error classification (mirrors connection-ipc.ts) --------------------

type ErrorCode = '401' | '404' | 'ECONNREFUSED' | 'NETWORK' | 'PARSE';

function classifyHttpError(status: number): { code: ErrorCode; hint: string } {
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

// ----- ModelsListResponse error union (mirrors connection-ipc.ts) -----------

type ModelsListResponse =
  | { ok: true; models: string[] }
  | {
      ok: false;
      code: 'IPC_BAD_INPUT' | 'NETWORK' | 'HTTP' | 'PARSE';
      message: string;
      hint: string;
    };

// Minimal inline handler exercising the same logic as the real ipcMain handler.
async function handleModelsList(
  raw: unknown,
  fetchImpl: (
    url: string,
  ) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>,
): Promise<ModelsListResponse> {
  // Validate payload
  if (typeof raw !== 'object' || raw === null) {
    return {
      ok: false,
      code: 'IPC_BAD_INPUT',
      message: 'payload must be an object',
      hint: 'Invalid models:v1:list payload',
    };
  }
  const r = raw as Record<string, unknown>;
  if (
    typeof r['provider'] !== 'string' ||
    !['anthropic', 'openai', 'openrouter'].includes(r['provider'])
  ) {
    return {
      ok: false,
      code: 'IPC_BAD_INPUT',
      message: `Unsupported provider: ${String(r['provider'])}`,
      hint: 'Invalid models:v1:list payload',
    };
  }
  if (typeof r['apiKey'] !== 'string' || (r['apiKey'] as string).trim().length === 0) {
    return {
      ok: false,
      code: 'IPC_BAD_INPUT',
      message: 'apiKey must be a non-empty string',
      hint: 'Invalid models:v1:list payload',
    };
  }
  if (typeof r['baseUrl'] !== 'string' || (r['baseUrl'] as string).trim().length === 0) {
    return {
      ok: false,
      code: 'IPC_BAD_INPUT',
      message: 'baseUrl must be a non-empty string',
      hint: 'Invalid models:v1:list payload',
    };
  }

  const provider = r['provider'] as string;
  const baseUrl = (r['baseUrl'] as string).trim();

  const cached = getCachedModels(provider, baseUrl);
  if (cached !== null) return { ok: true, models: cached };

  let res: { ok: boolean; status: number; json: () => Promise<unknown> };
  try {
    res = await fetchImpl(`${baseUrl}/models`);
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

  // mirrors extractIds/extractModelIds: any item missing a string id rejects entirely
  function extractIds(items: unknown[]): string[] | null {
    const ids: string[] = [];
    for (const item of items) {
      if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
        ids.push((item as { id: string }).id);
      } else {
        return null;
      }
    }
    return ids;
  }

  function extractModelIds(b: unknown): string[] | null {
    if (b === null || typeof b !== 'object') return null;
    const data = (b as { data?: unknown }).data;
    if (Array.isArray(data)) return extractIds(data);
    const models = (b as { models?: unknown }).models;
    if (Array.isArray(models)) return extractIds(models);
    return null;
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
  setCachedModels(provider, baseUrl, ids);
  return { ok: true, models: ids };
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  cache = new Map();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// connection:v1:test — 401 hint contains "API key"
// ---------------------------------------------------------------------------

describe('classifyHttpError', () => {
  it('returns hint containing "API key" on 401', () => {
    const { hint } = classifyHttpError(401);
    expect(hint).toContain('API key');
  });

  it('returns 401 code for status 403 as well', () => {
    const { code } = classifyHttpError(403);
    expect(code).toBe('401');
  });

  it('returns 404 code and /v1 hint on 404', () => {
    const result = classifyHttpError(404);
    expect(result.code).toBe('404');
    expect(result.hint).toContain('/v1');
  });

  it('returns NETWORK code for unexpected status', () => {
    const { code } = classifyHttpError(500);
    expect(code).toBe('NETWORK');
  });
});

// ---------------------------------------------------------------------------
// models:v1:list — 5-minute cache TTL
// ---------------------------------------------------------------------------

describe('models cache (5-min TTL)', () => {
  it('returns cached models within TTL', () => {
    setCachedModels('openai', 'https://api.openai.com/v1', ['gpt-4o', 'gpt-4o-mini']);
    const result = getCachedModels('openai', 'https://api.openai.com/v1');
    expect(result).toEqual(['gpt-4o', 'gpt-4o-mini']);
  });

  it('returns null after TTL expires', () => {
    setCachedModels('openai', 'https://api.openai.com/v1', ['gpt-4o']);

    // Advance past the 5-minute TTL
    vi.advanceTimersByTime(CACHE_TTL_MS + 1);

    const result = getCachedModels('openai', 'https://api.openai.com/v1');
    expect(result).toBeNull();
  });

  it('different provider+baseUrl combinations are cached independently', () => {
    setCachedModels('openai', 'https://api.openai.com/v1', ['gpt-4o']);
    setCachedModels('openai', 'https://relay.example.com/v1', ['custom-model']);

    expect(getCachedModels('openai', 'https://api.openai.com/v1')).toEqual(['gpt-4o']);
    expect(getCachedModels('openai', 'https://relay.example.com/v1')).toEqual(['custom-model']);
  });

  it('returns null for keys not yet in cache', () => {
    expect(getCachedModels('anthropic', 'https://api.anthropic.com')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// models:v1:list — error union (no more silent [] fallback)
// ---------------------------------------------------------------------------

describe('models:v1:list error union', () => {
  it('bad payload (missing provider) → ok=false, code=IPC_BAD_INPUT', async () => {
    const result = await handleModelsList(
      { apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' },
      async () => {
        throw new Error('should not be called');
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('IPC_BAD_INPUT');
    }
  });

  it('HTTP 500 from provider → ok=false, code=HTTP', async () => {
    const result = await handleModelsList(
      { provider: 'openai', apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' },
      async () => ({ ok: false, status: 500, json: async () => ({}) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('HTTP');
      expect(result.message).toBe('HTTP 500');
    }
  });

  it('network error (fetch throws) → ok=false, code=NETWORK', async () => {
    const result = await handleModelsList(
      { provider: 'openai', apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' },
      async () => {
        throw new Error('ECONNREFUSED');
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NETWORK');
      expect(result.message).toContain('ECONNREFUSED');
    }
  });

  it('successful fetch → ok=true with model ids', async () => {
    const result = await handleModelsList(
      { provider: 'openai', apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' },
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.models).toEqual(['gpt-4o', 'gpt-4o-mini']);
    }
  });

  it('unexpected response shape { "unexpected": "thing" } → ok=false, code=PARSE, hint mentions "shape"', async () => {
    const result = await handleModelsList(
      { provider: 'openai', apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' },
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({ unexpected: 'thing' }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('PARSE');
      expect(result.hint.toLowerCase()).toContain('shape');
    }
  });

  it('mixed data array (one valid, one without id) → ok=false, code=PARSE', async () => {
    const result = await handleModelsList(
      { provider: 'openai', apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' },
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'gpt-4o' }, { foo: 'bar' }] }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('PARSE');
    }
  });

  it('data array with non-string id (number) → ok=false, code=PARSE', async () => {
    const result = await handleModelsList(
      { provider: 'openai', apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' },
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'gpt-4o' }, { id: 123 }] }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('PARSE');
    }
  });

  it('empty data array { "data": [] } → ok=true, models=[]', async () => {
    const result = await handleModelsList(
      { provider: 'openai', apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' },
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.models).toEqual([]);
    }
  });
});
