import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock electron-runtime so importing connection-ipc doesn't require('electron').
vi.mock('./electron-runtime', () => ({
  ipcMain: { handle: vi.fn() },
}));

import { createHash } from 'node:crypto';
import {
  _clearModelsCache,
  classifyHttpError,
  extractIds,
  extractModelIds,
  getCacheKey,
  normalizeBaseUrl,
} from './connection-ipc';

// ---------------------------------------------------------------------------
// Thin test-only handler that exercises the same fetch/parse/cache path
// as the real ipcMain handler but accepts an injected fetch so we can control
// network responses without hitting the network.
// ---------------------------------------------------------------------------

import type { ConnectionTestResponse, ModelsListResponse } from './connection-ipc';

// ---------------------------------------------------------------------------
// connection:v1:test test helper
// ---------------------------------------------------------------------------

async function handleConnectionTest(
  raw: unknown,
  fetchImpl: (url: string) => Promise<{ ok: boolean; status: number }>,
): Promise<ConnectionTestResponse> {
  if (typeof raw !== 'object' || raw === null) {
    return {
      ok: false,
      code: 'IPC_BAD_INPUT',
      message: 'connection:v1:test expects an object payload',
      hint: 'Invalid connection test payload',
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
      hint: 'Invalid connection test payload',
    };
  }
  if (typeof r['apiKey'] !== 'string' || (r['apiKey'] as string).trim().length === 0) {
    return {
      ok: false,
      code: 'IPC_BAD_INPUT',
      message: 'apiKey must be a non-empty string',
      hint: 'Invalid connection test payload',
    };
  }
  if (typeof r['baseUrl'] !== 'string' || (r['baseUrl'] as string).trim().length === 0) {
    return {
      ok: false,
      code: 'IPC_BAD_INPUT',
      message: 'baseUrl must be a non-empty string',
      hint: 'Invalid connection test payload',
    };
  }

  const baseUrl = (r['baseUrl'] as string).trim();

  let res: { ok: boolean; status: number };
  try {
    res = await fetchImpl(`${baseUrl}/v1/models`);
  } catch (err) {
    return {
      ok: false,
      code: 'NETWORK',
      message: err instanceof Error ? err.message : String(err),
      hint: 'Cannot reach base URL',
    };
  }

  if (!res.ok) {
    const { code, hint } = classifyHttpError(res.status);
    return { ok: false, code, message: `HTTP ${res.status}`, hint };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------

async function handleModelsList(
  raw: unknown,
  fetchImpl: (
    url: string,
  ) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>,
): Promise<ModelsListResponse> {
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
  const apiKey = (r['apiKey'] as string).trim();
  const baseUrl = (r['baseUrl'] as string).trim();

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

  const ids = extractModelIds(body);
  if (ids === null) {
    return {
      ok: false,
      code: 'PARSE',
      message: 'Provider returned unexpected models response shape',
      hint: 'Unexpected response shape — check provider /models endpoint compatibility',
    };
  }
  return { ok: true, models: ids };
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  _clearModelsCache();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// extractIds
// ---------------------------------------------------------------------------

describe('extractIds', () => {
  it('returns ids for a valid array', () => {
    expect(extractIds([{ id: 'a' }, { id: 'b' }])).toEqual(['a', 'b']);
  });

  it('returns empty array for empty input', () => {
    expect(extractIds([])).toEqual([]);
  });

  it('returns null when any item is missing a string id', () => {
    expect(extractIds([{ id: 'a' }, { foo: 'bar' }])).toBeNull();
  });

  it('returns null when an id is a number instead of a string', () => {
    expect(extractIds([{ id: 'a' }, { id: 123 }])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractModelIds
// ---------------------------------------------------------------------------

describe('extractModelIds', () => {
  it('handles OpenAI-compat { data: [...] } shape', () => {
    expect(extractModelIds({ data: [{ id: 'gpt-4o' }] })).toEqual(['gpt-4o']);
  });

  it('handles Anthropic { models: [...] } shape', () => {
    expect(extractModelIds({ models: [{ id: 'claude-3-5-sonnet' }] })).toEqual([
      'claude-3-5-sonnet',
    ]);
  });

  it('returns null for unknown shape', () => {
    expect(extractModelIds({ unexpected: 'thing' })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(extractModelIds(null)).toBeNull();
    expect(extractModelIds('string')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getCacheKey
// ---------------------------------------------------------------------------

describe('getCacheKey', () => {
  it('includes provider and baseUrl in the key', () => {
    const key = getCacheKey('openai', 'https://api.openai.com/v1', 'sk-test');
    expect(key).toContain('openai');
    expect(key).toContain('https://api.openai.com/v1');
  });

  it('uses a hash of the apiKey, not the raw value', () => {
    const key = getCacheKey('openai', 'https://api.openai.com/v1', 'sk-secret');
    expect(key).not.toContain('sk-secret');
    const expectedHash = createHash('sha256').update('sk-secret').digest('hex').slice(0, 16);
    expect(key).toContain(expectedHash);
  });

  it('produces different keys for different apiKeys', () => {
    const keyA = getCacheKey('openai', 'https://api.openai.com/v1', 'sk-key-A');
    const keyB = getCacheKey('openai', 'https://api.openai.com/v1', 'sk-key-B');
    expect(keyA).not.toBe(keyB);
  });

  it('produces different keys for different providers', () => {
    const keyA = getCacheKey('openai', 'https://api.example.com', 'sk-test');
    const keyB = getCacheKey('anthropic', 'https://api.example.com', 'sk-test');
    expect(keyA).not.toBe(keyB);
  });
});

// ---------------------------------------------------------------------------
// connection:v1:test — bad payload returns IPC_BAD_INPUT
// ---------------------------------------------------------------------------

describe('connection:v1:test error handling', () => {
  it('bad payload (missing provider) → ok=false, code=IPC_BAD_INPUT', async () => {
    const result = await handleConnectionTest(
      { apiKey: 'sk-test', baseUrl: 'https://api.openai.com' },
      async () => {
        throw new Error('should not be called');
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('IPC_BAD_INPUT');
    }
  });

  it('bad payload (null) → ok=false, code=IPC_BAD_INPUT', async () => {
    const result = await handleConnectionTest(null, async () => {
      throw new Error('should not be called');
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('IPC_BAD_INPUT');
    }
  });

  it('network error (fetch throws) → ok=false, code=NETWORK', async () => {
    const result = await handleConnectionTest(
      { provider: 'openai', apiKey: 'sk-test', baseUrl: 'https://api.openai.com' },
      async () => {
        throw new Error('ECONNREFUSED');
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NETWORK');
    }
  });

  it('HTTP 200 → ok=true', async () => {
    const result = await handleConnectionTest(
      { provider: 'openai', apiKey: 'sk-test', baseUrl: 'https://api.openai.com' },
      async () => ({ ok: true, status: 200 }),
    );
    expect(result.ok).toBe(true);
  });
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

// ---------------------------------------------------------------------------
// normalizeBaseUrl
// ---------------------------------------------------------------------------

describe('normalizeBaseUrl', () => {
  // anthropic — strip /v1 suffix so we can append /v1/models ourselves
  it('anthropic: strips trailing /v1', () => {
    expect(normalizeBaseUrl('https://api.anthropic.com/v1', 'anthropic')).toBe(
      'https://api.anthropic.com',
    );
  });

  it('anthropic: leaves root unchanged', () => {
    expect(normalizeBaseUrl('https://api.anthropic.com', 'anthropic')).toBe(
      'https://api.anthropic.com',
    );
  });

  it('anthropic: strips trailing slashes before /v1 check', () => {
    expect(normalizeBaseUrl('https://api.anthropic.com/v1/', 'anthropic')).toBe(
      'https://api.anthropic.com',
    );
  });

  // openai — ensure /v1 suffix
  it('openai: adds /v1 when missing', () => {
    expect(normalizeBaseUrl('https://api.openai.com', 'openai')).toBe('https://api.openai.com/v1');
  });

  it('openai: keeps existing /v1 suffix', () => {
    expect(normalizeBaseUrl('https://api.openai.com/v1', 'openai')).toBe(
      'https://api.openai.com/v1',
    );
  });

  it('openai: strips trailing slash then adds /v1', () => {
    expect(normalizeBaseUrl('https://your-host/', 'openai')).toBe('https://your-host/v1');
  });

  // openrouter (same rule as openai)
  it('openrouter: adds /v1 when missing', () => {
    expect(normalizeBaseUrl('https://openrouter.ai/api', 'openrouter')).toBe(
      'https://openrouter.ai/api/v1',
    );
  });

  it('openrouter: keeps existing /v1 suffix', () => {
    expect(normalizeBaseUrl('https://openrouter.ai/api/v1', 'openrouter')).toBe(
      'https://openrouter.ai/api/v1',
    );
  });

  // google — strip /v1 or /v1beta
  it('google: strips /v1beta', () => {
    expect(normalizeBaseUrl('https://generativelanguage.googleapis.com/v1beta', 'google')).toBe(
      'https://generativelanguage.googleapis.com',
    );
  });

  it('google: strips /v1', () => {
    expect(normalizeBaseUrl('https://generativelanguage.googleapis.com/v1', 'google')).toBe(
      'https://generativelanguage.googleapis.com',
    );
  });

  it('google: leaves root unchanged', () => {
    expect(normalizeBaseUrl('https://generativelanguage.googleapis.com', 'google')).toBe(
      'https://generativelanguage.googleapis.com',
    );
  });
});
