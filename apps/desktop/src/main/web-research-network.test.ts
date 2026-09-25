import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage, RequestOptions, request } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
  createWebResearchNetwork,
  isPublicAddress,
  normalizeSearchResults,
  publicWebUrl,
  readableHtml,
  requestPublicUrl,
  testTavilyConnection,
} from './web-research-network';

const settings = {
  enabled: true,
  apiKey: 'secret-never-log',
  maxCalls: 12,
  timeoutMs: 1000,
  maxChars: 1000,
};
function transport(
  responses: Array<{ status?: number; headers?: Record<string, string>; body?: string }>,
) {
  const seen: Array<{ url: URL; options: RequestOptions; body: string }> = [];
  const send = ((url: URL, options: RequestOptions, cb: (response: IncomingMessage) => void) => {
    const row = { url, options, body: '' };
    seen.push(row);
    const req = new EventEmitter() as ClientRequest;
    req.write = ((body: string) => {
      row.body += body;
      return true;
    }) as ClientRequest['write'];
    req.destroy = (error?: Error) => {
      if (error) req.emit('error', error);
      return req;
    };
    req.end = (() => {
      const data = responses.shift() ?? { status: 200, body: 'ok' };
      const response = new EventEmitter() as IncomingMessage;
      response.statusCode = data.status ?? 200;
      response.headers = data.headers ?? { 'content-type': 'text/plain' };
      response.destroy = (error?: Error) => {
        if (error) response.emit('error', error);
        return response;
      };
      queueMicrotask(() => {
        cb(response);
        response.emit('data', Buffer.from(data.body ?? ''));
        response.emit('end');
      });
      return req;
    }) as ClientRequest['end'];
    return req;
  }) as typeof request;
  return {
    request: send,
    seen,
    resolve: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
  };
}

