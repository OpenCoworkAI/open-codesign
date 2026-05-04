import {
  collapseWhitespace,
  decodeHtmlEntities,
  extractHtmlElementInner,
  removeHtmlComments,
  removeHtmlElementBlocks,
  stripHtmlTags,
} from '@open-codesign/shared/html-utils';
import type { ExportResult } from './index';

export interface MarkdownMeta {
  title?: string;
  schemaVersion: 1;
}

export interface ExportMarkdownOptions {
  meta?: Partial<MarkdownMeta>;
}

export async function exportMarkdown(
  htmlContent: string,
  destinationPath: string,
  opts: ExportMarkdownOptions = {},
): Promise<ExportResult> {
  const fs = await import('node:fs/promises');
  const md = htmlToMarkdown(htmlContent, {
    title: opts.meta?.title ?? deriveTitle(htmlContent),
    schemaVersion: 1,
  });
  await fs.writeFile(destinationPath, md, 'utf8');
  const stat = await fs.stat(destinationPath);
  return { bytes: stat.size, path: destinationPath };
}

/**
 * Convert a small subset of HTML to Markdown using regex passes. We never aim
 * for perfect parity — anything we cannot map cleanly is dropped. The output
 * always begins with a YAML frontmatter block carrying the schemaVersion so
 * older readers can refuse to parse a future bump.
 */
export function htmlToMarkdown(html: string, meta: MarkdownMeta): string {
  const frontmatter = renderFrontmatter(meta);
  const body = convertBody(html ?? '');
  return `${frontmatter}\n${body}`
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
    .concat('\n');
}

function renderFrontmatter(meta: MarkdownMeta): string {
  const lines = ['---'];
  if (meta.title) lines.push(`title: ${escapeYaml(meta.title)}`);
  lines.push(`schemaVersion: ${meta.schemaVersion}`);
  lines.push('---');
  return `${lines.join('\n')}\n`;
}

// YAML 1.2 reserved indicator chars that, at the start of a plain scalar,
// change parsing (sequence/flow/anchor/alias/directive/etc). Strings with
// leading/trailing whitespace also need quoting to round-trip correctly.
const YAML_LEADING_INDICATOR = /^[-?:,[\]{}#&*!|>'"%@`]/;
const YAML_NEEDS_QUOTING = /[:#"'\n]/;

function escapeYaml(value: string): string {
  if (
    YAML_NEEDS_QUOTING.test(value) ||
    YAML_LEADING_INDICATOR.test(value) ||
    value !== value.trim()
  ) {
    return JSON.stringify(value);
  }
  return value;
}

function deriveTitle(html: string): string {
  const title = extractHtmlElementInner(html ?? '', 'title');
  if (title) return decodeEntities(stripTags(title)).trim();
  const h1 = extractHtmlElementInner(html ?? '', 'h1');
  if (h1) return decodeEntities(stripTags(h1)).trim();
  return 'open-codesign export';
}

function convertBody(html: string): string {
  let out = html;
  out = removeHtmlElementBlocks(out, 'head');
  out = removeHtmlElementBlocks(out, 'script');
  out = removeHtmlElementBlocks(out, 'style');
  out = removeHtmlComments(out);

  out = out.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => {
    const text = decodeEntities(stripTags(inner));
    return `\n\n\`\`\`\n${text.trim()}\n\`\`\`\n\n`;
  });
  out = out.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner: string) => {
    return `\`${decodeEntities(stripTags(inner)).trim()}\``;
  });

  out = out.replace(
    /<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi,
    (_m, _t, inner: string) => `**${decodeEntities(stripTags(inner)).trim()}**`,
  );
  out = out.replace(
    /<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi,
    (_m, _t, inner: string) => `*${decodeEntities(stripTags(inner)).trim()}*`,
  );

  out = out.replace(
    /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, inner: string) => {
      const safeHref = sanitizeUrl(href, 'link');
      const text = decodeEntities(stripTags(inner)).trim();
      if (!safeHref) return text;
      return `[${text || safeHref}](${safeHref})`;
    },
  );

  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /src=["']([^"']+)["']/i.exec(tag)?.[1] ?? '';
    const alt = /alt=["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
    const safeSrc = sanitizeUrl(src, 'image');
    return safeSrc ? `![${alt}](${safeSrc})` : '';
  });

  out = out.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_m, inner: string) => {
    return renderTable(inner);
  });

  out = out.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => {
    const hashes = '#'.repeat(Number(level));
    return `\n\n${hashes} ${decodeEntities(stripTags(inner)).trim()}\n\n`;
  });

  out = out.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_m, inner: string) => renderList(inner, false));
  out = out.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner: string) => renderList(inner, true));

  out = out.replace(/<br\s*\/?>(\s*)/gi, '  \n');
  out = out.replace(
    /<p[^>]*>([\s\S]*?)<\/p>/gi,
    (_m, inner: string) => `\n\n${decodeEntities(stripTags(inner)).trim()}\n\n`,
  );

  out = stripTags(out);
  out = decodeEntities(out);
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderList(inner: string, ordered: boolean): string {
  const items: string[] = [];
  const re = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null = re.exec(inner);
  let i = 1;
  while (m !== null) {
    const text = decodeEntities(stripTags(m[1] ?? ''))
      .trim()
      .split('\n')
      .map((line) => collapseWhitespace(line).trim())
      .join(' ');
    const prefix = ordered ? `${i}.` : '-';
    items.push(`${prefix} ${text}`);
    i += 1;
    m = re.exec(inner);
  }
  return `\n\n${items.join('\n')}\n\n`;
}

