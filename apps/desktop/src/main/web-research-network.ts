import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { WebResearchNetwork, WebSource } from '@open-codesign/shared';
import type { DefaultTreeAdapterTypes } from 'parse5';

const blocked = new BlockList();
for (const [ip, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(ip, bits, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
blocked.addSubnet('2001::', 23, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  return family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}
export function publicWebUrl(raw: string): URL {
  if (raw.length > 4096) throw new Error('Web URL is too long.');
  const url = new URL(raw);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port))
  )
    throw new Error('Only public HTTP(S) URLs on ports 80/443 without credentials are supported.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (
    hostname.endsWith('.') ||
    /(^|\.)(localhost|local|internal|home|test|invalid)$/.test(hostname) ||
    (isIP(hostname) && !isPublicAddress(hostname))
  )
    throw new Error('Blocked non-public web address.');
  url.hash = '';
  return url;
}

type Address = { address: string; family: number };
export interface HttpResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}
export interface NetworkDependencies {
  resolve?: (hostname: string) => Promise<Address[]>;
  request?: typeof httpRequest;
}

export async function requestPublicUrl(
  url: URL,
  options: { signal: AbortSignal; body?: string; authorization?: string },
  deps: NetworkDependencies = {},
): Promise<HttpResult> {
  publicWebUrl(url.href);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const signal = options.signal;
  signal.throwIfAborted();
  const resolve =
    deps.resolve ?? ((hostname: string) => lookup(hostname, { all: true, verbatim: true }));
  const resolution = isIP(host)
    ? Promise.resolve([{ address: host, family: isIP(host) }])
    : resolve(host);
  const addresses = await abortable(resolution, signal);
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new Error('Blocked non-public DNS address.');
  const pinned = addresses[0];
  if (!pinned) throw new Error('Web hostname could not be resolved.');
  signal.throwIfAborted();
  return new Promise((resolveResult, reject) => {
    const request = deps.request ?? (url.protocol === 'https:' ? httpsRequest : httpRequest);
    const requestOptions: RequestOptions = {
      method: options.body ? 'POST' : 'GET',
      agent: false,
      signal,
      headers: {
        Accept: options.body ? 'application/json' : 'text/html, text/plain',
        'Accept-Encoding': 'identity',
        'User-Agent': 'OpenCoDesign-WebResearch/1',
        ...(options.body
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(options.body),
            }
          : {}),
        ...(options.authorization ? { Authorization: options.authorization } : {}),
      },
      // Resolve once, validate all answers, then pin the actual socket to the validated IP.
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
        else callback(null, pinned.address, pinned.family);
      },
    };
    const req = request(url, requestOptions, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('error', reject);
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1024 * 1024) {
          const error = new Error('Web response exceeded the 1 MiB limit.');
          response.destroy(error);
          req.destroy(error);
          reject(error);
        } else chunks.push(chunk);
      });
      response.on('end', () =>
        resolveResult({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function stringField(value: unknown, limit: number): string | null {
  return typeof value === 'string' && value.trim() ? value.slice(0, limit) : null;
}
function sourceFor(url: string, retrievedAt: string): WebSource {
  return {
    id: `src_${createHash('sha256').update(url).digest('hex').slice(0, 24)}`,
    url,
    title: null,
    publisher: null,
    publishedAt: null,
    retrievedAt,
    excerpt: null,
    locator: null,
    originalRead: false,
  };
}
export function normalizeSearchResults(
  raw: unknown,
  count: number,
  maxChars: number,
  retrievedAt: string,
): WebSource[] {
  if (!raw || typeof raw !== 'object' || !('results' in raw) || !Array.isArray(raw.results))
    throw new Error('Search service returned an invalid result structure.');
  const sources: WebSource[] = [];
  for (const item of raw.results) {
    if (!item || typeof item !== 'object' || typeof item.url !== 'string') continue;
    let url: string;
    try {
      url = publicWebUrl(item.url).href;
    } catch {
      continue;
    }
    if (sources.some((source) => source.url === url)) continue;
    sources.push({
      ...sourceFor(url, retrievedAt),
      title: stringField(item.title, 500),
      excerpt: stringField(item.content, Math.min(maxChars, 2000)),
      publishedAt: stringField(item.published_date, 200),
    });
    if (sources.length >= count) break;
  }
  return sources;
}
const NON_CONTENT_ELEMENTS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'math',
  'iframe',
  'object',
  'embed',
  'canvas',
  'video',
  'audio',
]);
const TEXT_BREAK_ELEMENTS = new Set([
  'p',
  'div',
  'section',
  'article',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'br',
  'hr',
  'li',
  'ul',
  'ol',
  'tr',
  'td',
  'th',
  'table',
  'header',
  'footer',
  'nav',
  'main',
  'aside',
  'dl',
  'dt',
  'dd',
  'blockquote',
  'pre',
]);

// Extract untrusted text, never HTML safe for insertion. Parsing does not execute
// scripts or load resources; a regex replacement can reconstruct markup instead.
export async function readableHtml(html: string): Promise<{ text: string; title: string | null }> {
  const { parse } = await import('parse5');
  const document = parse(html, { scriptingEnabled: true });
  const text: string[] = [];
  let title: string | null = null;
  type Frame = { node: DefaultTreeAdapterTypes.Node; inBody: boolean } | { lineBreak: true };
  const stack: Frame[] = [{ node: document, inBody: false }];
  while (stack.length) {
    const frame = stack.pop();
    if (!frame) break;
    if ('lineBreak' in frame) {
      text.push('\n');
      continue;
    }
    const { node } = frame;
    let inBody = frame.inBody;
    if ('tagName' in node) {
      if (node.tagName === 'title' && title === null) {
        title =
          node.childNodes
            .filter(
              (child): child is DefaultTreeAdapterTypes.TextNode => child.nodeName === '#text',
            )
            .map((child) => child.value)
            .join('')
            .replace(/\s+/gu, ' ')
            .trim()
            .slice(0, 500) || null;
        continue;
      }
      if (
        NON_CONTENT_ELEMENTS.has(node.tagName) ||
        node.attrs.some(
          (attr) =>
            attr.name === 'hidden' || (attr.name === 'aria-hidden' && attr.value === 'true'),
        )
      ) {
        if (inBody) text.push('\n');
        continue;
      }
      inBody ||= node.tagName === 'body';
      if (inBody && TEXT_BREAK_ELEMENTS.has(node.tagName)) {
        text.push('\n');
        stack.push({ lineBreak: true });
      }
    }
    if (node.nodeName === '#text' && 'value' in node && inBody) text.push(node.value);
    if (node.nodeName === '#comment' && inBody) text.push(' ');
    if ('childNodes' in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index--) {
        const child = node.childNodes[index];
        if (child) stack.push({ node: child, inBody });
      }
    }
  }
  return {
    text: text
      .join('')
      .replace(/[^\S\n]+/gu, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    title,
  };
}

export function createWebResearchNetwork(
  options: {
    enabled: boolean;
    apiKey?: string;
    timeoutMs: number;
    maxChars: number;
    maxCalls: number;
  },
  deps: NetworkDependencies = {},
): WebResearchNetwork {
  let calls = 0;
  const run = async <T>(
    fn: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> => {
    signal?.throwIfAborted();
    if (!options.enabled)
      throw new Error(
        'Web access is disabled for web_search and web_fetch. Set enabled = true in the top-level [webSearch] section of the active config.toml, then fully quit and restart Open CoDesign. A Tavily key alone does not enable web access.',
      );
    if (calls >= options.maxCalls)
      throw new Error(
        'Web research call budget exhausted. Use saved evidence or report information gaps.',
      );
    calls++;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), options.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
    try {
      return await fn(combined);
    } catch (error) {
      if (signal?.aborted) throw new Error('Web request cancelled.');
      if (timeout.signal.aborted) throw new Error('Web request timed out.');
      const message = error instanceof Error ? error.message : '';
      if (
        /^(Blocked |Only public |Web response |Unsupported |HTTP |Search service |Web hostname )/.test(
          message,
        )
      )
        throw new Error(message);
      throw new Error(
        'Web request failed (network, DNS, TLS or parsing error). Retry or use other saved sources.',
      );
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    async search(query, count, signal) {
      if (!options.enabled)
        throw new Error(
          'Web access is disabled for web_search and web_fetch. Set enabled = true in the top-level [webSearch] section of the active config.toml, then fully quit and restart Open CoDesign. A Tavily key alone does not enable web access.',
        );
      if (!options.apiKey)
        throw new Error(
          'Tavily credentials are not configured. Set [secrets.tavily] ciphertext = "plain:YOUR_TAVILY_KEY" in the local config.toml and restart. Never paste keys into chat.',
        );
      if (
        !query.trim() ||
        query.length > 1000 ||
        !Number.isInteger(count) ||
        count < 1 ||
        count > 5
      )
        throw new Error('Invalid search query or count (1–5).');
      return run(async (combined) => {
        const response = await requestPublicUrl(
          new URL('https://api.tavily.com/search'),
          {
            signal: combined,
            authorization: `Bearer ${options.apiKey}`,
            body: JSON.stringify({
              query,
              max_results: count,
              search_depth: 'basic',
              include_answer: false,
              include_raw_content: false,
            }),
          },
          deps,
        );
        if (response.status < 200 || response.status >= 300)
          throw new Error(
            `HTTP ${response.status}: search service failed. Check the key, quota or service availability.`,
          );
        return normalizeSearchResults(
          JSON.parse(response.body),
          count,
          options.maxChars,
          new Date().toISOString(),
        );
      }, signal);
    },
    fetch(rawUrl, signal) {
      return run(async (combined) => {
        let url = publicWebUrl(rawUrl);
        for (let redirects = 0; redirects <= 5; redirects++) {
          const response = await requestPublicUrl(url, { signal: combined }, deps);
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers['location'];
            if (typeof location !== 'string' || redirects === 5)
              throw new Error('HTTP redirect limit exceeded or Location missing.');
            url = publicWebUrl(new URL(location, url).href);
            continue;
          }
          if (response.status < 200 || response.status >= 300)
            throw new Error(`HTTP ${response.status}: could not read webpage.`);
          const encoding = response.headers['content-encoding'];
          if (encoding && encoding !== 'identity')
            throw new Error('Unsupported compressed response.');
          const contentType =
            String(response.headers['content-type'] ?? '')
              .split(';')[0]
              ?.trim()
              .toLowerCase() ?? '';
          if (!['text/html', 'text/plain'].includes(contentType))
            throw new Error(
              `Unsupported content type: ${contentType === 'application/pdf' ? 'PDF is not supported in v1' : 'expected HTML or plain text'}.`,
            );
          const parsed =
            contentType === 'text/html'
              ? await readableHtml(response.body)
              : { text: response.body, title: null };
          const text = parsed.text.slice(0, options.maxChars);
          if (!text.trim())
            throw new Error(
              'Web response contained no readable text (JavaScript-only pages are unsupported).',
            );
          return {
            source: {
              ...sourceFor(url.href, new Date().toISOString()),
              title: parsed.title,
              excerpt: text,
              originalRead: true,
            },
            finalUrl: url.href,
            contentType,
            text,
            truncated: parsed.text.length > text.length,
          };
        }
        throw new Error('HTTP redirect limit exceeded.');
      }, signal);
    },
  };
}
