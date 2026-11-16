import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage, RequestOptions, request } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { createWebResearchNetwork, testSearchConnection } from './web-research-network';

function transport(body: unknown, status = 200) {
  const seen: Array<{
    url: string;
    body: string;
    authorization: unknown;
    headers: Record<string, unknown>;
  }> = [];
  const send = ((url: URL, options: RequestOptions, callback: (res: IncomingMessage) => void) => {
    const row = {
      url: url.href,
      body: '',
      authorization: (options.headers as Record<string, unknown>)?.['Authorization'],
      headers: options.headers as Record<string, unknown>,
    };
    seen.push(row);
    const req = new EventEmitter() as ClientRequest;
    req.write = ((value: string) => {
      row.body += value;
      return true;
    }) as ClientRequest['write'];
    req.end = (() => {
      queueMicrotask(() => {
        const res = new EventEmitter() as IncomingMessage;
        res.statusCode = status;
        res.headers = { 'content-type': 'application/json' };
        callback(res);
        res.emit('data', Buffer.from(JSON.stringify(body)));
        res.emit('end');
      });
      return req;
    }) as ClientRequest['end'];
    return req;
  }) as typeof request;
  return { seen, request: send, resolve: async () => [{ address: '8.8.8.8', family: 4 }] };
}

const options = {
  enabled: true,
  apiKey: 'fixture-never-log',
  timeoutMs: 1000,
  maxChars: 2000,
  maxCalls: 2,
};

