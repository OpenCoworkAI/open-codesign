import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage, RequestOptions, request } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createWebResearchNetwork } from './web-research-network';

function transport(body: unknown, status = 200) {
  const seen: Array<{ url: string; body: string; authorization: unknown }> = [];
  const send = ((url: URL, options: RequestOptions, callback: (res: IncomingMessage) => void) => {
    const row = {
      url: url.href,
      body: '',
      authorization: (options.headers as Record<string, unknown>)?.['Authorization'],
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
