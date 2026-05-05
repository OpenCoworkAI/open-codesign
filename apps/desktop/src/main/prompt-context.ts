import { lookup as dnsLookup } from 'node:dns/promises';
import { open, readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { extname, isAbsolute } from 'node:path';
import type { AttachmentContext, ProjectContext, ReferenceUrlContext } from '@open-codesign/core';
import {
  CodesignError,
  ERROR_CODES,
  formatDesignMdForPrompt,
  type LocalInputFile,
  type StoredDesignSystem,
  validateDesignMd,
} from '@open-codesign/shared';
import {
  collapseWhitespace,
  extractHtmlElementInner,
  getHtmlAttribute,
  removeHtmlElementBlocks,
  stripHtmlTags,
} from '@open-codesign/shared/html-utils';
import { resolveSafeWorkspaceChildPath } from './workspace-reader';

const TEXT_EXTS = new Set([
  '.css',
  '.csv',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.less',
  '.md',
  '.mjs',
  '.scss',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const MAX_ATTACHMENT_CHARS = 6_000;
const MAX_TEXT_ATTACHMENT_BYTES = 256_000;
const MAX_BINARY_ATTACHMENT_BYTES = 10_000_000; // 10MB - images get full read for data URL, non-image binary only needs filename
const MAX_URL_EXCERPT_CHARS = 1_200;
const MAX_URL_RESPONSE_BYTES = 256_000;
const MAX_REFERENCE_URL_REDIRECTS = 3;
const MAX_PROJECT_CONTEXT_CHARS = 10_000;
const MAX_PROJECT_SETTINGS_CHARS = 4_000;
const REFERENCE_CONTENT_TYPES = ['text/html', 'application/xhtml+xml'];
const ALLOWED_PROJECT_SETTING_KEYS = new Set([
  'schemaVersion',
  'artifactType',
  'brandRef',
  'defaultBrandRef',
  'density',
  'designSystemPath',
  'fidelity',
  'language',
  'preferredSkills',
  'theme',
  'viewport',
]);

type ReferenceHostResolver = (hostname: string) => Promise<string[]>;
type ReferenceFetcher = (
  safeUrl: string,
  signal: AbortSignal,
  resolveReferenceHost: ReferenceHostResolver,
) => Promise<Response>;

async function defaultResolveReferenceHost(hostname: string): Promise<string[]> {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => entry.address);
}

function parseReferenceHttpUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    throw new CodesignError(
      'Reference URL is not a valid HTTP(S) URL',
      ERROR_CODES.REFERENCE_URL_UNSUPPORTED,
      { cause: error },
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CodesignError(
      `Unsupported reference URL protocol "${parsed.protocol || 'unknown'}"`,
      ERROR_CODES.REFERENCE_URL_UNSUPPORTED,
    );
  }
  if (parsed.username || parsed.password) {
    throw new CodesignError(
      'Reference URL must not include embedded credentials',
      ERROR_CODES.REFERENCE_URL_UNSUPPORTED,
    );
  }
  if (isPrivateReferenceHostname(parsed.hostname)) {
    throw new CodesignError(
      `Reference URL host "${parsed.hostname}" is not allowed`,
      ERROR_CODES.REFERENCE_URL_UNSUPPORTED,
    );
  }
  return parsed;
}

function isPrivateReferenceHostname(rawHostname: string): boolean {
  const hostname = rawHostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    return true;
  }

  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4) return isPrivateIpv4(hostname);
  if (ipVersion === 6) return isPrivateIpv6(hostname);
  return false;
}

async function validateResolvedReferenceHost(
  parsedUrl: URL,
  resolveReferenceHost: ReferenceHostResolver,
  signal: AbortSignal,
): Promise<void> {
  const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/g, '');
  if (net.isIP(hostname)) return;

  try {
    await resolvePublicReferenceAddresses(hostname, resolveReferenceHost, signal);
  } catch (cause) {
    if (cause instanceof CodesignError) throw cause;
    throw new CodesignError(
      `Reference URL host "${parsedUrl.hostname}" could not be resolved`,
      ERROR_CODES.REFERENCE_URL_FETCH_FAILED,
      { cause },
    );
  }
}

