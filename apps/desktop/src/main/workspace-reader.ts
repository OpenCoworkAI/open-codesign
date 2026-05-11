import type { Dirent } from 'node:fs';
import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { CodesignError } from '@open-codesign/shared';

export const DEFAULT_WORKSPACE_PATTERNS = [
  '**/*.html',
  '**/*.htm',
  '**/*.jsx',
  '**/*.ts',
  '**/*.tsx',
  '**/*.css',
  '**/*.js',
  '**/*.mjs',
  '**/*.cjs',
  '**/*.json',
  '**/*.svg',
  '**/*.md',
  '**/*.txt',
  '**/*.yaml',
  '**/*.yml',
  '**/*.toml',
] as const;

/** Ignored by `listWorkspaceFilesAt`, `readWorkspaceFilesAt`, and the
 *  workspace file watcher. Keeps the scan bounded on workspaces that have a
 *  bundled node_modules or build outputs lying around. */
export const WORKSPACE_IGNORED_DIRS = new Set<string>([
  'node_modules',
  '.git',
  '.claude',
  '.codesign',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  '.turbo',
  '.vite',
  '.cache',
  '.ruff_cache',
  '.pnpm-store',
  '__pycache__',
  'coverage',
  'playwright-report',
  'test-results',
]);

/** Hard caps: stop after 200 files or 2 MB total bytes, whichever first. Main-
 * process memory is precious; workspaces can grow to thousands of files once
 * vendored deps or build outputs leak in. */
const MAX_FILES = 200;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 2 * 1024 * 1024;

export interface WorkspaceFile {
  file: string;
  contents: string;
}

/**
 * Scan `root` for files whose workspace-relative path matches any of
 * `patterns` (default: HTML/JSX/CSS/JS). Returns UTF-8 contents. The bulk
 * context scan is best-effort: matched files that are too large, binary, or
 * not valid UTF-8 are skipped so one generated build log cannot block a turn.
 * Results are truncated to `MAX_FILES` / `MAX_BYTES`.
 */
export async function readWorkspaceFilesAt(
  root: string,
  patterns?: string[],
): Promise<WorkspaceFile[]> {
  const active = patterns && patterns.length > 0 ? patterns : [...DEFAULT_WORKSPACE_PATTERNS];
  const exactMatches = new Set(
    active.filter((pattern) => !pattern.includes('*') && !pattern.includes('?')),
  );
  const matchers = active.map(globToRegExp);

  const out: WorkspaceFile[] = [];
  let totalBytes = 0;

  async function walk(dir: string): Promise<void> {
    if (out.length >= MAX_FILES || totalBytes >= MAX_BYTES) return;
    let entries: Dirent[] = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      throw new Error(
        `Failed to scan workspace directory ${normalizeSlashes(relative(root, dir)) || '.'}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES || totalBytes >= MAX_BYTES) return;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (isIgnoredWorkspaceDirectoryName(entry.name)) continue;
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isIgnoredWorkspaceFileName(entry.name)) continue;
      const rel = normalizeSlashes(relative(root, abs));
      if (!exactMatches.has(rel) && !matchers.some((re) => re.test(rel))) continue;
      let size = 0;
      try {
        size = (await stat(abs)).size;
      } catch (err) {
        throw new Error(
          `Failed to stat workspace file ${rel}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (size > MAX_SINGLE_FILE_BYTES) continue;
      let contents: string;
      try {
        contents = await readUtf8TextFile(abs);
      } catch {
        continue;
      }
      out.push({ file: rel, contents });
      totalBytes += Buffer.byteLength(contents, 'utf8');
    }
  }

  await walk(root);
  return out;
}

function normalizeSlashes(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

export interface WorkspaceFileEntry {
  /** Workspace-relative POSIX path (e.g. `index.html`, `assets/logo.png`). */
  path: string;
  /** Coarse file kind. Renderer uses this for icon / preview routing; finer
   *  mime detection is the viewer's job. */
  kind: WorkspaceFileKind;
  /** File size in bytes. */
  size: number;
  /** ISO-8601 mtime string. */
  updatedAt: string;
}

export type WorkspaceFileKind =
  | 'html'
  | 'jsx'
  | 'tsx'
  | 'css'
  | 'js'
  | 'markdown'
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'document'
  | 'design-system'
  | 'asset';

export interface WorkspaceFileReadResult extends WorkspaceFileEntry {
  content: string;
}

export interface WorkspaceDirectoryEntry {
  /** Workspace-relative POSIX path. Directories never end with `/`. */
  path: string;
  /** Basename for display. */
  name: string;
  type: 'file' | 'directory';
  kind?: WorkspaceFileKind;
  size?: number;
  updatedAt?: string;
}

export interface ListWorkspaceFilesOptions {
  maxFiles?: number;
}

const LIST_IGNORED_DIRS = WORKSPACE_IGNORED_DIRS;
const WORKSPACE_IGNORED_FILE_NAMES = new Set<string>([
  '.ds_store',
  'thumbs.db',
  'desktop.ini',
  'build-out.txt',
  'build-output.txt',
  'claude.md',
  'memory.md',
]);

const LIST_MAX_FILES = 2_000;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const TEXT_READABLE_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.csv',
  '.html',
  '.htm',
  '.js',
  '.json',
  '.jsx',
  '.log',
  '.mjs',
  '.md',
  '.markdown',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);
