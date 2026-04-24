import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface CallbackResult {
  code: string;
  state: string;
}

export interface CallbackServer {
  readonly redirectUri: string;
  waitForCode(expectedState: string, signal?: AbortSignal): Promise<CallbackResult>;
  close(): void;
}

interface PendingWait {
  expectedState: string;
  resolve: (result: CallbackResult) => void;
  reject: (err: Error) => void;
  cleanup: () => void;
}

const DEFAULT_PORT = 1455;
const CALLBACK_TIMEOUT_MS = 2 * 60 * 1000;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function successPage(): string {
  return '<html><body style="font-family:system-ui;padding:40px;max-width:560px;margin:0 auto"><h1 style="color:#0f766e;margin-bottom:8px">登录成功</h1><p style="color:#475569">你可以关闭此窗口回到 open-codesign。</p></body></html>';
}

function errorPage(title: string, detail: string): string {
  return `<html><body style="font-family:system-ui;padding:40px;max-width:560px;margin:0 auto"><h1 style="color:#b91c1c;margin-bottom:8px">${escapeHtml(title)}</h1><p style="color:#475569">${escapeHtml(detail)}</p></body></html>`;
}

function listen(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

export async function startCallbackServer(preferredPort?: number): Promise<CallbackServer> {
  const firstPort = preferredPort ?? DEFAULT_PORT;
  let server: Server;
  try {
    server = await listen(firstPort);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') {
      throw new Error(
        `Codex OAuth 回调端口 ${firstPort} 已被占用（通常是另一个 open-codesign 或 Codex CLI 实例）。请关闭它们后重试。`,
      );
    }
    throw err;
  }

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const redirectUri = `http://localhost:${port}/auth/callback`;

  let pending: PendingWait | null = null;

  const handleCallback = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const params = url.searchParams;
    const error = params.get('error');
    const errorDescription = params.get('error_description');
    const state = params.get('state');
    const code = params.get('code');

    if (error) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
      res.end(errorPage('Authorization failed', `${error}: ${errorDescription ?? ''}`));
      pending?.reject(new Error(`Codex OAuth error: ${error} - ${errorDescription ?? ''}`));
      return;
    }

    if (pending && (state === null || state !== pending.expectedState)) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
      res.end(errorPage('Invalid state', 'The state parameter did not match.'));
      pending.reject(new Error('Codex OAuth state mismatch'));
      return;
    }

    if (!code) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
      res.end(errorPage('Missing code', 'The callback is missing the code parameter.'));
      pending?.reject(new Error('Codex OAuth callback missing code'));
      return;
    }

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
    res.end(successPage());
    pending?.resolve({ code, state: state ?? '' });
  };

  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    if (req.method === 'GET' && url.pathname === '/auth/callback') {
      handleCallback(req, res);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' });
    res.end('Not found');
  });

  const waitForCode = (expectedState: string, signal?: AbortSignal): Promise<CallbackResult> => {
    if (pending) {
      return Promise.reject(new Error('Codex OAuth callback already pending'));
    }
    if (signal?.aborted) {
      return Promise.reject(new Error('Codex OAuth callback aborted'));
    }

    return new Promise<CallbackResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        settle();
        pending = null;
        reject(new Error('Codex OAuth callback timeout (2 minutes)'));
      }, CALLBACK_TIMEOUT_MS);

      const onAbort = () => {
        settle();
        pending = null;
        reject(new Error('Codex OAuth callback aborted'));
      };

      const settle = () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
      };

      signal?.addEventListener('abort', onAbort);

      pending = {
        expectedState,
        resolve: (result) => {
          settle();
          pending = null;
          resolve(result);
        },
        reject: (err) => {
          settle();
          pending = null;
          reject(err);
        },
        cleanup: settle,
      };
    });
  };

  const close = (): void => {
    server.close();
    if (pending) {
      pending.reject(new Error('Codex OAuth callback server closed'));
    }
  };

  return { redirectUri, waitForCode, close };
}