describe('web research network', () => {
  it('normalizes stable IDs, missing fields and duplicate URLs without invented metadata', () => {
    const rows = normalizeSearchResults(
      {
        results: [
          { url: 'https://example.com/#a' },
          { url: 'https://example.com/#b' },
          { url: 'http://127.0.0.1' },
        ],
      },
      5,
      1000,
      'now',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: null,
      publishedAt: null,
      publisher: null,
      excerpt: null,
      retrievedAt: 'now',
      originalRead: false,
    });
    expect(rows[0]?.id).toBe(
      normalizeSearchResults({ results: [{ url: 'https://example.com/' }] }, 1, 1000, 'later')[0]
        ?.id,
    );
    expect(normalizeSearchResults({ results: [] }, 5, 1000, 'now')).toEqual([]);
    expect(() => normalizeSearchResults({}, 5, 1000, 'now')).toThrow(/invalid/);
  });
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.100.100.200',
    '0.0.0.0',
    '::1',
    '::ffff:127.0.0.1',
    'fe80::1',
    'fd00::1',
    '2002:7f00:1::',
    '2001:db8::1',
  ])('blocks non-public IP %s', (address) => expect(isPublicAddress(address)).toBe(false));
  it('allows ordinary global IPv4/IPv6 and rejects unsafe URL forms', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2001:4860:4860::8888')).toBe(true);
    for (const url of [
      'file:///a',
      'https://user:pass@example.com',
      'http://localhost',
      'http://2130706433',
      'http://0x7f000001',
      'http://example.com:3000',
    ])
      expect(() => publicWebUrl(url)).toThrow();
  });
  it('pins actual socket lookup to validated DNS and passes cancellation signal', async () => {
    const fake = transport([{ body: 'ok' }]);
    const signal = new AbortController().signal;
    await requestPublicUrl(new URL('https://example.com'), { signal }, fake);
    const options = fake.seen[0]?.options;
    expect(options?.agent).toBe(false);
    expect(options?.signal).toBe(signal);
    const callback = vi.fn();
    options?.lookup?.('example.com', { all: false }, callback);
    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    expect(fake.resolve).toHaveBeenCalledOnce();
  });
  it('rejects private DNS answers including mixed answers before connection', async () => {
    const fake = transport([]);
    fake.resolve.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.2', family: 4 },
    ]);
    await expect(
      createWebResearchNetwork(settings, fake).fetch('https://example.com'),
    ).rejects.toThrow(/Blocked/);
    expect(fake.seen).toHaveLength(0);
  });
  it('checks redirects again, including their actual DNS answers', async () => {
    const fake = transport([{ status: 302, headers: { location: 'https://other.example' } }]);
    fake.resolve
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
    await expect(
      createWebResearchNetwork(settings, fake).fetch('https://example.com'),
    ).rejects.toThrow(/Blocked/);
    expect(fake.seen).toHaveLength(1);
    const local = transport([{ status: 302, headers: { location: 'http://127.0.0.1/admin' } }]);
    await expect(
      createWebResearchNetwork(settings, local).fetch('https://example.com'),
    ).rejects.toThrow(/Blocked/);
    expect(local.seen).toHaveLength(1);
  });
  it('bounds redirects, body size, readable output and unsupported PDF', async () => {
    const redirects = transport(
      Array.from({ length: 6 }, () => ({ status: 302, headers: { location: '/again' } })),
    );
    await expect(
      createWebResearchNetwork(settings, redirects).fetch('https://example.com'),
    ).rejects.toThrow(/redirect limit/);
    const huge = transport([{ body: 'x'.repeat(1024 * 1024 + 1) }]);
    await expect(
      createWebResearchNetwork(settings, huge).fetch('https://example.com'),
    ).rejects.toThrow(/1 MiB/);
    const text = await createWebResearchNetwork(
      settings,
      transport([{ body: 'x'.repeat(2000) }]),
    ).fetch('https://example.com');
    expect(text.text.length).toBe(1000);
    expect(text.truncated).toBe(true);
    await expect(
      createWebResearchNetwork(
        settings,
        transport([{ headers: { 'content-type': 'application/pdf' } }]),
      ).fetch('https://example.com'),
    ).rejects.toThrow(/PDF/);
  });
  it('cleans scripts/styles and decodes text rather than executing content', async () => {
    expect(
      await readableHtml(
        '<title>Test &amp; more</title><script>steal()</script><style>red</style><p>Year 2025 &lt; 2030</p>',
      ),
    ).toEqual({ title: 'Test & more', text: 'Year 2025 < 2030' });
  });
  it('distinguishes disabled, unconfigured, no results, quota failure and budget exhaustion', async () => {
    await expect(
      createWebResearchNetwork({ ...settings, enabled: false }).search('a', 1),
    ).rejects.toThrow(/disabled/);
    await expect(
      createWebResearchNetwork({ ...settings, apiKey: '' }).search('a', 1),
    ).rejects.toThrow(/credentials are not configured/);
    const fake = transport([{ body: '{"results":[]}' }, { status: 429, body: 'secret-never-log' }]);
    const service = createWebResearchNetwork({ ...settings, maxCalls: 2 }, fake);
    await expect(service.search('industry', 1)).resolves.toEqual([]);
    expect(JSON.parse(fake.seen[0]?.body ?? '{}')).toMatchObject({
      query: 'industry',
      max_results: 1,
      include_answer: false,
    });
    expect(fake.seen[0]?.options.headers).toMatchObject({
      Authorization: 'Bearer secret-never-log',
    });
    await expect(service.search('industry', 1)).rejects.toThrow('HTTP 429');
    await expect(service.fetch('https://example.com')).rejects.toThrow(/budget/);
  });
  it('times out even during DNS and handles cancellation and sanitized network failures', async () => {
    const hung = { resolve: () => new Promise<never>(() => {}) };
    await expect(
      createWebResearchNetwork({ ...settings, timeoutMs: 10 }, hung).fetch('https://example.com'),
    ).rejects.toThrow(/timed out/);
    const controller = new AbortController();
    const task = createWebResearchNetwork(settings, hung).fetch(
      'https://example.com',
      controller.signal,
    );
    controller.abort();
    await expect(task).rejects.toThrow(/cancelled/);
    const broken = {
      resolve: async () => {
        throw new Error('secret-never-log');
      },
    };
    await expect(createWebResearchNetwork(settings, broken).search('industry', 1)).rejects.toThrow(
      'Web request failed (network, DNS, TLS or parsing error)',
    );
  });
});

it('aborts the in-flight request, not only a wrapper promise', async () => {
  let markStarted = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let realSignal: AbortSignal | undefined;
  const destroy = vi.fn();
  const hanging = ((_url: URL, options: RequestOptions) => {
    const req = new EventEmitter() as ClientRequest;
    realSignal = options.signal;
    req.write = (() => true) as ClientRequest['write'];
    req.end = (() => {
      markStarted();
      return req;
    }) as ClientRequest['end'];
    options.signal?.addEventListener(
      'abort',
      () => {
        destroy();
        req.emit('error', new Error('aborted'));
      },
      { once: true },
    );
    return req;
  }) as typeof request;
  const controller = new AbortController();
  const service = createWebResearchNetwork(settings, {
    request: hanging,
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
  });
  const pending = service.fetch('https://example.com', controller.signal);
  await started;
  controller.abort();
  await expect(pending).rejects.toThrow(/cancelled/);
  expect(realSignal?.aborted).toBe(true);
  expect(destroy).toHaveBeenCalledOnce();
});