async function resolvePublicReferenceAddresses(
  hostname: string,
  resolveReferenceHost: ReferenceHostResolver,
  signal: AbortSignal,
): Promise<string[]> {
  if (signal.aborted) {
    throw new CodesignError(
      `Reference URL request timed out while resolving ${hostname}`,
      ERROR_CODES.REFERENCE_URL_FETCH_TIMEOUT,
    );
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(
        new CodesignError(
          `Reference URL request timed out while resolving ${hostname}`,
          ERROR_CODES.REFERENCE_URL_FETCH_TIMEOUT,
        ),
      );
    };
    signal.addEventListener('abort', onAbort, { once: true });
    resolveReferenceHost(hostname)
      .then((addresses) => {
        if (addresses.length === 0) {
          reject(
            new CodesignError(
              `Reference URL host "${hostname}" resolved to no addresses`,
              ERROR_CODES.REFERENCE_URL_FETCH_FAILED,
            ),
          );
          return;
        }
        const blocked = addresses.find((address) => isPrivateReferenceHostname(address));
        if (blocked !== undefined) {
          reject(
            new CodesignError(
              `Reference URL host "${hostname}" resolved to a blocked address`,
              ERROR_CODES.REFERENCE_URL_UNSUPPORTED,
            ),
          );
          return;
        }
        resolve(addresses);
      }, reject)
      .finally(() => {
        signal.removeEventListener('abort', onAbort);
      });
  });
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const [a, b, c] = parts;
  if (a === undefined || b === undefined || c === undefined) return true;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isPrivateIpv6(hostname: string): boolean {
  if (hostname === '::' || hostname === '::1') return true;
  if (hostname.startsWith('fc') || hostname.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(hostname)) return true;
  if (hostname.startsWith('ff')) return true;
  if (hostname.startsWith('2001:db8')) return true;
  if (!hostname.startsWith('::ffff:')) return false;

  const suffix = hostname.slice('::ffff:'.length);
  if (suffix.includes('.')) return isPrivateIpv4(suffix);
  const hextets = suffix.split(':');
  if (hextets.length !== 2) return true;
  if (!hextets.every((part) => /^[0-9a-f]{1,4}$/i.test(part))) return true;
  const high = Number.parseInt(hextets[0] ?? '', 16);
  const low = Number.parseInt(hextets[1] ?? '', 16);
  if (!Number.isInteger(high) || !Number.isInteger(low)) return true;
  if (high < 0 || high > 0xffff || low < 0 || low > 0xffff) return true;
  return isPrivateIpv4(
    [high >> 8, high & 0xff, low >> 8, low & 0xff].map((part) => String(part)).join('.'),
  );
}

function cleanText(raw: string, maxChars: number): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxChars);
}

function stripHtml(raw: string): string {
  return collapseWhitespace(
    stripHtmlTags(removeHtmlElementBlocks(removeHtmlElementBlocks(raw, 'script'), 'style')),
  ).trim();
}

function metaDescription(html: string): string | undefined {
  let description: string | undefined;
  const lower = html.toLowerCase();
  let cursor = 0;
  while (cursor < html.length) {
    const start = lower.indexOf('<meta', cursor);
    if (start < 0) break;
    const next = lower[start + 5] ?? '';
    if (next !== '>' && next.trim().length !== 0) {
      cursor = start + 5;
      continue;
    }
    const end = html.indexOf('>', start);
    if (end < 0) break;
    const attrs = html.slice(start + 5, end);
    const name = getHtmlAttribute(attrs, 'name')?.toLowerCase();
    const property = getHtmlAttribute(attrs, 'property')?.toLowerCase();
    if (name === 'description' || property === 'og:description') {
      const content = getHtmlAttribute(attrs, 'content');
      if (content) description = content;
    }
    cursor = end + 1;
  }
  return description;
}

function isProbablyText(buffer: Buffer, extension: string): boolean {
  if (TEXT_EXTS.has(extension)) return true;
  const probe = buffer.subarray(0, 512);
  return !probe.includes(0);
}

function isMissingFile(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}

async function readWorkspaceText(
  workspaceRoot: string,
  relativePath: string,
  maxChars: number,
): Promise<string | undefined> {
  let filePath: string;
  try {
    filePath = await resolveSafeWorkspaceChildPath(workspaceRoot, relativePath);
  } catch (cause) {
    throw new CodesignError(
      `Project context path is invalid: ${relativePath}`,
      ERROR_CODES.CONFIG_SCHEMA_INVALID,
      { cause },
    );
  }
  try {
    const text = await readFile(filePath, 'utf8');
    return cleanText(text, maxChars);
  } catch (err) {
    if (isMissingFile(err)) return undefined;
    throw new CodesignError(
      `Failed to read project context file "${relativePath}"`,
      ERROR_CODES.CONFIG_READ_FAILED,
      { cause: err },
    );
  }
}

