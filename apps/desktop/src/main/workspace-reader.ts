import type { Dirent } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export const DEFAULT_WORKSPACE_PATTERNS = ['**/*.html', '**/*.jsx', '**/*.css', '**/*.js'] as const;

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

export interface WorkspaceFile {
  file: string;
  contents: string;
}

/**
 * Scan `root` for files whose workspace-relative path matches any of
 * `patterns` (default: HTML/JSX/CSS/JS). Returns UTF-8 contents. Unreadable or
 * binary files are skipped, not thrown. Results are truncated to
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
    } catch {
      return;
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
        contents = await readFile(abs, 'utf8');
      } catch {
        continue;
      }
      // Crude binary sniff — an embedded NUL byte means this file isn't the
      // source text we care about. Skip rather than feed garbage to the model.
      if (contents.indexOf('\u0000') !== -1) continue;
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
