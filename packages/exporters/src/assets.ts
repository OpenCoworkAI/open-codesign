import path from 'node:path';

export interface LocalAssetOptions {
  /** Directory used to resolve relative HTML references. */
  assetBasePath?: string | undefined;
  /** Workspace/root directory used for root-relative references and containment. */
  assetRootPath?: string | undefined;
}

export interface CollectedAsset {
  path: string;
  content: Buffer;
}

interface ResolvedAssetReference {
  suffix: string;
  absolutePath: string;
  archivePath: string;
}

interface Replacement {
  start: number;
  end: number;
  value: string;
}

const URL_FUNC_RE = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;
const RESOURCE_ATTR_RE = /\b(src|href|poster)\s*=\s*(["'])([^"']+)\2/gi;
const SRCSET_ATTR_RE = /\bsrcset\s*=\s*(["'])([^"']+)\1/gi;

const TEXT_ENCODINGS = new Set([
  '.css',
  '.csv',
  '.html',
  '.htm',
  '.js',
  '.json',
  '.mjs',
  '.svg',
  '.txt',
  '.xml',
]);

export async function inlineLocalAssetsInHtml(
  html: string,
  opts: LocalAssetOptions = {},
): Promise<string> {
  const root = resolveRoot(opts);
  if (root === null) return html;

  const replacements: Replacement[] = [];
  await collectAttributeInlineReplacements(html, root, replacements);
  await collectSrcsetInlineReplacements(html, root, replacements);
  await collectCssUrlReplacements(html, root, root.basePath, replacements, new Set());
  return applyReplacements(html, replacements);
}

export async function collectLocalAssetsFromHtml(
  html: string,
  opts: LocalAssetOptions = {},
): Promise<CollectedAsset[]> {
  const fs = await import('node:fs/promises');
  const root = resolveRoot(opts);
  if (root === null) return [];

  const refs = collectHtmlReferences(html, root, root.basePath);
  const assets = new Map<string, CollectedAsset>();
  const seenCss = new Set<string>();

  for (const ref of refs) {
    await collectAssetTree(ref, root, assets, seenCss);
  }

  return [...assets.values()].sort((a, b) => a.path.localeCompare(b.path));

  async function collectAssetTree(
    ref: ResolvedAssetReference,
    rootPaths: ResolvedRoot,
    out: Map<string, CollectedAsset>,
    cssSeen: Set<string>,
  ): Promise<void> {
    if (out.has(ref.archivePath)) return;
    try {
      const content = await fs.readFile(ref.absolutePath);
      out.set(ref.archivePath, { path: ref.archivePath, content });
      if (
        path.extname(ref.absolutePath).toLowerCase() === '.css' &&
        !cssSeen.has(ref.absolutePath)
      ) {
        cssSeen.add(ref.absolutePath);
        const css = content.toString('utf8');
        const nested = collectCssReferences(css, rootPaths, path.dirname(ref.absolutePath));
        for (const child of nested) {
          await collectAssetTree(child, rootPaths, out, cssSeen);
        }
      }
    } catch {
      // Missing local references are left as-is in the exported HTML/ZIP.
    }
  }
}

export function rewriteHtmlLocalAssetReferences(
  html: string,
  opts: LocalAssetOptions = {},
): string {
  const root = resolveRoot(opts);
  if (root === null) return html;

  const replacements: Replacement[] = [];

  const attrRe = cloneGlobalRe(RESOURCE_ATTR_RE);
  let attr: RegExpExecArray | null = attrRe.exec(html);
  while (attr !== null) {
    const raw = attr[3] ?? '';
    const resolved = resolveAssetReference(raw, root, root.basePath);
    if (resolved !== null) {
      const valueStart = attr.index + (attr[0]?.lastIndexOf(raw) ?? -1);
      if (valueStart >= attr.index) {
        replacements.push({
          start: valueStart,
          end: valueStart + raw.length,
          value: `${resolved.archivePath}${resolved.suffix}`,
        });
      }
    }
    attr = attrRe.exec(html);
  }

  const srcsetRe = cloneGlobalRe(SRCSET_ATTR_RE);
  let srcset: RegExpExecArray | null = srcsetRe.exec(html);
  while (srcset !== null) {
    const raw = srcset[2] ?? '';
    const rewritten = rewriteSrcset(raw, root, root.basePath);
    if (rewritten !== raw) {
      const valueStart = srcset.index + (srcset[0]?.lastIndexOf(raw) ?? -1);
      if (valueStart >= srcset.index) {
        replacements.push({ start: valueStart, end: valueStart + raw.length, value: rewritten });
      }
    }
    srcset = srcsetRe.exec(html);
  }

  const urlRe = cloneGlobalRe(URL_FUNC_RE);
  let css: RegExpExecArray | null = urlRe.exec(html);
  while (css !== null) {
    const raw = (css[2] ?? '').trim();
    const resolved = resolveAssetReference(raw, root, root.basePath);
    if (resolved !== null) {
      replacements.push({
        start: css.index,
        end: css.index + (css[0]?.length ?? 0),
        value: `url("${resolved.archivePath}${resolved.suffix}")`,
      });
    }
    css = urlRe.exec(html);
  }

  return applyReplacements(html, replacements);
}

interface ResolvedRoot {
  rootPath: string;
  basePath: string;
}

function resolveRoot(opts: LocalAssetOptions): ResolvedRoot | null {
  const base = opts.assetBasePath ?? opts.assetRootPath;
  if (!base) return null;
  const root = opts.assetRootPath ?? base;
  const rootPath = path.resolve(root);
  const basePath = path.resolve(base);
  if (!isInsideRoot(basePath, rootPath)) return null;
  return { rootPath, basePath };
}

function collectHtmlReferences(
  html: string,
  root: ResolvedRoot,
  contextDir: string,
): ResolvedAssetReference[] {
  const refs: ResolvedAssetReference[] = [];

  const attrRe = cloneGlobalRe(RESOURCE_ATTR_RE);
  let attr: RegExpExecArray | null = attrRe.exec(html);
  while (attr !== null) {
    const ref = resolveAssetReference(attr[3] ?? '', root, contextDir);
    if (ref !== null) refs.push(ref);
    attr = attrRe.exec(html);
  }

  const srcsetRe = cloneGlobalRe(SRCSET_ATTR_RE);
  let srcset: RegExpExecArray | null = srcsetRe.exec(html);
  while (srcset !== null) {
    refs.push(...resolveSrcset(srcset[2] ?? '', root, contextDir));
    srcset = srcsetRe.exec(html);
  }

  refs.push(...collectCssReferences(html, root, contextDir));
  return refs;
}

function collectCssReferences(
  css: string,
  root: ResolvedRoot,
  contextDir: string,
): ResolvedAssetReference[] {
  const refs: ResolvedAssetReference[] = [];
  const urlRe = cloneGlobalRe(URL_FUNC_RE);
  let match: RegExpExecArray | null = urlRe.exec(css);
  while (match !== null) {
    const ref = resolveAssetReference((match[2] ?? '').trim(), root, contextDir);
    if (ref !== null) refs.push(ref);
    match = urlRe.exec(css);
  }
  return refs;
}

async function collectAttributeInlineReplacements(
  html: string,
  root: ResolvedRoot,
  replacements: Replacement[],
): Promise<void> {
  const attrRe = cloneGlobalRe(RESOURCE_ATTR_RE);
  let attr: RegExpExecArray | null = attrRe.exec(html);
  while (attr !== null) {
    const raw = attr[3] ?? '';
    const valueStart = attr.index + (attr[0]?.lastIndexOf(raw) ?? -1);
    const dataUri = await readReferenceAsDataUri(raw, root, root.basePath, new Set());
    if (valueStart >= attr.index && dataUri !== null) {
      replacements.push({
        start: valueStart,
        end: valueStart + raw.length,
        value: dataUri,
      });
    }
    attr = attrRe.exec(html);
  }
}

async function collectSrcsetInlineReplacements(
  html: string,
  root: ResolvedRoot,
  replacements: Replacement[],
): Promise<void> {
  const srcsetRe = cloneGlobalRe(SRCSET_ATTR_RE);
  let srcset: RegExpExecArray | null = srcsetRe.exec(html);
  while (srcset !== null) {
    const raw = srcset[2] ?? '';
    const valueStart = srcset.index + (srcset[0]?.lastIndexOf(raw) ?? -1);
    const rewritten = await rewriteSrcsetToDataUri(raw, root, root.basePath, new Set());
    if (valueStart >= srcset.index && rewritten !== raw) {
      replacements.push({ start: valueStart, end: valueStart + raw.length, value: rewritten });
    }
    srcset = srcsetRe.exec(html);
  }
}

async function collectCssUrlReplacements(
  input: string,
  root: ResolvedRoot,
  contextDir: string,
  replacements: Replacement[],
  seen: Set<string>,
): Promise<void> {
  const urlRe = cloneGlobalRe(URL_FUNC_RE);
  let match: RegExpExecArray | null = urlRe.exec(input);
  while (match !== null) {
    const raw = (match[2] ?? '').trim();
    const dataUri = await readReferenceAsDataUri(raw, root, contextDir, seen);
    if (dataUri !== null) {
      replacements.push({
        start: match.index,
        end: match.index + (match[0]?.length ?? 0),
        value: `url("${dataUri}")`,
      });
    }
    match = urlRe.exec(input);
  }
}

async function readReferenceAsDataUri(
  raw: string,
  root: ResolvedRoot,
  contextDir: string,
  seen: Set<string>,
): Promise<string | null> {
  const fs = await import('node:fs/promises');
  const ref = resolveAssetReference(raw, root, contextDir);
  if (ref === null) return null;
  try {
    const ext = path.extname(ref.absolutePath).toLowerCase();
    let content = await fs.readFile(ref.absolutePath);
    if (ext === '.css' && !seen.has(ref.absolutePath)) {
      seen.add(ref.absolutePath);
      const css = await inlineCssUrls(
        content.toString('utf8'),
        root,
        path.dirname(ref.absolutePath),
        seen,
      );
      content = Buffer.from(css, 'utf8');
    }
    return toDataUri(content, mimeForPath(ref.absolutePath), shouldEncodeAsText(ref.absolutePath));
  } catch {
    return null;
  }
}

async function inlineCssUrls(
  css: string,
  root: ResolvedRoot,
  contextDir: string,
  seen: Set<string>,
): Promise<string> {
  const replacements: Replacement[] = [];
  await collectCssUrlReplacements(css, root, contextDir, replacements, seen);
  return applyReplacements(css, replacements);
}

function resolveSrcset(
  raw: string,
  root: ResolvedRoot,
  contextDir: string,
): ResolvedAssetReference[] {
  return parseSrcset(raw)
    .map((candidate) => resolveAssetReference(candidate.url, root, contextDir))
    .filter((ref): ref is ResolvedAssetReference => ref !== null);
}

async function rewriteSrcsetToDataUri(
  raw: string,
  root: ResolvedRoot,
  contextDir: string,
  seen: Set<string>,
): Promise<string> {
  const candidates = parseSrcset(raw);
  const rewritten: string[] = [];
  for (const candidate of candidates) {
    const dataUri = await readReferenceAsDataUri(candidate.url, root, contextDir, seen);
    rewritten.push(`${dataUri ?? candidate.url}${candidate.descriptor}`);
  }
  return rewritten.join(', ');
}

function rewriteSrcset(raw: string, root: ResolvedRoot, contextDir: string): string {
  return parseSrcset(raw)
    .map((candidate) => {
      const ref = resolveAssetReference(candidate.url, root, contextDir);
      return `${ref ? `${ref.archivePath}${ref.suffix}` : candidate.url}${candidate.descriptor}`;
    })
    .join(', ');
}

function parseSrcset(raw: string): Array<{ url: string; descriptor: string }> {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const firstSpace = part.search(/\s/u);
      if (firstSpace < 0) return { url: part, descriptor: '' };
      return {
        url: part.slice(0, firstSpace),
        descriptor: part.slice(firstSpace),
      };
    });
}

function resolveAssetReference(
  rawInput: string,
  root: ResolvedRoot,
  contextDir: string,
): ResolvedAssetReference | null {
  const raw = rawInput.trim();
  if (!isLocalReference(raw)) return null;

  const { pathOnly, suffix } = splitReferenceSuffix(raw);
  const decoded = safeDecodePath(pathOnly);
  const normalizedPath = decoded.replace(/\\/g, '/');
  const relativePath = normalizedPath.replace(/^\/+/, '');
  const absolutePath = path.resolve(
    normalizedPath.startsWith('/') ? root.rootPath : contextDir,
    relativePath,
  );
  if (!isInsideRoot(absolutePath, root.rootPath)) return null;
  const archivePath = path.relative(root.rootPath, absolutePath).replace(/\\/g, '/');
  if (!archivePath || archivePath.startsWith('../')) return null;
  return { suffix, absolutePath, archivePath };
}

function isLocalReference(raw: string): boolean {
  const value = raw.trim();
  if (!value || value.startsWith('#') || value.startsWith('//')) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(value)) return false;
  return true;
}

function splitReferenceSuffix(raw: string): { pathOnly: string; suffix: string } {
  const query = raw.indexOf('?');
  const hash = raw.indexOf('#');
  const indexes = [query, hash].filter((index) => index >= 0);
  if (indexes.length === 0) return { pathOnly: raw, suffix: '' };
  const splitAt = Math.min(...indexes);
  return {
    pathOnly: raw.slice(0, splitAt),
    suffix: raw.slice(splitAt),
  };
}

function safeDecodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isInsideRoot(candidate: string, root: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function applyReplacements(input: string, replacements: Replacement[]): string {
  const sorted = replacements
    .filter((r) => r.start >= 0 && r.end >= r.start)
    .sort((a, b) => b.start - a.start);
  let out = input;
  for (const replacement of sorted) {
    out = `${out.slice(0, replacement.start)}${replacement.value}${out.slice(replacement.end)}`;
  }
  return out;
}

function toDataUri(content: Buffer, mime: string, encodeAsText: boolean): string {
  if (!encodeAsText) return `data:${mime};base64,${content.toString('base64')}`;
  return `data:${mime};charset=utf-8,${encodeURIComponent(content.toString('utf8'))}`;
}

function shouldEncodeAsText(filePath: string): boolean {
  return TEXT_ENCODINGS.has(path.extname(filePath).toLowerCase());
}

function mimeForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.avif':
      return 'image/avif';
    case '.bmp':
      return 'image/bmp';
    case '.css':
      return 'text/css';
    case '.gif':
      return 'image/gif';
    case '.html':
    case '.htm':
      return 'text/html';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.js':
    case '.mjs':
      return 'text/javascript';
    case '.json':
      return 'application/json';
    case '.otf':
      return 'font/otf';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    case '.ttf':
      return 'font/ttf';
    case '.txt':
      return 'text/plain';
    case '.webp':
      return 'image/webp';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

function cloneGlobalRe(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags);
}
