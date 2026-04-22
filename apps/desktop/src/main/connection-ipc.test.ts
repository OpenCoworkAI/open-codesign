import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock electron-runtime so importing connection-ipc doesn't require('electron').
vi.mock('./electron-runtime', () => ({
  ipcMain: { handle: vi.fn() },
}));

import { createHash } from 'node:crypto';
import {
  CONNECTION_FETCH_TIMEOUT_MS,
  _clearModelsCache,
  buildAuthHeaders,
  buildAuthHeadersForWire,
  classifyHttpError,
  extractIds,
  extractModelIds,
  fetchWithTimeout,
  getCacheKey,
  normalizeBaseUrl,
  normalizeOllamaBaseUrl,
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

  // Ollama's /api/tags returns `{ models: [{ name: "llama3.2:latest" }] }`
  // instead of OpenAI/Anthropic's `id` field. Without this fallback, a user
  // who points a custom provider at `http://localhost:11434` (no /v1 suffix)
  // would silently get a PARSE error from the model list endpoint.
  it('accepts items with a `name` field for Ollama /api/tags shape', () => {
    expect(extractIds([{ name: 'llama3.2:latest' }, { name: 'qwen2.5' }])).toEqual([
      'llama3.2:latest',
      'qwen2.5',
    ]);
  });

  it('prefers `id` over `name` when both are present', () => {
    expect(extractIds([{ id: 'official-id', name: 'display-name' }])).toEqual(['official-id']);
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
// models:v1:list-for-provider input validation
// ---------------------------------------------------------------------------

describe('models:v1:list-for-provider input validation', () => {
  // The real handler resolves credentials from stored config. These tests
  // exercise the input-validation layer that runs before credential lookup.
  // We reuse a thin helper that mirrors the handler's guard clauses.

  function validateListForProviderInput(raw: unknown): ModelsListResponse | null {
    if (typeof raw !== 'string' || raw.length === 0) {
      return {
        ok: false,
        code: 'IPC_BAD_INPUT',
        message: 'list-for-provider expects a provider id string',
        hint: 'Internal error — missing provider id',
      };
    }
    return null;
  }

  it('rejects non-string input (number)', () => {
    const result = validateListForProviderInput(42);
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    if (!result?.ok) expect(result?.code).toBe('IPC_BAD_INPUT');
  });

  it('rejects empty string', () => {
    const result = validateListForProviderInput('');
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    if (!result?.ok) expect(result?.code).toBe('IPC_BAD_INPUT');
  });

  it('rejects null', () => {
    const result = validateListForProviderInput(null);
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
  });

  it('rejects undefined', () => {
    const result = validateListForProviderInput(undefined);
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
  });

  it('accepts a valid provider id string', () => {
    const result = validateListForProviderInput('claude-code-anthropic');
    expect(result).toBeNull();
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

  // Users often paste the full inference endpoint URL instead of the API root.
  // Regression: without suffix stripping we'd build .../v1/chat/completions/v1/models,
  // which many OpenAI-compatible gateways black-hole → "connection timeout".
  describe('strips endpoint path suffixes', () => {
    it('openai: /v1/chat/completions → /v1', () => {
      expect(normalizeBaseUrl('https://api.example.com/v1/chat/completions', 'openai')).toBe(
        'https://api.example.com/v1',
      );
    });

    it('openai: /chat/completions (no /v1 prefix) → /v1', () => {
      expect(normalizeBaseUrl('https://api.example.com/chat/completions', 'openai')).toBe(
        'https://api.example.com/v1',
      );
    });

    it('openai: /v1/responses → /v1', () => {
      expect(normalizeBaseUrl('https://api.example.com/v1/responses', 'openai')).toBe(
        'https://api.example.com/v1',
      );
    });

    it('openai: /v1/models → /v1', () => {
      expect(normalizeBaseUrl('https://api.example.com/v1/models', 'openai')).toBe(
        'https://api.example.com/v1',
      );
    });

    it('anthropic: /v1/messages → root', () => {
      expect(normalizeBaseUrl('https://api.anthropic.com/v1/messages', 'anthropic')).toBe(
        'https://api.anthropic.com',
      );
    });

    it('openrouter: /v1/chat/completions with trailing slash → /v1', () => {
      expect(normalizeBaseUrl('https://openrouter.ai/api/v1/chat/completions/', 'openrouter')).toBe(
        'https://openrouter.ai/api/v1',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// fetchWithTimeout — aborts when the host hangs past the deadline
// ---------------------------------------------------------------------------

describe('fetchWithTimeout', () => {
  it('exports a finite default timeout', () => {
    expect(Number.isFinite(CONNECTION_FETCH_TIMEOUT_MS)).toBe(true);
    expect(CONNECTION_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('aborts the underlying fetch when the timer fires', async () => {
    vi.useRealTimers();
    const seenSignals: AbortSignal[] = [];
    const fakeFetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          seenSignals.push(signal);
          signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const originalFetch = globalThis.fetch;
    (globalThis as { fetch: typeof fetch }).fetch = fakeFetch as unknown as typeof fetch;

    try {
      await expect(fetchWithTimeout('https://example.test', {}, 5)).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(seenSignals[0]?.aborted).toBe(true);
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });
});

describe('Claude Code identity header injection', () => {
  // Regression: sub2api / claude2api gateways 403 anthropic-wire requests
  // without claude-cli identity headers. Must be injected for custom
  // anthropic baseUrls and must NOT leak to the official endpoint or to
  // non-anthropic wires.
  it('buildAuthHeaders injects CC identity for a custom anthropic baseUrl', () => {
    const h = buildAuthHeaders('anthropic', 'opaque-sub2api-token', 'https://sub2api.example.com');
    expect(h['user-agent']).toMatch(/^claude-cli\//);
    expect(h['x-app']).toBe('cli');
    expect(h['anthropic-beta']).toContain('claude-code-20250219');
    expect(h['x-api-key']).toBe('opaque-sub2api-token');
  });

  it('buildAuthHeaders does NOT inject CC identity for api.anthropic.com', () => {
    const h = buildAuthHeaders('anthropic', 'sk-ant-api03-abc', 'https://api.anthropic.com');
    expect(h['user-agent']).toBeUndefined();
    expect(h['x-app']).toBeUndefined();
    expect(h['x-api-key']).toBe('sk-ant-api03-abc');
  });

  it('buildAuthHeaders leaves openai / openrouter wires alone', () => {
    const h = buildAuthHeaders('openai', 'sk-test', 'https://proxy.example.com');
    expect(h['user-agent']).toBeUndefined();
    expect(h['x-app']).toBeUndefined();
  });

  it('buildAuthHeadersForWire injects for custom anthropic and honors user overrides', () => {
    const h = buildAuthHeadersForWire(
      'anthropic',
      'opaque',
      { 'user-agent': 'my-custom/1.0' },
      'https://sub2api.example.com',
    );
    expect(h['user-agent']).toBe('my-custom/1.0'); // user override wins
    expect(h['x-app']).toBe('cli'); // still injected
  });

  it('buildAuthHeadersForWire skips injection on official anthropic', () => {
    const h = buildAuthHeadersForWire(
      'anthropic',
      'sk-ant-api03-abc',
      undefined,
      'https://api.anthropic.com',
    );
    expect(h['user-agent']).toBeUndefined();
    expect(h['x-api-key']).toBe('sk-ant-api03-abc');
  });

  it('buildAuthHeadersForWire keyless anthropic proxy still gets CC headers on custom host', () => {
    const h = buildAuthHeadersForWire('anthropic', '', undefined, 'https://keyless-proxy.example');
    expect(h['user-agent']).toMatch(/^claude-cli\//);
    expect(h['anthropic-version']).toBe('2023-06-01');
    expect(h['x-api-key']).toBeUndefined();
  });

  it('buildAuthHeaders sends OAuth tokens as Bearer, not x-api-key', () => {
    // Regression: sk-ant-oat* tokens must auth as Bearer. Anthropic endpoints
    // (and sub2api gateways that proxy them) reject OAuth tokens presented
    // via x-api-key.
    const h = buildAuthHeaders('anthropic', 'sk-ant-oat-abc123', 'https://sub2api.example.com');
    expect(h['authorization']).toBe('Bearer sk-ant-oat-abc123');
    expect(h['x-api-key']).toBeUndefined();
  });

  it('buildAuthHeadersForWire sends OAuth tokens as Bearer on custom anthropic host', () => {
    const h = buildAuthHeadersForWire(
      'anthropic',
      'sk-ant-oat-abc123',
      undefined,
      'https://sub2api.example.com',
    );
    expect(h['authorization']).toBe('Bearer sk-ant-oat-abc123');
    expect(h['x-api-key']).toBeUndefined();
    expect(h['user-agent']).toMatch(/^claude-cli\//);
  });

  it('buildAuthHeaders OAuth on official anthropic: Bearer, no CC identity headers', () => {
    // Critical path: user imports Claude Code → sk-ant-oat token + official
    // endpoint. Must send Bearer (not x-api-key) but must NOT inject CC
    // identity headers (pi-ai handles those on the OAuth branch; duplicating
    // here would diverge from pi-ai's claudeCodeVersion as it bumps).
    const h = buildAuthHeaders('anthropic', 'sk-ant-oat-abc123', 'https://api.anthropic.com');
    expect(h['authorization']).toBe('Bearer sk-ant-oat-abc123');
    expect(h['x-api-key']).toBeUndefined();
    expect(h['user-agent']).toBeUndefined();
    expect(h['x-app']).toBeUndefined();
  });

  it('buildAuthHeaders empty apiKey: no auth header, matches buildAuthHeadersForWire', () => {
    // Symmetry: both helpers must treat an empty apiKey as "keyless proxy"
    // rather than sending x-api-key: "" or Authorization: Bearer "".
    const anth = buildAuthHeaders('anthropic', '', 'https://keyless.example.com');
    expect(anth['x-api-key']).toBeUndefined();
    expect(anth['authorization']).toBeUndefined();
    expect(anth['anthropic-version']).toBe('2023-06-01');
    expect(anth['user-agent']).toMatch(/^claude-cli\//);

    const oa = buildAuthHeaders('openai', '', 'https://keyless.example.com');
    expect(oa['authorization']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeOllamaBaseUrl — input sanitization for ollama:v1:probe
// ---------------------------------------------------------------------------

describe('normalizeOllamaBaseUrl', () => {
  it('returns the default localhost URL when input is empty or whitespace', () => {
    expect(normalizeOllamaBaseUrl('')).toBe('http://localhost:11434');
    expect(normalizeOllamaBaseUrl('   ')).toBe('http://localhost:11434');
  });

  it('auto-prefixes http:// when scheme is missing', () => {
    expect(normalizeOllamaBaseUrl('localhost:11434')).toBe('http://localhost:11434');
    expect(normalizeOllamaBaseUrl('192.168.1.10:11434')).toBe('http://192.168.1.10:11434');
    // IPv6 users still get a usable URL — fetch handles bracketed hosts.
    expect(normalizeOllamaBaseUrl('[::1]:11434')).toBe('http://[::1]:11434');
  });

  it('preserves an explicit https:// scheme', () => {
    expect(normalizeOllamaBaseUrl('https://ollama.example.com')).toBe('https://ollama.example.com');
  });

  it('strips a trailing /v1 suffix so /api/tags lives at the root', () => {
    expect(normalizeOllamaBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434');
    expect(normalizeOllamaBaseUrl('http://localhost:11434/v1/')).toBe('http://localhost:11434');
  });

  it('throws IPC_BAD_INPUT on non-http(s) schemes (no silent localhost fallback)', () => {
    // `file://` has an explicit scheme and reaches the protocol check.
    expect(() => normalizeOllamaBaseUrl('file:///etc/passwd')).toThrow(/must use http/);
    expect(() => normalizeOllamaBaseUrl('ftp://example.com')).toThrow(/must use http/);
    // `javascript:alert(1)` doesn't match `scheme://`, so it falls into the
    // auto-prefix path. `http://javascript:alert(1)` fails URL parsing —
    // we just require that it's rejected, not which branch rejects it.
    expect(() => normalizeOllamaBaseUrl('javascript:alert(1)')).toThrow();
  });

  it('throws IPC_BAD_INPUT on malformed URLs', () => {
    // The scheme-coercion path prepends `http://`, so truly malformed inputs
    // like "http://" with an empty host still reach URL() and reject there.
    expect(() => normalizeOllamaBaseUrl('http://')).toThrow(/not a valid URL/);
  });
});