describe('supplier search APIs', () => {
  it('applies public DNS checks and rejects invalid result counts before Keenable transport', async () => {
    const fake = transport({ results: [] });
    const network = createWebResearchNetwork(
      { ...options, service: 'keenable' },
      { ...fake, resolve: async () => [{ address: '127.0.0.1', family: 4 }] },
    );
    await expect(network.search('query', 6)).rejects.toThrow(/1–5/);
    await expect(network.search('query', 1)).rejects.toThrow(/non-public DNS/);
    expect(fake.seen).toHaveLength(0);
  });
  it('bounds Keenable diagnostics by the configured deadline without retries', async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn();
      const pending = testSearchConnection('keenable', '', 1000, {
        resolve: () => new Promise<never>(() => {}),
        request,
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(await pending).toEqual({ status: 'timeout' });
      expect(request).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('uses the public Keenable API without reading or sending any saved credential', async () => {
    const fake = transport({
      results: [
        { url: 'http://127.0.0.1/private', title: 'skip' },
        {
          url: 'https://example.com/a',
          title: 'Title',
          snippet: 'x'.repeat(3000),
          published_at: '2026-11-01T00:00:00Z',
        },
        { url: 'https://example.com/a', title: 'Duplicate' },
        { url: 'https://example.com/b', title: 'Second', description: 'Fallback snippet' },
        { url: 'https://example.com/c', title: 'extra' },
      ],
    });
    const getApiKey = vi.fn(() => {
      throw new Error('must not read a credential');
    });
    const network = createWebResearchNetwork(
      { ...options, service: 'keenable', getApiKey, maxChars: 12000 },
      fake,
    );
    const sources = await network.search('query', 2);
    expect(getApiKey).not.toHaveBeenCalled();
    expect(fake.seen).toHaveLength(1);
    expect(fake.seen[0]?.url).toBe('https://api.keenable.ai/v1/search/public');
    expect(fake.seen[0]?.headers).toMatchObject({
      'X-Keenable-Title': 'Open CoDesign',
      'Content-Type': 'application/json',
    });
    expect(fake.seen[0]?.authorization).toBeUndefined();
    expect(fake.seen[0]?.headers['X-API-Key']).toBeUndefined();
    expect(JSON.parse(fake.seen[0]?.body ?? '')).toEqual({ query: 'query', max_results: 2 });
    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({
      url: 'https://example.com/a',
      title: 'Title',
      publishedAt: '2026-11-01T00:00:00Z',
      originalRead: false,
    });
    expect(sources[0]?.excerpt).toHaveLength(2000);
    expect(sources[1]?.excerpt).toBe('Fallback snippet');
    expect(JSON.stringify(fake.seen)).not.toContain(options.apiKey);
  });
  it.each([
    429, 500,
  ])('retains the shared call budget and never falls back after Keenable HTTP %i', async (status) => {
    const fake = transport({ error: 'no body should be exposed' }, status);
    const network = createWebResearchNetwork(
      { ...options, service: 'keenable', maxCalls: 1 },
      fake,
    );
    await expect(network.search('query', 1)).rejects.toThrow(`HTTP ${status}`);
    await expect(network.fetch('https://example.com')).rejects.toThrow(/budget/);
    expect(fake.seen).toHaveLength(1);
    expect(fake.seen[0]?.url).toContain('api.keenable.ai');
  });
  it('tests the public search once and rejects malformed success responses', async () => {
    const fake = transport({ results: [] });
    expect(await testSearchConnection('keenable', '', 1000, fake)).toEqual({ status: 'ok' });
    expect(fake.seen).toHaveLength(1);
    expect(JSON.parse(fake.seen[0]?.body ?? '')).toEqual({
      query: 'Open CoDesign',
      max_results: 1,
    });
    expect(await testSearchConnection('keenable', '', 1000, transport({}))).toEqual({
      status: 'unexpected-response',
    });
    expect(await testSearchConnection('keenable', '', 1000, transport({}, 429))).toEqual({
      status: 'rate-limit',
      httpStatus: 429,
    });
    expect(await testSearchConnection('keenable', '', 1000, transport({}, 403))).toEqual({
      status: 'service-error',
      httpStatus: 403,
    });
  });
  it.each([
    [
      'deepseek',
      {
        results: [
          {
            url: 'https://example.com/a',
            title: 'Title',
            summary: 'Evidence',
            site_name: 'Publisher',
            date: '2026-10-24',
          },
        ],
      },
      'https://api.deepseek.com/v1/tools/search',
      { query: 'query', count: 2, need_content: false },
    ],
    [
      'kimi',
      {
        search_results: [
          {
            url: 'https://example.com/a',
            title: 'Title',
            snippet: 'Evidence',
            site_name: 'Publisher',
            date: '2026-10-24',
          },
        ],
      },
      'https://api.moonshot.cn/v1/tools/search_pro',
      { text_query: 'query', limit: 2 },
    ],
    [
      'zhipu',
      {
        search_result: [
          {
            link: 'https://example.com/a',
            title: 'Title',
            content: 'Evidence',
            media: 'Publisher',
            publish_date: '2026-10-24',
          },
        ],
      },
      'https://open.bigmodel.cn/api/paas/v4/web_search',
      { search_query: 'query', search_engine: 'search_std', search_intent: false, count: 2 },
    ],
  ] as const)('normalizes %s and uses only its official endpoint', async (service, body, endpoint, requestBody) => {
    const fake = transport(body);
    const network = createWebResearchNetwork({ ...options, service }, fake);
    const sources = await network.search('query', 2);
    expect(fake.seen).toHaveLength(1);
    expect(fake.seen[0]?.url).toBe(endpoint);
    expect(JSON.parse(fake.seen[0]?.body ?? '')).toMatchObject(requestBody);
    expect(fake.seen[0]?.authorization).toBe('Bearer fixture-never-log');
    expect(sources[0]).toMatchObject({
      url: 'https://example.com/a',
      title: 'Title',
      excerpt: 'Evidence',
      publisher: 'Publisher',
      publishedAt: '2026-10-24',
      originalRead: false,
    });
  });
  it.each([
    ['deepseek', 128],
    ['zhipu', 70],
  ] as const)('rejects excessive %s queries before transport', async (service, max) => {
    const fake = transport({});
    const network = createWebResearchNetwork({ ...options, service }, fake);
    await expect(network.search('界'.repeat(max + 1), 1)).rejects.toThrow(/query|characters/i);
    expect(fake.seen).toHaveLength(0);
  });
  it('does not retry another provider after an authentication failure', async () => {
    const fake = transport({ message: 'fixture-never-log' }, 403);
    const network = createWebResearchNetwork({ ...options, service: 'deepseek' }, fake);
    await expect(network.search('query', 1)).rejects.toThrow(/HTTP 403/);
    expect(fake.seen).toHaveLength(1);
  });
  it('rejects malformed provider responses and skips unsafe sources', async () => {
    const malformed = createWebResearchNetwork({ ...options, service: 'kimi' }, transport({}));
    await expect(malformed.search('query', 1)).rejects.toThrow(/invalid|failed/);
    const network = createWebResearchNetwork(
      { ...options, service: 'zhipu' },
      transport({
        search_result: [
          { link: 'http://127.0.0.1/a' },
          { link: 'https://example.com', content: 'text' },
        ],
      }),
    );
    expect(await network.search('query', 2)).toHaveLength(1);
  });
});
