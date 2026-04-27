import { mkdir, writeFile } from 'node:fs/promises';
import path_module from 'node:path';
import type { CoreLogger, GenerateImageAssetRequest } from '@open-codesign/core';
import type BetterSqlite3 from 'better-sqlite3';
import type { AgentStreamEvent } from '../../preload/index';
import { getDesign, normalizeDesignFilePath, upsertDesignFile } from '../snapshots-db';
import { prepareWorkspaceWriteContent } from '../workspace-file-content';

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function resolveLocalAssetRefs(source: string, files: Map<string, string>): string {
  let resolved = source;
  for (const [path, content] of files.entries()) {
    if (!path.startsWith('assets/') || !content.startsWith('data:')) continue;
    resolved = resolved.replace(new RegExp(escapeRegExp(path), 'g'), content);
  }
  return resolved;
}

function extensionFromMimeType(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function sanitizeAssetStem(input: string | undefined, defaultStem: string): string {
  const raw = input?.trim() || defaultStem;
  const stem = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return stem.length > 0 ? stem : 'image-asset';
}

export function allocateAssetPath(
  files: Map<string, string>,
  request: GenerateImageAssetRequest,
  mimeType: string,
): string {
  const stem = sanitizeAssetStem(request.filenameHint, request.purpose);
  const ext = extensionFromMimeType(mimeType);
  let path = `assets/${stem}.${ext}`;
  for (let i = 2; files.has(path); i++) {
    path = `assets/${stem}-${i}.${ext}`;
  }
  return path;
}

interface CreateRuntimeTextEditorFsOptions {
  db: BetterSqlite3.Database | null;
  generationId: string;
  designId: string | null;
  previousHtml: string | null;
  sendEvent: (event: AgentStreamEvent) => void;
  logger: Pick<CoreLogger, 'error'>;
  frames?: ReadonlyArray<readonly [string, string]>;
  designSkills?: ReadonlyArray<readonly [string, string]>;
}

export function createRuntimeTextEditorFs({
  db,
  generationId,
  designId,
  previousHtml,
  sendEvent,
  logger,
  frames = [],
  designSkills = [],
}: CreateRuntimeTextEditorFsOptions) {
  const baseCtx = { designId: designId ?? '', generationId } as const;
  const fsMap = new Map<string, string>();
  if (previousHtml && previousHtml.trim().length > 0) {
    fsMap.set('index.html', previousHtml);
  }
  for (const [name, content] of frames) {
    fsMap.set(`frames/${name}`, content);
  }
  for (const [name, content] of designSkills) {
    fsMap.set(`skills/${name}`, content);
  }

  function emitFsUpdated(filePath: string, content: string): void {
    if (designId === null) return;
    const resolved = filePath === 'index.html' ? resolveLocalAssetRefs(content, fsMap) : content;
    sendEvent({ ...baseCtx, type: 'fs_updated', path: filePath, content: resolved });
  }

  function emitIndexIfAssetChanged(filePath: string): void {
    if (!filePath.startsWith('assets/')) return;
    const index = fsMap.get('index.html');
    if (index !== undefined) emitFsUpdated('index.html', index);
  }

  async function persistMutation(filePath: string, content: string): Promise<string> {
    const normalizedPath = normalizeDesignFilePath(filePath);
    const writeContent = prepareWorkspaceWriteContent(normalizedPath, content);
    if (designId === null || db === null) return writeContent.storedContent;
    const design = getDesign(db, designId);
    if (design?.workspacePath !== null && design !== null) {
      const destinationPath = path_module.join(design.workspacePath, normalizedPath);
      try {
        await mkdir(path_module.dirname(destinationPath), { recursive: true });
        if (typeof writeContent.diskContent === 'string') {
          await writeFile(destinationPath, writeContent.diskContent, 'utf8');
        } else {
          await writeFile(destinationPath, writeContent.diskContent);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('runtime.fs.writeThrough.fail', {
          designId,
          filePath,
          workspacePath: design.workspacePath,
          message,
        });
        throw new Error(`Workspace write-through failed for ${filePath}: ${message}`);
      }
    }

    upsertDesignFile(db, designId, normalizedPath, writeContent.storedContent);
    return writeContent.storedContent;
  }

  const fs = {
    view(path: string) {
      const content = fsMap.get(path);
      if (content === undefined) return null;
      return { content, numLines: content.split('\n').length };
    },
    async create(path: string, content: string) {
      const persisted = await persistMutation(path, content);
      fsMap.set(path, persisted);
      emitFsUpdated(path, persisted);
      emitIndexIfAssetChanged(path);
      return { path };
    },
    async strReplace(path: string, oldStr: string, newStr: string) {
      const current = fsMap.get(path);
      if (current === undefined) throw new Error(`File not found: ${path}`);
      const idx = current.indexOf(oldStr);
      if (idx === -1) throw new Error(`old_str not found in ${path}`);
      if (current.indexOf(oldStr, idx + oldStr.length) !== -1) {
        throw new Error(`old_str is ambiguous in ${path}; provide more context`);
      }
      const next = current.slice(0, idx) + newStr + current.slice(idx + oldStr.length);
      const persisted = await persistMutation(path, next);
      fsMap.set(path, persisted);
      emitFsUpdated(path, persisted);
      emitIndexIfAssetChanged(path);
      return { path };
    },
    async insert(path: string, line: number, text: string) {
      const current = fsMap.get(path) ?? '';
      const lines = current.split('\n');
      const clamped = Math.max(0, Math.min(line, lines.length));
      lines.splice(clamped, 0, text);
      const next = lines.join('\n');
      const persisted = await persistMutation(path, next);
      fsMap.set(path, persisted);
      emitFsUpdated(path, persisted);
      emitIndexIfAssetChanged(path);
      return { path };
    },
    listDir(dir: string) {
      const prefix = dir.length === 0 || dir === '.' ? '' : `${dir.replace(/\/+$/, '')}/`;
      const entries = new Set<string>();
      for (const p of fsMap.keys()) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const firstSegment = rest.split('/')[0];
        if (firstSegment) entries.add(firstSegment);
      }
      return [...entries].sort();
    },
  };

  return { fs, fsMap };
}
