import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { CoreLogger } from '@open-codesign/core';
import { CodesignError } from '@open-codesign/shared';
import type Database from 'better-sqlite3';
import { ipcMain } from './electron-runtime';
import { getDesign } from './snapshots-db';
import {
  WORKSPACE_WALK_MAX_FILES,
  shouldSkipDirEntry,
  shouldSkipFileEntry,
} from './workspace-walk';

const HTML_EXTS = new Set(['.html', '.htm']);
// Anything renderable in an iframe directly (or useful to surface in the
// Files panel) gets an entry. Non-listed extensions are skipped to keep
// the panel uncluttered -- if the agent or user needs a niche file type
// they can edit the list here.
const ASSET_EXTS = new Set([
  '.css',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.bmp',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.md',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
  '.toml',
]);

export type FilesIpcEntryKind = 'html' | 'asset';

export interface FilesIpcEntry {
  path: string;
  kind: FilesIpcEntryKind;
  size: number;
  updatedAt: string;
}

export async function walkWorkspaceFiles(
  workspacePath: string,
  max: number = WORKSPACE_WALK_MAX_FILES,
): Promise<FilesIpcEntry[]> {
  const out: FilesIpcEntry[] = [];

  async function walk(absDir: string, relDir: string): Promise<void> {
    if (out.length >= max) return;
    let entries: Dirent[];
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (out.length >= max) return;
      const absPath = path.join(absDir, entry.name);
      const relPath = relDir === '' ? entry.name : `${relDir}/${entry.name}`;

      if (entry.isDirectory()) {
        if (shouldSkipDirEntry(entry.name)) continue;
        await walk(absPath, relPath);
        continue;
      }
      if (!entry.isFile() || shouldSkipFileEntry(entry.name)) continue;

      const ext = path.extname(entry.name).toLowerCase();
      const kind: FilesIpcEntryKind | null = HTML_EXTS.has(ext)
        ? 'html'
        : ASSET_EXTS.has(ext)
          ? 'asset'
          : null;
      if (kind === null) continue;

      try {
        const st = await stat(absPath);
        out.push({
          path: relPath,
          kind,
          size: st.size,
          updatedAt: st.mtime.toISOString(),
        });
      } catch {
        // unreadable entries are skipped silently; the Files panel doesn't
        // surface them and the user already has read access via the picker.
      }
    }
  }

  await walk(workspacePath, '');
  // HTML files first (the user-visible focus), then everything else.
  // Stable secondary sort by path keeps the order deterministic.
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'html' ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
  return out;
}

export interface RegisterFilesIpcOptions {
  db: Database.Database;
  logger: Pick<CoreLogger, 'error' | 'warn' | 'info'>;
}

export function registerFilesIpc(opts: RegisterFilesIpcOptions): void {
  const { db, logger } = opts;

  ipcMain.handle(
    'files:list:v1',
    async (_e: unknown, raw: unknown): Promise<{ files: FilesIpcEntry[] }> => {
      if (typeof raw !== 'object' || raw === null) {
        throw new CodesignError('files:list:v1 expects an object payload', 'IPC_BAD_INPUT');
      }
      const r = raw as Record<string, unknown>;
      if (typeof r['designId'] !== 'string' || r['designId'].trim().length === 0) {
        throw new CodesignError('designId must be a non-empty string', 'IPC_BAD_INPUT');
      }
      const designId = r['designId'] as string;

      let design: ReturnType<typeof getDesign>;
      try {
        design = getDesign(db, designId);
      } catch (err) {
        logger.error('files.list.db.fail', {
          designId,
          message: err instanceof Error ? err.message : String(err),
        });
        throw new CodesignError('files lookup failed', 'IPC_DB_ERROR', {
          cause: err instanceof Error ? err : undefined,
        });
      }

      if (design === null) {
        throw new CodesignError('Design not found', 'IPC_NOT_FOUND');
      }
      if (design.workspacePath === null) {
        // No workspace bound -- renderer falls back to virtual index.html.
        return { files: [] };
      }

      try {
        const files = await walkWorkspaceFiles(design.workspacePath);
        return { files };
      } catch (err) {
        logger.error('files.list.walk.fail', {
          designId,
          workspacePath: design.workspacePath,
          message: err instanceof Error ? err.message : String(err),
        });
        throw new CodesignError('Failed to scan workspace folder', 'IPC_DB_ERROR', {
          cause: err instanceof Error ? err : undefined,
        });
      }
    },
  );
}
