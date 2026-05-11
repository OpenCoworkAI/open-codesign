import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path_module from 'node:path';
import type { AttachmentContext, CoreLogger, GenerateImageAssetRequest } from '@open-codesign/core';
import { DEFAULT_SOURCE_ENTRY, LEGACY_SOURCE_ENTRY } from '@open-codesign/shared';
import type { AgentStreamEvent } from '../../preload/index';
import {
  type Database,
  getDesign,
  normalizeDesignFilePath,
  upsertDesignFile,
} from '../snapshots-db';
import { prepareWorkspaceWriteContent } from '../workspace-file-content';
import { normalizeWorkspacePath } from '../workspace-path';
import { withStableWorkspacePath } from '../workspace-path-lock';
import {
  assertWorkspacePathVisible,
  isIgnoredWorkspacePath,
  resolveSafeWorkspaceChildPath,
} from '../workspace-reader';

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
  db: Database | null;
  generationId: string;
  designId: string | null;
  previousSource: string | null;
  initialFiles?: ReadonlyArray<{ file: string; contents: string }>;
  attachments?: ReadonlyArray<AttachmentContext> | undefined;
  sendEvent: (event: AgentStreamEvent) => void;
  logger: Pick<CoreLogger, 'error'>;
  frames?: ReadonlyArray<readonly [string, string]>;
  designSkills?: ReadonlyArray<readonly [string, string]>;
}

function dataUrlByteLength(dataUrl: string): number {
  const base64 = dataUrl.split(',', 2)[1] ?? '';
  let length = base64.length;
  if (length >= 2 && base64[length - 1] === '=' && base64[length - 2] === '=') {
    length -= 2;
  } else if (length >= 1 && base64[length - 1] === '=') {
    length -= 1;
  }
  return Math.floor((length * 3) / 4);
}

function attachmentViewContent(attachment: AttachmentContext): string | null {
  if (!attachment.mediaType?.startsWith('image/') || !attachment.imageDataUrl) return null;
  return [
    `Reference image: ${attachment.name}`,
    `Path: ${attachment.path}`,
    `Media type: ${attachment.mediaType}`,
    `Size: ${dataUrlByteLength(attachment.imageDataUrl)} bytes`,
    '',
    'This is a user-provided reference image. Use it only as visual reference material.',
    'Data URL:',
    attachment.imageDataUrl,
  ].join('\n');
}