async function readWorkspaceRawText(
  workspaceRoot: string,
  relativePath: string,
): Promise<string | undefined> {
  let filePath: string;
  try {
    filePath = await resolveSafeWorkspaceChildPath(workspaceRoot, relativePath);
  } catch (cause) {
    throw new CodesignError(
      `Project context path is invalid: ${relativePath}`,
      ERROR_CODES.CONFIG_SCHEMA_INVALID,
      { cause },
    );
  }
  try {
    return await readFile(filePath, 'utf8');
  } catch (err) {
    if (isMissingFile(err)) return undefined;
    throw new CodesignError(
      `Failed to read project context file "${relativePath}"`,
      ERROR_CODES.CONFIG_READ_FAILED,
      { cause: err },
    );
  }
}

function designMdContext(raw: string): Pick<ProjectContext, 'designMd' | 'invalidDesignMd'> {
  const findings = validateDesignMd(raw);
  const errors = findings.filter((finding) => finding.severity === 'error');
  if (errors.length > 0) {
    return {
      invalidDesignMd: {
        errors: errors.map((finding) => `${finding.path}: ${finding.message}`).slice(0, 10),
        raw: cleanText(raw, MAX_PROJECT_CONTEXT_CHARS),
      },
    };
  }
  try {
    return { designMd: formatDesignMdForPrompt(raw) };
  } catch (cause) {
    return {
      invalidDesignMd: {
        errors: [
          `DESIGN.md could not be prepared for prompt context: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        ],
        raw: cleanText(raw, MAX_PROJECT_CONTEXT_CHARS),
      },
    };
  }
}

function safeProjectSettings(raw: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    throw new CodesignError(
      '.codesign/settings.json is not valid JSON',
      ERROR_CODES.CONFIG_PARSE_FAILED,
      { cause: err },
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CodesignError(
      '.codesign/settings.json must contain an object',
      ERROR_CODES.CONFIG_SCHEMA_INVALID,
    );
  }
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!ALLOWED_PROJECT_SETTING_KEYS.has(key)) continue;
    if (/key|secret|token|password/i.test(key)) continue;
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      (Array.isArray(value) && value.every((item) => typeof item === 'string'))
    ) {
      safe[key] = value;
    }
  }
  const text = JSON.stringify(safe, null, 2);
  return text === '{}' ? undefined : cleanText(text, MAX_PROJECT_SETTINGS_CHARS);
}

async function readProjectContext(workspaceRoot: string | undefined): Promise<ProjectContext> {
  if (!workspaceRoot) return {};
  const [agentsMd, rawDesignMd, rawSettings] = await Promise.all([
    readWorkspaceText(workspaceRoot, 'AGENTS.md', MAX_PROJECT_CONTEXT_CHARS),
    readWorkspaceRawText(workspaceRoot, 'DESIGN.md'),
    readWorkspaceText(workspaceRoot, '.codesign/settings.json', MAX_PROJECT_SETTINGS_CHARS),
  ]);
  const settingsJson = rawSettings === undefined ? undefined : safeProjectSettings(rawSettings);
  const designMd = rawDesignMd === undefined ? {} : designMdContext(rawDesignMd);
  return {
    ...(agentsMd !== undefined ? { agentsMd } : {}),
    ...designMd,
    ...(settingsJson !== undefined ? { settingsJson } : {}),
  };
}

const WORKSPACE_ATTACHMENT_DIRS = ['references', 'assets'] as const;

function normalizePromptPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function workspaceAttachmentRelativePath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/');
  const alreadyRelative = normalizePromptPath(normalized);
  if (WORKSPACE_ATTACHMENT_DIRS.some((dir) => alreadyRelative.startsWith(`${dir}/`))) {
    return alreadyRelative;
  }

  for (const dir of WORKSPACE_ATTACHMENT_DIRS) {
    const marker = `/${dir}/`;
    const index = normalized.lastIndexOf(marker);
    if (index !== -1) return normalized.slice(index + 1);
  }
  return null;
}

async function openAttachment(
  file: LocalInputFile,
  workspaceRoot: string | undefined,
): Promise<{ handle: Awaited<ReturnType<typeof open>>; promptPath: string }> {
  const candidates: Array<{ readPath: string; promptPath: string }> = [];

  if (!isAbsolute(file.path)) {
    if (workspaceRoot !== undefined) {
      const promptPath = normalizePromptPath(file.path);
      candidates.push({
        readPath: await resolveSafeWorkspaceChildPath(workspaceRoot, promptPath),
        promptPath,
      });
    } else {
      candidates.push({ readPath: file.path, promptPath: file.path });
    }
  } else {
    candidates.push({ readPath: file.path, promptPath: file.path });
    if (workspaceRoot !== undefined) {
      const promptPath = workspaceAttachmentRelativePath(file.path);
      if (promptPath !== null) {
        candidates.push({
          readPath: await resolveSafeWorkspaceChildPath(workspaceRoot, promptPath),
          promptPath,
        });
      }
    }
  }

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return { handle: await open(candidate.readPath, 'r'), promptPath: candidate.promptPath };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function readAttachment(
  file: LocalInputFile,
  workspaceRoot: string | undefined,
): Promise<AttachmentContext> {
  const extension = extname(file.name).toLowerCase();
  const imageMimeType = IMAGE_MIME_TYPES[extension];

  // Binary attachments (images, etc) - images need full content for data URL
  // So allow larger size limit than text
  const isKnownTextExtension = TEXT_EXTS.has(extension);
  const maxFileBytes = isKnownTextExtension
    ? MAX_TEXT_ATTACHMENT_BYTES
    : MAX_BINARY_ATTACHMENT_BYTES;
  if (file.size > maxFileBytes) {
    throw new CodesignError(
      isKnownTextExtension
        ? `Text attachment "${file.name}" is too large (${file.size} bytes). Maximum is ${MAX_TEXT_ATTACHMENT_BYTES} bytes.`
        : `Binary attachment "${file.name}" is too large (${file.size} bytes). Maximum is ${MAX_BINARY_ATTACHMENT_BYTES / 1_000_000}MB.`,
      ERROR_CODES.ATTACHMENT_TOO_LARGE,
    );
  }

  let buffer: Buffer;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let promptPath = file.path;
  try {
    const opened = await openAttachment(file, workspaceRoot);
    handle = opened.handle;
    promptPath = opened.promptPath;

    // Always read a small probe first to detect if it's actually text
    const probeBytes = 512;
    const probeBuffer = Buffer.alloc(probeBytes);
    const { bytesRead: probeRead } = await handle.read(probeBuffer, 0, probeBytes, 0);
    const probe = probeBuffer.subarray(0, probeRead);

    const looksText = isProbablyText(probe, extension);
    if (looksText && file.size > MAX_TEXT_ATTACHMENT_BYTES) {
      // Any file that looks like text must obey the text size limit regardless of extension
      throw new CodesignError(
        `Text attachment "${file.name}" is too large (${file.size} bytes). Maximum is ${MAX_TEXT_ATTACHMENT_BYTES} bytes.`,
        ERROR_CODES.ATTACHMENT_TOO_LARGE,
      );
    }

    if (!looksText) {
      if (imageMimeType) {
        const length = Math.max(
          1,
          Math.min(file.size || MAX_BINARY_ATTACHMENT_BYTES, maxFileBytes),
        );
        const fullBuffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(fullBuffer, 0, fullBuffer.length, 0);
        buffer = fullBuffer.subarray(0, bytesRead);
      } else {
        // Non-image binary files stay filename-only for now.
        buffer = probe;
      }
    } else {
      // It looks like text and fits within limit - read the whole thing
      const length = Math.max(
        1,
        Math.min(file.size || MAX_TEXT_ATTACHMENT_BYTES, MAX_TEXT_ATTACHMENT_BYTES),
      );
      const fullBuffer = Buffer.alloc(length);
      // Read from start (we already have the probe, but just re-read for simplicity)
      const { bytesRead } = await handle.read(fullBuffer, 0, fullBuffer.length, 0);
      buffer = fullBuffer.subarray(0, bytesRead);
    }
  } catch (error) {
    if (error instanceof CodesignError) {
      // Already a properly coded error - rethrow directly
      throw error;
    }
    throw new CodesignError(
      `Failed to read attachment "${file.path}"`,
      ERROR_CODES.ATTACHMENT_READ_FAILED,
      {
        cause: error,
      },
    );
  } finally {
    await handle?.close();
  }

  if (!isProbablyText(buffer, extension)) {
    if (imageMimeType) {
      return {
        name: file.name,
        path: promptPath,
        note: 'Image attachment metadata is available; visual pixels may only be available on vision-capable provider paths. If image content is unavailable, use the filename and user prompt as hints.',
        mediaType: imageMimeType,
        imageDataUrl: `data:${imageMimeType};base64,${buffer.toString('base64')}`,
      };
    }
    return {
      name: file.name,
      path: promptPath,
      note: `Binary or unsupported format (${extension || 'unknown'}). Use the filename as a hint, not quoted content.`,
    };
  }

  const fullText = buffer.toString('utf8');
  return {
    name: file.name,
    path: promptPath,
    excerpt: cleanText(fullText, MAX_ATTACHMENT_CHARS),
    note:
      Buffer.byteLength(fullText, 'utf8') > MAX_ATTACHMENT_CHARS
        ? 'Excerpt truncated to the most relevant leading content.'
        : undefined,
  };
}

async function readResponseText(response: Response, url: string): Promise<string> {
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_URL_RESPONSE_BYTES) {
    throw new CodesignError(
      `Reference URL response is too large (${contentLength} bytes) for ${url}`,
      ERROR_CODES.REFERENCE_URL_TOO_LARGE,
    );
  }

  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_URL_RESPONSE_BYTES) {
      throw new CodesignError(
        `Reference URL response is too large for ${url}`,
        ERROR_CODES.REFERENCE_URL_TOO_LARGE,
      );
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_URL_RESPONSE_BYTES) {
        throw new CodesignError(
          `Reference URL response is too large for ${url}`,
          ERROR_CODES.REFERENCE_URL_TOO_LARGE,
        );
      }

      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

async function defaultFetchReference(
  safeUrl: string,
  signal: AbortSignal,
  resolveReferenceHost: ReferenceHostResolver,
): Promise<Response> {
  const parsedUrl = new URL(safeUrl);
  const client = parsedUrl.protocol === 'https:' ? https : http;
  const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/g, '');
  const lookup: http.RequestOptions['lookup'] | undefined = net.isIP(hostname)
    ? undefined
    : (lookupHostname, _options, callback) => {
        resolvePublicReferenceAddresses(lookupHostname, resolveReferenceHost, signal).then(
          (addresses) => {
            const address = addresses[0];
            const family = address ? net.isIP(address) : 0;
            if (!address || family === 0) {
              callback(
                new Error(`Reference URL host "${lookupHostname}" resolved to no IP address`),
                '',
                0,
              );
              return;
            }
            callback(null, address, family);
          },
          (error: unknown) => {
            callback(error instanceof Error ? error : new Error(String(error)), '', 0);
          },
        );
      };

  return new Promise((resolve, reject) => {
    let settled = false;
    const settleReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const settleResolve = (response: Response) => {
      if (settled) return;
      settled = true;
      resolve(response);
    };

    const req = client.request(
      parsedUrl,
      {
        method: 'GET',
        headers: { 'user-agent': 'open-codesign/0.0.0 (+local desktop app)' },
        lookup,
        signal,
      },
      (res) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) headers.append(key, item);
          } else if (value !== undefined) {
            headers.set(key, String(value));
          }
        }

        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          settleResolve(new Response(null, { status, headers }));
          return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        res.on('data', (chunk: Buffer) => {
          totalBytes += chunk.byteLength;
          if (totalBytes > MAX_URL_RESPONSE_BYTES) {
            res.destroy(
              new CodesignError(
                `Reference URL response is too large for ${safeUrl}`,
                ERROR_CODES.REFERENCE_URL_TOO_LARGE,
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          settleResolve(new Response(new Uint8Array(Buffer.concat(chunks)), { status, headers }));
        });
        res.on('error', settleReject);
      },
    );
    req.on('error', settleReject);
    req.end();
  });
}

async function fetchReferenceUrl(
  rawUrl: string,
  signal: AbortSignal,
  resolveReferenceHost: ReferenceHostResolver,
  fetchReference: ReferenceFetcher,
  redirectCount = 0,
): Promise<{ response: Response; url: string }> {
  const parsedUrl = parseReferenceHttpUrl(rawUrl);
  await validateResolvedReferenceHost(parsedUrl, resolveReferenceHost, signal);
  const safeUrl = parsedUrl.toString();
  const response = await fetchReference(safeUrl, signal, resolveReferenceHost);

  if (response.status >= 300 && response.status < 400) {
    if (redirectCount >= MAX_REFERENCE_URL_REDIRECTS) {
      throw new CodesignError(
        `Reference URL redirected too many times for ${safeUrl}`,
        ERROR_CODES.REFERENCE_URL_FETCH_FAILED,
      );
    }
    const location = response.headers.get('location');
    if (!location) {
      throw new CodesignError(
        `Reference URL redirect missing Location header for ${safeUrl}`,
        ERROR_CODES.REFERENCE_URL_FETCH_FAILED,
      );
    }
    const nextUrl = new URL(location, safeUrl).toString();
    return fetchReferenceUrl(
      nextUrl,
      signal,
      resolveReferenceHost,
      fetchReference,
      redirectCount + 1,
    );
  }

  return { response, url: safeUrl };
}

async function inspectReferenceUrl(
  url: string,
  resolveReferenceHost: ReferenceHostResolver,
  fetchReference: ReferenceFetcher,
): Promise<ReferenceUrlContext> {
  const initialSafeUrl = parseReferenceHttpUrl(url).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const { response, url: fetchedUrl } = await fetchReferenceUrl(
      initialSafeUrl,
      controller.signal,
      resolveReferenceHost,
      fetchReference,
    );
    if (!response.ok) {
      throw new CodesignError(
        `Reference URL fetch failed (${response.status}) for ${fetchedUrl}`,
        ERROR_CODES.REFERENCE_URL_FETCH_FAILED,
      );
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!REFERENCE_CONTENT_TYPES.some((type) => contentType.includes(type))) {
      throw new CodesignError(
        `Unsupported reference URL content type "${contentType || 'unknown'}" for ${fetchedUrl}`,
        ERROR_CODES.REFERENCE_URL_UNSUPPORTED,
      );
    }

    const html = await readResponseText(response, fetchedUrl);
    const title = extractHtmlElementInner(html, 'title')?.trim();
    const description = metaDescription(html);

    return {
      url: fetchedUrl,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      excerpt: cleanText(stripHtml(html), MAX_URL_EXCERPT_CHARS),
    };
  } catch (error) {
    if (error instanceof CodesignError) throw error;
    const code =
      error instanceof Error && error.name === 'AbortError'
        ? 'REFERENCE_URL_FETCH_TIMEOUT'
        : 'REFERENCE_URL_FETCH_FAILED';
    const message =
      code === 'REFERENCE_URL_FETCH_TIMEOUT'
        ? `Reference URL request timed out for ${initialSafeUrl}`
        : `Failed to fetch reference URL ${initialSafeUrl}`;
    throw new CodesignError(message, code, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

export interface PreparedPromptContext {
  designSystem: StoredDesignSystem | null;
  attachments: AttachmentContext[];
  referenceUrl: ReferenceUrlContext | null;
  projectContext: ProjectContext;
}

export async function preparePromptContext(input: {
  attachments?: LocalInputFile[] | undefined;
  referenceUrl?: string | undefined;
  designSystem?: StoredDesignSystem | null | undefined;
  resolveReferenceHost?: ReferenceHostResolver | undefined;
  fetchReference?: ReferenceFetcher | undefined;
  workspaceRoot?: string | undefined;
}): Promise<PreparedPromptContext> {
  const attachments = await Promise.all(
    (input.attachments ?? []).map((file) => readAttachment(file, input.workspaceRoot)),
  );
  const referenceUrl =
    typeof input.referenceUrl === 'string' && input.referenceUrl.trim().length > 0
      ? await inspectReferenceUrl(
          input.referenceUrl.trim(),
          input.resolveReferenceHost ?? defaultResolveReferenceHost,
          input.fetchReference ?? defaultFetchReference,
        )
      : null;
  const projectContext = await readProjectContext(input.workspaceRoot);

  return {
    designSystem: input.designSystem ?? null,
    attachments,
    referenceUrl,
    projectContext,
  };
}