const TEXT_READABLE_BASENAMES = new Set([
  '.env',
  '.gitattributes',
  '.gitignore',
  '.npmrc',
  '.nvmrc',
  'dockerfile',
  'license',
  'makefile',
  'notice',
  'readme',
]);
const DOCUMENT_EXTENSIONS = new Set([
  '.doc',
  '.docx',
  '.key',
  '.numbers',
  '.pages',
  '.ppt',
  '.pptx',
  '.rtf',
  '.xls',
  '.xlsx',
]);

export function isWorkspaceTextReadablePath(path: string): boolean {
  const lower = normalizeSlashes(path).toLowerCase();
  return (
    TEXT_READABLE_EXTENSIONS.has(extname(lower)) || TEXT_READABLE_BASENAMES.has(basename(lower))
  );
}

function isIgnoredWorkspaceFileName(name: string): boolean {
  return name.startsWith('.') || WORKSPACE_IGNORED_FILE_NAMES.has(name.toLowerCase());
}

function isIgnoredWorkspaceDirectoryName(name: string): boolean {
  return name.startsWith('.') || LIST_IGNORED_DIRS.has(name.toLowerCase());
}

export function isIgnoredWorkspacePath(path: string): boolean {
  return normalizeSlashes(path)
    .split('/')
    .filter((part) => part.length > 0 && part !== '.')
    .some((part, index, parts) => {
      const isLast = index === parts.length - 1;
      return isIgnoredWorkspaceDirectoryName(part) || (isLast && isIgnoredWorkspaceFileName(part));
    });
}

export function assertWorkspacePathVisible(path: string): void {
  if (isIgnoredWorkspacePath(path)) {
    throw new CodesignError(`hidden workspace path is not accessible: ${path}`, 'IPC_BAD_INPUT');
  }
}