export function createRuntimeTextEditorFs({
  db,
  generationId,
  designId,
  previousSource,
  initialFiles = [],
  attachments = [],
  sendEvent,
  logger,
  frames = [],
  designSkills = [],
}: CreateRuntimeTextEditorFsOptions) {
  const baseCtx = { designId: designId ?? '', generationId } as const;
  const fsMap = new Map<string, string>();
  for (const [name, content] of frames) {
    fsMap.set(`frames/${name}`, content);
  }
  for (const [name, content] of designSkills) {
    fsMap.set(`skills/${name}`, content);
  }
  for (const file of initialFiles) {
    fsMap.set(normalizeDesignFilePath(file.file), file.contents);
  }
  for (const attachment of attachments) {
    const content = attachmentViewContent(attachment);
    if (content === null) continue;
    fsMap.set(normalizeDesignFilePath(attachment.path), content);
  }
  if (
    previousSource &&
    previousSource.trim().length > 0 &&
    !fsMap.has(DEFAULT_SOURCE_ENTRY) &&
    !fsMap.has(LEGACY_SOURCE_ENTRY)
  ) {
    fsMap.set(DEFAULT_SOURCE_ENTRY, previousSource);
  }

  function emitFsUpdated(filePath: string, content: string): void {
    if (designId === null) return;
    const resolved =
      filePath === DEFAULT_SOURCE_ENTRY || filePath === LEGACY_SOURCE_ENTRY
        ? resolveLocalAssetRefs(content, fsMap)
        : content;
    sendEvent({ ...baseCtx, type: 'fs_updated', path: filePath, content: resolved });
  }

  function emitSourceIfAssetChanged(filePath: string): void {
    if (!filePath.startsWith('assets/')) return;
    const sourcePath = fsMap.has(DEFAULT_SOURCE_ENTRY) ? DEFAULT_SOURCE_ENTRY : LEGACY_SOURCE_ENTRY;
    const source = fsMap.get(sourcePath);
    if (source !== undefined) emitFsUpdated(sourcePath, source);
  }

  async function withResolvedWorkspace<T>(
    normalizedPath: string,
    operation: (workspacePath: string, absolutePath: string) => Promise<T>,
  ): Promise<T> {
    if (designId === null || db === null) {
      throw new Error(`Workspace path unavailable for ${normalizedPath}`);
    }
    return withStableWorkspacePath(designId, async () => {
      const design = getDesign(db, designId);
      if (design === null) {
        throw new Error(`Design not found: ${designId}`);
      }
      if (design.workspacePath === null) {
        throw new Error(`Design is not bound to a workspace: ${designId}`);
      }
      const workspacePath = normalizeWorkspacePath(design.workspacePath);
      const absolutePath = await resolveSafeWorkspaceChildPath(workspacePath, normalizedPath);
      return operation(workspacePath, absolutePath);
    });
  }

  async function persistMutation(filePath: string, content: string): Promise<string> {
    const normalizedPath = normalizeDesignFilePath(filePath);
    assertWorkspacePathVisible(normalizedPath);
    const writeContent = prepareWorkspaceWriteContent(normalizedPath, content);
    if (designId === null || db === null) return writeContent.storedContent;
    try {
      await withResolvedWorkspace(normalizedPath, async (_workspacePath, destinationPath) => {
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
            message,
          });
          throw new Error(`Workspace write-through failed for ${filePath}: ${message}`);
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('Workspace write-through failed for ')) throw err;
      if (
        !message.startsWith('Design is not bound to a workspace:') &&
        !message.startsWith('Design not found:') &&
        !message.startsWith('Workspace path unavailable for ') &&
        message !== 'Workspace path must not be empty'
      ) {
        logger.error('runtime.fs.writeThrough.fail', {
          designId,
          filePath,
          message,
        });
      }
      throw new Error(`Workspace write-through failed for ${filePath}: ${message}`);
    }

    upsertDesignFile(db, designId, normalizedPath, writeContent.storedContent);
    return writeContent.storedContent;
  }

  async function syncWorkspaceTextFile(
    filePath: string,
    absolutePath?: string,
  ): Promise<{ path: string; content: string }> {
    const normalizedPath = normalizeDesignFilePath(filePath);
    assertWorkspacePathVisible(normalizedPath);
    const sourcePath = absolutePath;
    let content: string;
    if (!sourcePath) {
      if (designId === null || db === null) {
        throw new Error(`Workspace path unavailable for ${normalizedPath}`);
      }
      content = await withResolvedWorkspace(normalizedPath, async (_workspacePath, path) =>
        readFile(path, 'utf8'),
      );
    } else {
      content = await readFile(sourcePath, 'utf8');
    }
    fsMap.set(normalizedPath, content);
    emitFsUpdated(normalizedPath, content);
    emitSourceIfAssetChanged(normalizedPath);
    return { path: normalizedPath, content };
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
      emitSourceIfAssetChanged(path);
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
      emitSourceIfAssetChanged(path);
      return { path };
    },
    async insert(path: string, line: number, text: string) {
      const current = fsMap.get(path);
      if (current === undefined) throw new Error(`File not found: ${path}`);
      const lines = current.split('\n');
      const clamped = Math.max(0, Math.min(line, lines.length));
      lines.splice(clamped, 0, text);
      const next = lines.join('\n');
      const persisted = await persistMutation(path, next);
      fsMap.set(path, persisted);
      emitFsUpdated(path, persisted);
      emitSourceIfAssetChanged(path);
      return { path };
    },
    listDir(dir: string) {
      const prefix = dir.length === 0 || dir === '.' ? '' : `${dir.replace(/\/+$/, '')}/`;
      const entries: string[] = [];
      for (const p of fsMap.keys()) {
        if (isIgnoredWorkspacePath(p)) continue;
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        if (rest.length > 0) entries.push(rest);
      }
      return entries.sort();
    },
  };

  return { fs, fsMap, syncWorkspaceTextFile };
}