describe('Tavily connection probe', () => {
  it.each([
    [200, 'ok'],
    [401, 'invalid-key'],
    [429, 'rate-limit'],
    [432, 'quota'],
    [433, 'quota'],
    [500, 'service-error'],
    [201, 'unexpected-response'],
    [204, 'unexpected-response'],
    [301, 'unexpected-response'],
    [302, 'unexpected-response'],
    [307, 'unexpected-response'],
    [308, 'unexpected-response'],
    [400, 'unexpected-response'],
    [402, 'unexpected-response'],
    [403, 'unexpected-response'],
    [404, 'unexpected-response'],
    [408, 'unexpected-response'],
    [502, 'unexpected-response'],
    [503, 'unexpected-response'],
    [504, 'unexpected-response'],
  ] as const)('maps HTTP %s to %s without retries or redirects', async (httpStatus, status) => {
    const fake = transport([
      {
        status: httpStatus,
        headers: { location: 'https://other.example/steal' },
        body: JSON.stringify({ results: [], error: settings.apiKey }),
      },
    ]);
    expect(await testTavilyConnection(settings.apiKey, 1000, fake)).toEqual({ status, httpStatus });
    expect(fake.seen).toHaveLength(1);
    expect(fake.resolve).toHaveBeenCalledOnce();
  });
  it('sends one fixed minimal basic search using Bearer auth and the bounded transport', async () => {
    const fake = transport([{ body: '{"results":[]}' }]);
    expect(await testTavilyConnection(settings.apiKey, 1000, fake)).toEqual({
      status: 'ok',
      httpStatus: 200,
    });
    expect(fake.seen).toHaveLength(1);
    const sent = fake.seen[0];
    expect(sent?.url.href).toBe('https://api.tavily.com/search');
    expect(sent?.options.method).toBe('POST');
    expect(sent?.options.agent).toBe(false);
    expect(sent?.options.headers).toMatchObject({
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json',
      'Accept-Encoding': 'identity',
    });
    expect(JSON.parse(sent?.body ?? '{}')).toEqual({
      query: 'Tavily',
      max_results: 1,
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: false,
      auto_parameters: false,
    });
    expect(sent?.body).not.toContain(settings.apiKey);
    expect(fake.resolve).toHaveBeenCalledWith('api.tavily.com');
    const lookup = vi.fn();
    sent?.options.lookup?.('api.tavily.com', { all: false }, lookup);
    expect(lookup).toHaveBeenCalledWith(null, '93.184.216.34', 4);
  });
  it.each([
    '<html>secret-never-log</html>',
    'not JSON secret-never-log',
    '{"results":',
    'null',
    '[]',
    '{}',
    '{"results":null}',
    '{"results":{}}',
    '{"results":"secret-never-log"}',
  ])('rejects malformed successful replies without leaking content: %s', async (body) => {
    const fake = transport([{ body }]);
    expect(await testTavilyConnection(settings.apiKey, 1000, fake)).toEqual({
      status: 'unexpected-response',
      httpStatus: 200,
    });
    expect(fake.seen).toHaveLength(1);
  });
  it('redacts arbitrary transport errors, even errors claiming to be timeouts', async () => {
    for (const message of [
      settings.apiKey,
      `TimeoutError ${settings.apiKey}`,
      `HTTP ${settings.apiKey}`,
    ]) {
      const fake = transport([]);
      fake.resolve.mockRejectedValue(new Error(message));
      expect(await testTavilyConnection(settings.apiKey, 1000, fake)).toEqual({
        status: 'network-error',
      });
      expect(fake.resolve).toHaveBeenCalledOnce();
      expect(fake.seen).toHaveLength(0);
    }
  });
  it('enforces public DNS and the 1 MiB response bound', async () => {
    const privateDns = transport([]);
    privateDns.resolve.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    expect(await testTavilyConnection(settings.apiKey, 1000, privateDns)).toEqual({
      status: 'network-error',
    });
    expect(privateDns.seen).toHaveLength(0);
    const huge = transport([{ body: settings.apiKey.repeat(100000) }]);
    expect(await testTavilyConnection(settings.apiKey, 1000, huge)).toEqual({
      status: 'network-error',
    });
    expect(huge.seen).toHaveLength(1);
  });
  it('times out stalled DNS and aborts the single in-flight request', async () => {
    const resolve = vi.fn(() => new Promise<never>(() => {}));
    expect(await testTavilyConnection(settings.apiKey, 10, { resolve })).toEqual({
      status: 'timeout',
    });
    expect(resolve).toHaveBeenCalledOnce();
    let signal: AbortSignal | undefined;
    const send = vi.fn((_url: URL, options: RequestOptions) => {
      signal = options.signal;
      const req = new EventEmitter() as ClientRequest;
      req.write = (() => true) as ClientRequest['write'];
      req.end = (() => req) as ClientRequest['end'];
      options.signal?.addEventListener(
        'abort',
        () => req.emit('error', new Error(settings.apiKey)),
        { once: true },
      );
      return req;
    });
    expect(
      await testTavilyConnection(settings.apiKey, 10, {
        resolve: async () => [{ address: '8.8.8.8', family: 4 }],
        request: send as typeof request,
      }),
    ).toEqual({ status: 'timeout' });
    expect(signal?.aborted).toBe(true);
    expect(send).toHaveBeenCalledOnce();
  });
  it('does not consume the active research network budget', async () => {
    const fake = transport([{ body: '{"results":[]}' }, { body: 'page' }]);
    const network = createWebResearchNetwork({ ...settings, maxCalls: 1 }, fake);
    await testTavilyConnection(settings.apiKey, 1000, fake);
    await expect(network.fetch('https://example.com')).resolves.toMatchObject({ text: 'page' });
    await expect(network.fetch('https://example.com')).rejects.toThrow(/budget/);
  });
});

