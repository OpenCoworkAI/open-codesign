import { open } from 'node:fs/promises';
import { extname } from 'node:path';
import type { AttachmentContext, ReferenceUrlContext } from '@open-codesign/core';
import {
  CodesignError,
  ERROR_CODES,
  type LocalInputFile,
  type StoredDesignSystem,
} from '@open-codesign/shared';

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
const MAX_BINARY_ATTACHMENT_BYTES = 10_000_000;
const MAX_URL_EXCERPT_CHARS = 1_200;
const MAX_URL_RESPONSE_BYTES = 256_000;
const REFERENCE_CONTENT_TYPES = ['text/html', 'application/xhtml+xml'];

function cleanText(raw: string, maxChars: number): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxChars);
}

function stripHtml(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isProbablyText(buffer: Buffer, extension: string): boolean {
  if (TEXT_EXTS.has(extension)) return true;
  const probe = buffer.subarray(0, 512);
  return !probe.includes(0);
}

async function readAttachment(file: LocalInputFile): Promise<AttachmentContext> {
  const extension = extname(file.name).toLowerCase();
  const imageMimeType = IMAGE_MIME_TYPES[extension];

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
  try {
    handle = await open(file.path, 'r');

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
        path: file.path,
        note: 'Attached as an image input. Use the visual content directly, not just the filename.',
        mediaType: imageMimeType,
        imageDataUrl: `data:${imageMimeType};base64,${buffer.toString('base64')}`,
      };
    }
    return {
      name: file.name,
      path: file.path,
      note: `Binary or unsupported format (${extension || 'unknown'}). Use the filename as a hint, not quoted content.`,
    };
  }

  const fullText = buffer.toString('utf8');
  return {
    name: file.name,
    path: file.path,
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

async function inspectReferenceUrl(url: string): Promise<ReferenceUrlContext> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'open-codesign/0.0.0 (+local desktop app)' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new CodesignError(
        `Reference URL fetch failed (${response.status}) for ${url}`,
        ERROR_CODES.REFERENCE_URL_FETCH_FAILED,
      );
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!REFERENCE_CONTENT_TYPES.some((type) => contentType.includes(type))) {
      throw new CodesignError(
        `Unsupported reference URL content type "${contentType || 'unknown'}" for ${url}`,
        ERROR_CODES.REFERENCE_URL_UNSUPPORTED,
      );
    }

    const html = await readResponseText(response, url);
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
    const description =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1];

    return {
      url,
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
        ? `Reference URL request timed out for ${url}`
        : `Failed to fetch reference URL ${url}`;
    throw new CodesignError(message, code, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

export interface PreparedPromptContext {
  designSystem: StoredDesignSystem | null;
  attachments: AttachmentContext[];
  referenceUrl: ReferenceUrlContext | null;
}

export async function preparePromptContext(input: {
  attachments?: LocalInputFile[] | undefined;
  referenceUrl?: string | undefined;
  designSystem?: StoredDesignSystem | null | undefined;
}): Promise<PreparedPromptContext> {
  const attachments = await Promise.all(
    (input.attachments ?? []).map((file) => readAttachment(file)),
  );
  const referenceUrl =
    typeof input.referenceUrl === 'string' && input.referenceUrl.trim().length > 0
      ? await inspectReferenceUrl(input.referenceUrl.trim())
      : null;

  return {
    designSystem: input.designSystem ?? null,
    attachments,
    referenceUrl,
  };
}
