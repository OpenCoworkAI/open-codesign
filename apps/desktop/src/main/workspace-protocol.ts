import { readFile } from 'node:fs/promises';
import path_module from 'node:path';
import type Database from 'better-sqlite3';
import { protocol } from './electron-runtime';
import type { Logger as CoreLogger } from './logger';
import { getDesign } from './snapshots-db';

export const WORKSPACE_SCHEME = 'workspace';

const ALLOWED_MIME_BY_EXT = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.htm', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.mjs', 'application/javascript; charset=utf-8'],
  ['.cjs', 'application/javascript; charset=utf-8'],
  // Source files often referenced by `<script type="text/babel">` for in-browser
  // transpilation. We hand them out as application/javascript regardless of
  // extension; Babel inspects the script type, not the response Content-Type.
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
  ['.eot', 'application/vnd.ms-fontobject'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.ogg', 'audio/ogg'],
]);

const VALID_DESIGN_ID = /^[a-zA-Z0-9_-]+$/;

export type WorkspaceProtocolError =
  | 'bad_url'
  | 'unknown_design'
  | 'no_workspace'
  | 'traversal'
  | 'unsupported_mime';

export interface WorkspaceResolution {
  absPath: string;
  mime: string;
  designId: string;
  relPath: string;
}

export interface WorkspaceResolveResult {
  ok: true;
  value: WorkspaceResolution;
}

export interface WorkspaceResolveFailure {
  ok: false;
  error: WorkspaceProtocolError;
}

export function resolveWorkspaceUrl(
  rawUrl: string,
  resolveWorkspacePath: (designId: string) => string | null,
): WorkspaceResolveResult | WorkspaceResolveFailure {
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

  const workspacePath = resolveWorkspacePath(designId);
  if (workspacePath === null) {
    return { ok: false, error: 'unknown_design' };
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

  const normalizedWorkspace = path_module.resolve(workspacePath);
  const absPath = path_module.resolve(normalizedWorkspace, relPath);
  const sep = path_module.sep;
  const isInside =
    absPath === normalizedWorkspace || absPath.startsWith(`${normalizedWorkspace}${sep}`);
  if (!isInside) {
    return { ok: false, error: 'traversal' };
  }

  const ext = path_module.extname(absPath).toLowerCase();
  const mime = ALLOWED_MIME_BY_EXT.get(ext);
  if (mime === undefined) {
    return { ok: false, error: 'unsupported_mime' };
  }

  return { ok: true, value: { absPath, mime, designId, relPath } };
}

export function registerWorkspaceScheme(): void {
  // Must be called BEFORE app.whenReady so Chromium treats workspace:// as a
  // standard, secure scheme. Without standard:true, relative URL resolution
  // (./styles.css from index.html) breaks. Without secure:true, the iframe
  // is treated as mixed content and Chromium blocks subresource loads.
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
  db: Database.Database;
  logger: Pick<CoreLogger, 'error' | 'warn' | 'info'>;
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
    const result = resolveWorkspaceUrl(request.url, resolveWorkspacePath);

    if (!result.ok) {
      const status: Record<WorkspaceProtocolError, number> = {
        bad_url: 400,
        unknown_design: 404,
        no_workspace: 404,
        traversal: 403,
        unsupported_mime: 415,
      };
      logger.warn('workspace.protocol.reject', { url: request.url, error: result.error });
      return new Response(result.error, {
        status: status[result.error],
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    try {
      const data = await readFile(result.value.absPath);
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': result.value.mime,
          // Iframe is sandboxed (opaque origin); permissive CORS keeps fetch()
          // and dynamic <script> imports working when pages need them.
          'Access-Control-Allow-Origin': '*',
          // Don't let Chromium cache aggressively -- workspaces change while
          // the user is editing and we want fs_updated reloads to actually
          // re-fetch from disk.
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return new Response('Not found', {
          status: 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
      logger.error('workspace.protocol.read.fail', {
        path: result.value.absPath,
        message: err instanceof Error ? err.message : String(err),
      });
      return new Response('Read failed', {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  });
}