function renderTable(inner: string): string {
  const rows: string[][] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null = trRe.exec(inner);
  while (rowMatch !== null) {
    const cells: string[] = [];
    const cellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let cellMatch: RegExpExecArray | null = cellRe.exec(rowMatch[1] ?? '');
    while (cellMatch !== null) {
      const cell = escapeMarkdownTableCell(
        collapseWhitespace(decodeEntities(stripTags(cellMatch[1] ?? ''))).trim(),
      );
      cells.push(cell);
      cellMatch = cellRe.exec(rowMatch[1] ?? '');
    }
    if (cells.length > 0) rows.push(cells);
    rowMatch = trRe.exec(inner);
  }
  if (rows.length === 0) return '';

  const width = Math.max(...rows.map((row) => row.length));
  const padded = rows.map((row) => [
    ...row,
    ...Array.from({ length: width - row.length }, () => ''),
  ]);
  const header = padded[0] ?? [];
  const separator = Array.from({ length: width }, () => '---');
  const body = padded.slice(1);
  return `\n\n${[header, separator, ...body].map((row) => `| ${row.join(' | ')} |`).join('\n')}\n\n`;
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

function stripTags(input: string): string {
  return stripHtmlTags(input);
}

/**
 * Allowlist URL schemes for exported Markdown. Anything outside the safe set
 * (http/https/mailto, relative URLs, fragments) returns null so the caller can
 * drop the link wrapper. Inline `data:image/*` is permitted for images only.
 */
export function sanitizeUrl(raw: string, kind: 'link' | 'image'): string | null {
  const output = stripControlChars(raw).trim();
  if (!output) return null;

  let probe = decodeUrlEntitiesForScheme(output);
  let encodedScheme: string | null = null;
  const colonIdx = probe.indexOf(':');
  if (colonIdx > 0) {
    const schemePart = probe.slice(0, colonIdx);
    if (hasPercentEncodedByte(schemePart)) {
      try {
        encodedScheme = urlScheme(`${decodeURIComponent(schemePart)}:`);
      } catch {
        // Leave probe untouched; the scheme parser below catches unsafe forms.
      }
    }
  }
  probe = stripControlChars(probe).trim();

  const scheme = urlScheme(probe) ?? encodedScheme;
  if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') return output;
  if (kind === 'image' && isAllowedImageDataUrl(probe)) {
    return output;
  }
  if (scheme !== null) return null;
  return output;
}

function hasPercentEncodedByte(value: string): boolean {
  for (let i = 0; i + 2 < value.length; i += 1) {
    if (value[i] !== '%') continue;
    if (isHex(value[i + 1] ?? '') && isHex(value[i + 2] ?? '')) return true;
  }
  return false;
}

function isHex(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

function urlScheme(value: string): string | null {
  const colon = value.indexOf(':');
  if (colon <= 0) return null;
  const first = value.charCodeAt(0);
  const startsAlpha = (first >= 65 && first <= 90) || (first >= 97 && first <= 122);
  if (!startsAlpha) return null;
  for (let i = 1; i < colon; i += 1) {
    const code = value.charCodeAt(i);
    const ok =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      value[i] === '+' ||
      value[i] === '.' ||
      value[i] === '-';
    if (!ok) return null;
  }
  return value.slice(0, colon).toLowerCase();
}

function isAllowedImageDataUrl(value: string): boolean {
  const lower = value.toLowerCase();
  if (!lower.startsWith('data:image/')) return false;
  const semi = lower.indexOf(';');
  if (semi < 0) return false;
  const mime = lower.slice('data:image/'.length, semi);
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg+xml', 'avif', 'bmp'].includes(mime);
}

function decodeUrlEntitiesForScheme(input: string): string {
  return decodeHtmlEntities(input);
}

function decodeEntities(input: string): string {
  return decodeHtmlEntities(input);
}

function stripControlChars(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) continue;
    out += input[i];
  }
  return out;
}