export function classifyWorkspaceFileKind(path: string): WorkspaceFileKind {
  const lower = path.toLowerCase();
  const ext = extname(lower);
  if (lower === 'design.md' || lower.endsWith('/design.md')) return 'design-system';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.jsx')) return 'jsx';
  if (lower.endsWith('.tsx')) return 'tsx';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'js';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
  if (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.avif') ||
    lower.endsWith('.ico') ||
    lower.endsWith('.bmp') ||
    lower.endsWith('.svg')
  ) {
    return 'image';
  }
  if (lower.endsWith('.mp4') || lower.endsWith('.webm')) return 'video';
  if (lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.ogg')) return 'audio';
  if (isWorkspaceTextReadablePath(path)) return 'text';
  return 'asset';
}

function resolveWorkspaceChild(root: string, relPath: string): string {
  const absRoot = resolve(root);
  const absPath = resolve(absRoot, relPath);
  if (absPath !== absRoot && !absPath.startsWith(absRoot + sep)) {
    throw new Error(`path "${relPath}" escapes workspace root`);
  }
  return absPath;
}

export async function resolveSafeWorkspaceChildPath(
  root: string,
  relPath: string,
): Promise<string> {
  const absRoot = resolve(root);
  const absPath = resolveWorkspaceChild(absRoot, relPath);
  const rel = relative(absRoot, absPath);
  if (rel.length === 0) return absPath;

  const parts = rel.split(sep).filter((part) => part.length > 0);
  let cursor = absRoot;
  for (const part of parts) {
    cursor = join(cursor, part);
    try {
      const entry = await lstat(cursor);
      if (entry.isSymbolicLink()) {
        const linkPath = normalizeSlashes(relative(absRoot, cursor));
        throw new Error(`path "${relPath}" traverses symbolic link "${linkPath}"`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw err;
    }
  }

  return absPath;
}

async function readUtf8TextFile(abs: string): Promise<string> {
  const bytes = await readFile(abs);
  const content = UTF8_DECODER.decode(bytes);
  if (content.indexOf('\u0000') !== -1) {
    throw new Error('binary file contains NUL byte');
  }
  return content;
}

/**
 * Recursively list all files under `root`, returning metadata only (path,
 * size, mtime, kind). Skips `.git`, `node_modules`, build outputs. Unlike
 * `readWorkspaceFilesAt` this does NOT read file contents — the renderer's
 * files panel only needs the directory listing, not the bytes.
 *
 * Returns entries sorted by path (POSIX-style separators). A bound workspace
 * that cannot be scanned is an invalid runtime state, so scan failures throw.
 */
export async function listWorkspaceFilesAt(
  root: string,
  opts: ListWorkspaceFilesOptions = {},
): Promise<WorkspaceFileEntry[]> {
  const out: WorkspaceFileEntry[] = [];
  const maxFiles = opts.maxFiles ?? LIST_MAX_FILES;

  async function walk(dir: string): Promise<void> {
    if (out.length >= maxFiles) return;
    let entries: Dirent[] = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      throw new Error(
        `Failed to scan workspace directory ${normalizeSlashes(relative(root, dir)) || '.'}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (isIgnoredWorkspaceDirectoryName(entry.name)) continue;
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isIgnoredWorkspaceFileName(entry.name)) continue;
      let size = 0;
      let mtime = new Date();
      try {
        const s = await stat(abs);
        size = s.size;
        mtime = s.mtime;
      } catch (err) {
        const rel = normalizeSlashes(relative(root, abs));
        throw new Error(
          `Failed to stat workspace file ${rel}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const rel = normalizeSlashes(relative(root, abs));
      out.push({
        path: rel,
        kind: classifyWorkspaceFileKind(rel),
        size,
        updatedAt: mtime.toISOString(),
      });
    }
  }

  await walk(root);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

export async function listWorkspaceDirectoryAt(
  root: string,
  dirPath = '.',
): Promise<WorkspaceDirectoryEntry[]> {
  const absRoot = resolve(root);
  const absDir = await resolveSafeWorkspaceChildPath(absRoot, dirPath);
  const relDir = normalizeSlashes(relative(absRoot, absDir));
  assertWorkspacePathVisible(relDir);
  const dirStat = await stat(absDir);
  if (!dirStat.isDirectory()) {
    throw new Error(`not a directory: ${dirPath}`);
  }

  let entries: Dirent[] = [];
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch (err) {
    throw new Error(
      `Failed to scan workspace directory ${relDir || '.'}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const out: WorkspaceDirectoryEntry[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (isIgnoredWorkspaceDirectoryName(entry.name)) continue;
      const relPath = normalizeSlashes(relative(absRoot, join(absDir, entry.name)));
      out.push({ path: relPath, name: entry.name, type: 'directory' });
      continue;
    }
    if (!entry.isFile()) continue;
    if (isIgnoredWorkspaceFileName(entry.name)) continue;
    const abs = join(absDir, entry.name);
    const fileStat = await stat(abs);
    const relPath = normalizeSlashes(relative(absRoot, abs));
    out.push({
      path: relPath,
      name: entry.name,
      type: 'file',
      kind: classifyWorkspaceFileKind(relPath),
      size: fileStat.size,
      updatedAt: fileStat.mtime.toISOString(),
    });
  }

  return out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

/** Tiny glob → regex. Supports `**` (any including slashes), `*` (no slash),
 * `?` (single non-slash char), and character classes `[...]`. Good enough for
 * extension filters like `**\/*.html` and `*.md`. */
function globToRegExp(pattern: string): RegExp {
  let re = '^';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` matches zero or more path segments; bare `**` matches anything.
        if (pattern[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (ch === '?') {
      re += '[^/]';
      i += 1;
    } else if (
      ch === '.' ||
      ch === '+' ||
      ch === '(' ||
      ch === ')' ||
      ch === '|' ||
      ch === '^' ||
      ch === '$' ||
      ch === '{' ||
      ch === '}' ||
      ch === '\\'
    ) {
      re += `\\${ch}`;
      i += 1;
    } else if (ch === '[') {
      const close = pattern.indexOf(']', i + 1);
      if (close === -1) {
        re += '\\[';
        i += 1;
      } else {
        re += pattern.slice(i, close + 1);
        i = close + 1;
      }
    } else {
      re += ch;
      i += 1;
    }
  }
  re += '$';
  return new RegExp(re);
}

export async function readWorkspaceFileAt(
  root: string,
  relPath: string,
): Promise<WorkspaceFileReadResult> {
  const abs = await resolveSafeWorkspaceChildPath(root, relPath);
  const rel = normalizeSlashes(relative(resolve(root), abs));
  assertWorkspacePathVisible(rel);
  let size = 0;
  let mtime = new Date();
  try {
    const s = await stat(abs);
    if (!s.isFile()) throw new Error(`not a file: ${relPath}`);
    size = s.size;
    mtime = s.mtime;
  } catch (err) {
    throw new Error(`stat failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (size > MAX_SINGLE_FILE_BYTES) {
    throw new Error(`file too large: ${relPath} (${size} bytes)`);
  }
  const kind = classifyWorkspaceFileKind(rel);
  if (!isWorkspaceTextReadablePath(rel)) {
    throw new Error(`not a text-readable workspace file: ${relPath}`);
  }

  let content: string;
  try {
    content = await readUtf8TextFile(abs);
  } catch (err) {
    throw new Error(`read failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return {
    path: rel,
    kind,
    size,
    updatedAt: mtime.toISOString(),
    content,
  };
}
