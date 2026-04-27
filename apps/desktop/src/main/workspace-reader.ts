import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';

export const DEFAULT_WORKSPACE_PATTERNS = [
  '**/*.html',
  '**/*.jsx',
  '**/*.tsx',
  '**/*.css',
  '**/*.js',
] as const;

/** Dirs we never recurse into. Matches the set used by design-system.ts plus a
 * few electron-era additions (.vite, __pycache__) and our own workspace cache
 * (.codesign). Keeps a huge node_modules from drowning the scan. */
const IGNORED_DIRS = new Set<string>([
  'node_modules',
  '.git',
  '.codesign',
  'dist',
  'out',
  '.turbo',
  '.vite',
  '__pycache__',
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
 * `patterns` (default: HTML/JSX/CSS/JS). Returns UTF-8 contents. Matching
 * files must be readable text; otherwise the caller gets a visible source-scan
 * error instead of a silently partial tweak scan. Results are truncated to
 * `MAX_FILES` / `MAX_BYTES`.
 */
export async function readWorkspaceFilesAt(
  root: string,
  patterns?: string[],
): Promise<WorkspaceFile[]> {
  const active = patterns && patterns.length > 0 ? patterns : [...DEFAULT_WORKSPACE_PATTERNS];
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
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = normalizeSlashes(relative(root, abs));
      if (!matchers.some((re) => re.test(rel))) continue;
      let contents: string;
      try {
        contents = await readUtf8TextFile(abs);
      } catch (err) {
        throw new Error(
          `Failed to read workspace file ${rel}: ${err instanceof Error ? err.message : String(err)}`,
        );
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

export type WorkspaceFileKind = 'html' | 'jsx' | 'tsx' | 'css' | 'js' | 'asset';

export interface WorkspaceFileReadResult extends WorkspaceFileEntry {
  content: string;
}

/** Ignored by `listWorkspaceFilesAt`, `readWorkspaceFilesAt`, and the
 *  workspace file watcher. Keeps the scan bounded on workspaces that have a
 *  bundled node_modules or build outputs lying around. */
export const WORKSPACE_IGNORED_DIRS = new Set<string>([
  'node_modules',
  '.git',
  '.codesign',
  'dist',
  'out',
  '.turbo',
  '.vite',
  '__pycache__',
]);

const LIST_IGNORED_DIRS = WORKSPACE_IGNORED_DIRS;

const LIST_MAX_FILES = 2_000;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export function classifyWorkspaceFileKind(path: string): WorkspaceFileKind {
  const lower = path.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.jsx')) return 'jsx';
  if (lower.endsWith('.tsx')) return 'tsx';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.js')) return 'js';
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
export async function listWorkspaceFilesAt(root: string): Promise<WorkspaceFileEntry[]> {
  const out: WorkspaceFileEntry[] = [];

  async function walk(dir: string): Promise<void> {
    if (out.length >= LIST_MAX_FILES) return;
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
      if (out.length >= LIST_MAX_FILES) return;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (LIST_IGNORED_DIRS.has(entry.name)) continue;
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
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
  const abs = resolveWorkspaceChild(root, relPath);
  const rel = normalizeSlashes(relative(resolve(root), abs));
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

  let content: string;
  try {
    content = await readUtf8TextFile(abs);
  } catch (err) {
    throw new Error(`read failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return {
    path: rel,
    kind: classifyWorkspaceFileKind(rel),
    size,
    updatedAt: mtime.toISOString(),
    content,
  };
}