describe('HTML5 text extraction (not an HTML sanitizer)', () => {
  it('handles quoted angle brackets and decodes character references once', async () => {
    expect(
      await readableHtml(
        '<title>Market &amp; growth</title><p title="a > b">2 &lt; 3 &amp; 5 &gt; 4 &copy; &#x1F680; &amp;lt;b&amp;gt;</p>',
      ),
    ).toEqual({
      title: 'Market & growth',
      text: '2 < 3 & 5 > 4 © 🚀 &lt;b&gt;',
    });
  });
  it('omits comments and active/hidden subtrees without joining surrounding data', async () => {
    const { text } = await readableHtml(
      '<p>42</p><script src="https://example.com/never-fetch.js">untrustedScript()</script><style>untrustedStyle</style><noscript>fallback</noscript><template><p>hidden-template</p></template><svg><text>hidden-svg</text></svg><iframe>hidden-frame</iframe><p hidden>hidden-attribute</p><p aria-hidden="true">hidden-aria</p><p>43</p>',
    );
    expect(text).toBe('42\n\n43');
    expect(text).not.toMatch(/untrusted|hidden|fallback|4243/);
  });
  it('keeps table cells and list items separate instead of creating new numbers', async () => {
    const { text } = await readableHtml(
      '<table><tr><td>12</td><td>34</td></tr></table><ul><li>A</li><li>B</li></ul>',
    );
    expect(text.split(/\s+/)).toEqual(['12', '34', 'A', 'B']);
  });
  it.each([
    '<scr<script>bad()</script>ipt>alert(1)</script><p>Readable</p>',
    '<<!-- remove -->script>alert(1)</script><p>Readable</p>',
    '<!-- outer <!-- nested --> --><p>Readable</p>',
    '<title>Title &lt;script&gt;literal&lt;/script&gt;</title><p>Readable</p>',
  ])('parses malformed fragments without manufacturing executable markup: %s', async (html) => {
    const result = await readableHtml(html);
    expect(result.text).toContain('Readable');
    expect(result.text).not.toMatch(/<script|<!--/i);
  });
  it.each([
    'script',
    'style',
    'noscript',
    'template',
  ])('does not leak an unfinished %s subtree into evidence', async (tag) => {
    expect((await readableHtml(`<p>Visible</p><${tag}>must-not-be-evidence`)).text).toBe('Visible');
  });
  it('preserves encoded tag literals as untrusted text, not markup to render', async () => {
    const literal = '<script>alert(1)</script>';
    expect(
      await readableHtml(
        '<title>&lt;script&gt;alert(1)&lt;/script&gt;</title><p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
      ),
    ).toEqual({ title: literal, text: literal });
  });
  it('uses an iterative tree walk for deeply nested pages', async () => {
    const html = `${'<div>'.repeat(5000)}Deep text${'</div>'.repeat(5000)}`;
    expect((await readableHtml(html)).text).toBe('Deep text');
  });
  it('keeps fetch output, saved excerpt and truncation consistent after parsing', async () => {
    const fake = transport([
      {
        headers: { 'content-type': 'text/html' },
        body: `<title>Report</title><script>hidden</script><p>${'x'.repeat(1500)}</p>`,
      },
    ]);
    const result = await createWebResearchNetwork(settings, fake).fetch(
      'https://example.com/report',
    );
    expect(result.text).toBe('x'.repeat(1000));
    expect(result.source.excerpt).toBe(result.text);
    expect(result.source.title).toBe('Report');
    expect(result.truncated).toBe(true);
    expect(fake.seen).toHaveLength(1);
  });
});
