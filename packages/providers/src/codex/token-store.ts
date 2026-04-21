import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type TokenSet, decodeJwtClaims, refreshTokens as defaultRefreshTokens } from './oauth';

export interface StoredCodexAuth {
  schemaVersion: 1;
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number;
  accountId: string | null;
  email: string | null;
  updatedAt: number;
}

export interface CodexTokenStoreOptions {
  filePath: string;
  refreshFn?: (refreshToken: string) => Promise<TokenSet>;
  now?: () => number;
}

const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

function extractEmail(jwt: string): string | null {
  const claims = decodeJwtClaims(jwt);
  if (claims === null) return null;
  const email = claims['email'];
  return typeof email === 'string' && email.length > 0 ? email : null;
}

function isStoredCodexAuth(value: unknown): value is StoredCodexAuth {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v['schemaVersion'] === 1 &&
    typeof v['accessToken'] === 'string' &&
    typeof v['refreshToken'] === 'string' &&
    typeof v['idToken'] === 'string' &&
    typeof v['expiresAt'] === 'number' &&
    (v['accountId'] === null || typeof v['accountId'] === 'string') &&
    (v['email'] === null || typeof v['email'] === 'string') &&
    typeof v['updatedAt'] === 'number'
  );
}

export class CodexTokenStore {
  private readonly filePath: string;
  private readonly refreshFn: (refreshToken: string) => Promise<TokenSet>;
  private readonly now: () => number;
  private cache: StoredCodexAuth | null = null;
  private refreshPromise: Promise<string> | null = null;

  constructor(opts: CodexTokenStoreOptions) {
    this.filePath = opts.filePath;
    this.refreshFn = opts.refreshFn ?? defaultRefreshTokens;
    this.now = opts.now ?? Date.now;
  }

  async read(): Promise<StoredCodexAuth | null> {
    let body: string;
    try {
      body = await readFile(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = null;
        return null;
      }
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error(`Invalid Codex token store at ${this.filePath}`);
    }
    if (!isStoredCodexAuth(parsed)) {
      throw new Error(`Invalid Codex token store at ${this.filePath}`);
    }
    this.cache = parsed;
    return parsed;
  }

  async write(auth: StoredCodexAuth): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const body = JSON.stringify(auth, null, 2);
    await writeFile(this.filePath, body, { encoding: 'utf8', mode: 0o600 });
    this.cache = auth;
  }

  async clear(): Promise<void> {
    this.cache = null;
    try {
      await unlink(this.filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async getValidAccessToken(): Promise<string> {
    if (this.cache === null) {
      await this.read();
    }
    if (this.cache === null) {
      throw new Error('No Codex credentials stored');
    }
    if (this.now() >= this.cache.expiresAt - EXPIRY_BUFFER_MS) {
      return this.runRefresh();
    }
    return this.cache.accessToken;
  }

  async forceRefresh(): Promise<string> {
    if (this.cache === null) {
      await this.read();
    }
    if (this.cache === null) {
      throw new Error('No Codex credentials stored');
    }
    return this.runRefresh();
  }

  private runRefresh(): Promise<string> {
    if (this.refreshPromise !== null) return this.refreshPromise;
    const p = this.doRefresh().finally(() => {
      this.refreshPromise = null;
    });
    this.refreshPromise = p;
    return p;
  }

  private async doRefresh(): Promise<string> {
    if (this.cache === null) {
      await this.read();
    }
    if (this.cache === null) {
      throw new Error('No Codex credentials stored');
    }
    const current = this.cache;
    let next: TokenSet;
    try {
      next = await this.refreshFn(current.refreshToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isBadCredential =
        /invalid_grant/i.test(msg) ||
        /invalid_request/i.test(msg) ||
        /\b400\b/.test(msg) ||
        /\b401\b/.test(msg);
      if (isBadCredential) {
        await this.clear();
        throw new Error('ChatGPT 订阅已失效，请重新登录', { cause: err });
      }
      throw err;
    }
    const newRefreshToken = next.refreshToken ? next.refreshToken : current.refreshToken;
    const emailFromNew = extractEmail(next.idToken);
    const newAuth: StoredCodexAuth = {
      schemaVersion: 1,
      accessToken: next.accessToken,
      refreshToken: newRefreshToken,
      idToken: next.idToken,
      expiresAt: next.expiresAt,
      accountId: next.accountId ?? current.accountId,
      email: emailFromNew ?? current.email,
      updatedAt: this.now(),
    };
    await this.write(newAuth);
    return newAuth.accessToken;
  }
}
