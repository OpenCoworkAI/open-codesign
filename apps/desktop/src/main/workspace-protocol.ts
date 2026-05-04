import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CoreLogger } from '@open-codesign/core';
import { protocol } from './electron-runtime';
import { type Database, getDesign } from './snapshots-db';
import { normalizeWorkspacePath } from './workspace-path';
import { resolveSafeWorkspaceChildPath } from './workspace-reader';

export const WORKSPACE_SCHEME = 'workspace';

const VALID_DESIGN_ID = /^[a-zA-Z0-9_-]+$/;

const ALLOWED_MIME_BY_EXT = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.htm', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.mjs', 'application/javascript; charset=utf-8'],
  ['.cjs', 'application/javascript; charset=utf-8'],
  ['.jsx', 'application/javascript; charset=utf-8'],
  ['.ts', 'application/javascript; charset=utf-8'],
  ['.tsx', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon'],
  ['.bmp', 'image/bmp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.markdown', 'text/markdown; charset=utf-8'],
  ['.yaml', 'text/yaml; charset=utf-8'],
  ['.yml', 'text/yaml; charset=utf-8'],
  ['.toml', 'text/plain; charset=utf-8'],
  ['.csv', 'text/csv; charset=utf-8'],
  ['.log', 'text/plain; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.pdf', 'application/pdf'],
  ['.map', 'application/json; charset=utf-8'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.ogg', 'audio/ogg'],
]);

export type WorkspaceProtocolError =
  | 'bad_url'
  | 'unknown_design'
  | 'bad_workspace'
  | 'traversal'
  | 'unsupported_mime';

export interface WorkspaceResolution {
  absPath: string;
  mime: string;
  designId: string;
  relPath: string;
  workspacePath: string;
}

export type WorkspaceResolveResult =
  | { ok: true; value: WorkspaceResolution }
  | { ok: false; error: WorkspaceProtocolError };

function isInside(root: string, child: string): boolean {
  return child === root || child.startsWith(`${root}${path.sep}`);
}

export function resolveWorkspaceUrl(
  rawUrl: string,
  resolveWorkspacePath: (designId: string) => string | null,
): WorkspaceResolveResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'bad_url' };
  }
  if (url.protocol !== `${WORKSPACE_SCHEME}:`) {
    return { ok: false, error: 'bad_url' };
  }

  const designId = url.hostname;
  if (!designId || !VALID_DESIGN_ID.test(designId)) {
    return { ok: false, error: 'bad_url' };
  }

  const storedWorkspacePath = resolveWorkspacePath(designId);
  if (storedWorkspacePath === null) {
    return { ok: false, error: 'unknown_design' };
  }

  let workspacePath: string;
  try {
    workspacePath = normalizeWorkspacePath(storedWorkspacePath);
  } catch {
    return { ok: false, error: 'bad_workspace' };
  }

  let relPath: string;
  try {
    relPath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  } catch {
    return { ok: false, error: 'bad_url' };
  }
  if (relPath === '' || relPath.endsWith('/')) {
    relPath = `${relPath}index.html`;
  }
  if (relPath.includes('\0')) {
    return { ok: false, error: 'bad_url' };
  }

  const absWorkspace = path.resolve(workspacePath);
  const absPath = path.resolve(absWorkspace, relPath);
  if (!isInside(absWorkspace, absPath)) {
    return { ok: false, error: 'traversal' };
  }

  const mime = ALLOWED_MIME_BY_EXT.get(path.extname(absPath).toLowerCase());
  if (mime === undefined) {
    return { ok: false, error: 'unsupported_mime' };
  }

  return {
    ok: true,
    value: { absPath, mime, designId, relPath, workspacePath: absWorkspace },
  };
}

export async function resolveWorkspaceSafePath(
  resolution: WorkspaceResolution,
): Promise<WorkspaceResolveResult> {
  try {
    const absPath = await resolveSafeWorkspaceChildPath(
      resolution.workspacePath,
      resolution.relPath,
    );
    return { ok: true, value: { ...resolution, absPath } };
  } catch {
    return { ok: false, error: 'traversal' };
  }
}

export function registerWorkspaceScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: WORKSPACE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

export interface RegisterWorkspaceProtocolOptions {
  db: Database;
  logger: Pick<CoreLogger, 'error' | 'warn'>;
}

function errorStatus(error: WorkspaceProtocolError): number {
  switch (error) {
    case 'bad_url':
    case 'bad_workspace':
      return 400;
    case 'unknown_design':
      return 404;
    case 'traversal':
      return 403;
    case 'unsupported_mime':
      return 415;
  }
}

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export function registerWorkspaceProtocolHandler(opts: RegisterWorkspaceProtocolOptions): void {
  const { db, logger } = opts;

  const resolveWorkspacePath = (designId: string): string | null => {
    try {
      const design = getDesign(db, designId);
      return design?.workspacePath ?? null;
    } catch (err) {
      logger.error('workspace.protocol.db.fail', {
        designId,
        message: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  };

  protocol.handle(WORKSPACE_SCHEME, async (request) => {
    const resolved = resolveWorkspaceUrl(request.url, resolveWorkspacePath);
    if (!resolved.ok) {
      logger.warn('workspace.protocol.reject', { url: request.url, error: resolved.error });
      return textResponse(resolved.error, errorStatus(resolved.error));
    }

    const safe = await resolveWorkspaceSafePath(resolved.value);
    if (!safe.ok) {
      logger.warn('workspace.protocol.reject', { url: request.url, error: safe.error });
      return textResponse(safe.error, errorStatus(safe.error));
    }

    try {
      const data = await readFile(safe.value.absPath);
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: {
          'Content-Type': safe.value.mime,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return textResponse('Not found', 404);
      }
      logger.error('workspace.protocol.read.fail', {
        path: safe.value.absPath,
        message: err instanceof Error ? err.message : String(err),
      });
      return textResponse('Read failed', 500);
    }
  });
}
