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

function escapeYaml(value: string): string {
  if (/[:#"'\n]/.test(value)) return JSON.stringify(value);
  return value;
}

function deriveTitle(html: string): string {
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html ?? '');
  if (t?.[1]) return decodeEntities(stripTags(t[1])).trim();
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html ?? '');
  if (h1?.[1]) return decodeEntities(stripTags(h1[1])).trim();
  return 'open-codesign export';
}

function convertBody(html: string): string {
  let out = html;
  const headRe = /<head[\s>][\s\S]*?<\/head>/gi;
  out = out.replace(headRe, '');
  out = out.replace(/<script[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<style[\s\S]*?<\/style>/gi, '');
  out = out.replace(/<!--[\s\S]*?-->/g, '');

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
      .replace(/\s+/g, ' ');
    const prefix = ordered ? `${i}.` : '-';
    items.push(`${prefix} ${text}`);
    i += 1;
    m = re.exec(inner);
  }
  return `\n\n${items.join('\n')}\n\n`;
}

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, '');
}

/**
 * Allowlist URL schemes for exported Markdown. Anything outside the safe set
 * (http/https/mailto, relative URLs, fragments) returns null so the caller can
 * drop the link wrapper. Inline `data:image/*` is permitted for images only.
 */
export function sanitizeUrl(raw: string, kind: 'link' | 'image'): string | null {
  const output = stripControlChars(raw).trim();
  if (!output) return null;

  let probe = output;
  for (let i = 0; i < 3; i += 1) {
    const next = decodeEntities(probe);
    if (next === probe) break;
    probe = next;
  }
  const colonIdx = probe.indexOf(':');
  if (colonIdx > 0) {
    const schemePart = probe.slice(0, colonIdx);
    if (/%[0-9a-fA-F]{2}/.test(schemePart)) {
      try {
        probe = decodeURIComponent(schemePart) + probe.slice(colonIdx);
      } catch {
        // Leave probe untouched — the regex below will catch obviously unsafe forms.
      }
    }
  }
  probe = stripControlChars(probe).trim();

  if (/^(https?:|mailto:)/i.test(probe)) return output;
  if (kind === 'image' && /^data:image\/(png|jpe?g|gif|webp|svg\+xml|avif|bmp);/i.test(probe)) {
    return output;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(probe)) return null;
  return output;
}

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => safeFromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => safeFromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
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
