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
