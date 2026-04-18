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
      const text = decodeEntities(stripTags(inner)).trim() || href;
      return `[${text}](${href})`;
    },
  );

  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /src=["']([^"']+)["']/i.exec(tag)?.[1] ?? '';
    const alt = /alt=["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
    return src ? `![${alt}](${src})` : '';
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

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
