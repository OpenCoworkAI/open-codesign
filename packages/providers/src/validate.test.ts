import { CodesignError } from '@open-codesign/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pingProvider } from './validate';

const originalFetch = globalThis.fetch;

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('pingProvider', () => {
  it('throws CodesignError for unsupported providers', async () => {
    await expect(pingProvider('google', 'AIza-foo')).rejects.toBeInstanceOf(CodesignError);
  });

  it('throws when key is empty', async () => {
    await expect(pingProvider('anthropic', '')).rejects.toBeInstanceOf(CodesignError);
  });

  it('returns ok with model count for Anthropic 200', async () => {
    mockFetch(async (url, init) => {
      expect(url).toBe('https://api.anthropic.com/v1/models');
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers['x-api-key']).toBe('sk-ant-test');
      expect(headers['anthropic-version']).toBe('2023-06-01');
      return new Response(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const result = await pingProvider('anthropic', 'sk-ant-test');
    expect(result).toEqual({ ok: true, modelCount: 3 });
  });

  it('returns 401 code on Anthropic 401', async () => {
    mockFetch(async () => new Response('unauth', { status: 401 }));
    const result = await pingProvider('anthropic', 'sk-ant-bad');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('401');
      expect(result.message).toContain('anthropic');
    }
  });

  it('returns 402 code on payment required', async () => {
    mockFetch(async () => new Response('no credit', { status: 402 }));
    const result = await pingProvider('openai', 'sk-test');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('402');
  });

  it('returns 429 code on rate limit', async () => {
    mockFetch(async () => new Response('slow', { status: 429 }));
    const result = await pingProvider('openrouter', 'sk-or-test');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('429');
  });

  it('returns network code when fetch throws', async () => {
    mockFetch(async () => {
      throw new Error('ECONNREFUSED');
    });
    const result = await pingProvider('openai', 'sk-test');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('network');
      expect(result.message).toContain('ECONNREFUSED');
    }
  });

  it('uses Bearer auth header for OpenAI', async () => {
    mockFetch(async (url, init) => {
      expect(url).toBe('https://api.openai.com/v1/models');
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers['authorization']).toBe('Bearer sk-test');
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const result = await pingProvider('openai', 'sk-test');
    expect(result).toEqual({ ok: true, modelCount: 0 });
  });

  it('respects custom baseUrl without /v1 suffix', async () => {
    mockFetch(async (url) => {
      expect(url).toBe('https://proxy.example/v1/models');
      return new Response(JSON.stringify({ data: [{ id: 'x' }] }), { status: 200 });
    });
    const result = await pingProvider('openrouter', 'sk-or-test', 'https://proxy.example');
    expect(result).toEqual({ ok: true, modelCount: 1 });
  });

  it('normalizes baseUrl with /v1 suffix — no double /v1/v1/ in URL', async () => {
    mockFetch(async (url) => {
      // Must hit /v1/models exactly once, not /v1/v1/models
      expect(url).toBe('https://proxy.duckcoding.com/v1/models');
      return new Response(JSON.stringify({ data: [{ id: 'gpt-4o' }] }), { status: 200 });
    });
    const result = await pingProvider('openai', 'sk-test', 'https://proxy.duckcoding.com/v1');
    expect(result).toEqual({ ok: true, modelCount: 1 });
  });

  it('normalizes baseUrl with trailing slash — no double /v1/ in URL', async () => {
    mockFetch(async (url) => {
      expect(url).toBe('https://proxy.duckcoding.com/v1/models');
      return new Response(JSON.stringify({ data: [{ id: 'gpt-4o' }] }), { status: 200 });
    });
    const result = await pingProvider('openai', 'sk-test', 'https://proxy.duckcoding.com/v1/');
    expect(result).toEqual({ ok: true, modelCount: 1 });
  });
});
