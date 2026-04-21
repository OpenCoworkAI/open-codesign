import { randomBytes } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TokenSet } from './oauth';
import { CodexTokenStore, type CodexTokenStoreOptions, type StoredCodexAuth } from './token-store';

const NOW = 1_700_000_000_000;

// jwt with payload {"email":"user@example.com"}
const ID_TOKEN_WITH_EMAIL = `header.${Buffer.from(JSON.stringify({ email: 'user@example.com' })).toString('base64url')}.sig`;
const ID_TOKEN_WITH_OTHER_EMAIL = `header.${Buffer.from(JSON.stringify({ email: 'new@example.com' })).toString('base64url')}.sig`;

const createdPaths: string[] = [];

function tempPath(sub?: string): string {
  const base = join(tmpdir(), `codex-token-test-${randomBytes(8).toString('hex')}`);
  const p = sub ? join(base, sub) : `${base}.json`;
  createdPaths.push(p);
  return p;
}

function baseAuth(overrides: Partial<StoredCodexAuth> = {}): StoredCodexAuth {
  return {
    schemaVersion: 1,
    accessToken: 'acc-1',
    refreshToken: 'ref-1',
    idToken: ID_TOKEN_WITH_EMAIL,
    expiresAt: NOW + 60 * 60 * 1000,
    accountId: 'acct-1',
    email: 'user@example.com',
    updatedAt: NOW,
    ...overrides,
  };
}

function makeStore(overrides: Partial<CodexTokenStoreOptions> = {}, sub?: string) {
  const filePath = overrides.filePath ?? tempPath(sub);
  const refreshFn = overrides.refreshFn ?? vi.fn();
  const now = overrides.now ?? (() => NOW);
  const store = new CodexTokenStore({ filePath, refreshFn, now });
  return { store, filePath };
}

afterEach(async () => {
  while (createdPaths.length > 0) {
    const p = createdPaths.pop();
    if (!p) continue;
    try {
      await unlink(p);
    } catch {
      // ignore
    }
  }
});

describe('CodexTokenStore', () => {
  it('read() returns null when file missing', async () => {
    const { store } = makeStore();
    expect(await store.read()).toBeNull();
  });

  it('write -> read roundtrip preserves all fields and uses 0o600', async () => {
    const { store, filePath } = makeStore();
    const auth = baseAuth();
    await store.write(auth);

    const store2 = new CodexTokenStore({ filePath, refreshFn: vi.fn(), now: () => NOW });
    const loaded = await store2.read();
    expect(loaded).toEqual(auth);

    const s = await stat(filePath);
    expect(s.mode & 0o777).toBe(0o600);
  });

  it('write auto-creates parent directory', async () => {
    const base = join(tmpdir(), `codex-token-test-${randomBytes(8).toString('hex')}`);
    const nested = join(base, 'nested', 'deeper', 'creds.json');
    createdPaths.push(nested);
    createdPaths.push(base);
    const store = new CodexTokenStore({ filePath: nested, refreshFn: vi.fn(), now: () => NOW });
    await store.write(baseAuth());
    const body = await readFile(nested, 'utf8');
    expect(JSON.parse(body).accessToken).toBe('acc-1');
  });

  it('getValidAccessToken reads from disk when cache empty', async () => {
    const { store, filePath } = makeStore();
    await store.write(baseAuth({ expiresAt: NOW + 60 * 60 * 1000 }));

    const refreshFn = vi.fn();
    const store2 = new CodexTokenStore({ filePath, refreshFn, now: () => NOW });
    const token = await store2.getValidAccessToken();
    expect(token).toBe('acc-1');
    expect(refreshFn).not.toHaveBeenCalled();
  });

  it('getValidAccessToken throws when no stored creds', async () => {
    const { store } = makeStore();
    await expect(store.getValidAccessToken()).rejects.toThrow('No Codex credentials stored');
  });

  it('proactively refreshes within 5-min buffer', async () => {
    const newSet: TokenSet = {
      accessToken: 'acc-2',
      refreshToken: 'ref-2',
      idToken: ID_TOKEN_WITH_OTHER_EMAIL,
      expiresAt: NOW + 60 * 60 * 1000,
      accountId: 'acct-2',
    };
    const refreshFn = vi.fn().mockResolvedValue(newSet);
    const { store, filePath } = makeStore({ refreshFn });
    await store.write(baseAuth({ expiresAt: NOW + 3 * 60 * 1000 }));

    const token = await store.getValidAccessToken();
    expect(token).toBe('acc-2');
    expect(refreshFn).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(await readFile(filePath, 'utf8')) as StoredCodexAuth;
    expect(persisted.accessToken).toBe('acc-2');
    expect(persisted.refreshToken).toBe('ref-2');
    expect(persisted.email).toBe('new@example.com');
  });

  it('does not refresh when not near expiry', async () => {
    const refreshFn = vi.fn();
    const { store } = makeStore({ refreshFn });
    await store.write(baseAuth({ expiresAt: NOW + 60 * 60 * 1000 }));
    const token = await store.getValidAccessToken();
    expect(token).toBe('acc-1');
    expect(refreshFn).not.toHaveBeenCalled();
  });

  it('dedupes concurrent refresh calls', async () => {
    const newSet: TokenSet = {
      accessToken: 'acc-concurrent',
      refreshToken: 'ref-concurrent',
      idToken: ID_TOKEN_WITH_EMAIL,
      expiresAt: NOW + 60 * 60 * 1000,
      accountId: 'acct-1',
    };
    const refreshFn = vi.fn(
      () => new Promise<TokenSet>((resolve) => setTimeout(() => resolve(newSet), 50)),
    );
    const { store } = makeStore({ refreshFn });
    await store.write(baseAuth({ expiresAt: NOW - 1000 }));

    const results = await Promise.all([
      store.getValidAccessToken(),
      store.getValidAccessToken(),
      store.getValidAccessToken(),
    ]);
    expect(results).toEqual(['acc-concurrent', 'acc-concurrent', 'acc-concurrent']);
    expect(refreshFn).toHaveBeenCalledTimes(1);
  });

  it('preserves refreshToken when response omits it', async () => {
    const newSet: TokenSet = {
      accessToken: 'acc-3',
      refreshToken: '',
      idToken: ID_TOKEN_WITH_EMAIL,
      expiresAt: NOW + 60 * 60 * 1000,
      accountId: 'acct-1',
    };
    const refreshFn = vi.fn().mockResolvedValue(newSet);
    const { store, filePath } = makeStore({ refreshFn });
    await store.write(baseAuth({ expiresAt: NOW - 1000, refreshToken: 'original-ref' }));

    await store.getValidAccessToken();
    const persisted = JSON.parse(await readFile(filePath, 'utf8')) as StoredCodexAuth;
    expect(persisted.refreshToken).toBe('original-ref');
    expect(persisted.accessToken).toBe('acc-3');
  });

  it('forceRefresh ignores expiry check', async () => {
    const newSet: TokenSet = {
      accessToken: 'acc-forced',
      refreshToken: 'ref-forced',
      idToken: ID_TOKEN_WITH_EMAIL,
      expiresAt: NOW + 60 * 60 * 1000,
      accountId: 'acct-1',
    };
    const refreshFn = vi.fn().mockResolvedValue(newSet);
    const { store } = makeStore({ refreshFn });
    await store.write(baseAuth({ expiresAt: NOW + 60 * 60 * 1000 }));

    const token = await store.forceRefresh();
    expect(token).toBe('acc-forced');
    expect(refreshFn).toHaveBeenCalledTimes(1);
  });

  it('clear removes file and drops cache', async () => {
    const { store, filePath } = makeStore();
    await store.write(baseAuth());
    await store.clear();
    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(store.getValidAccessToken()).rejects.toThrow('No Codex credentials stored');
  });

  it('read throws on malformed JSON', async () => {
    const { store, filePath } = makeStore();
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, '{not:"json', 'utf8');
    await expect(store.read()).rejects.toThrow(/Invalid Codex token store/);
  });

  it('clears stored auth and throws Chinese error when refresh hits invalid_grant', async () => {
    const refreshFn = vi
      .fn()
      .mockRejectedValue(
        new Error('Codex OAuth refresh failed: 400 {"error":"invalid_grant"}'),
      );
    const { store, filePath } = makeStore({ refreshFn });
    await store.write(baseAuth({ expiresAt: NOW - 1000 }));

    await expect(store.getValidAccessToken()).rejects.toThrow(/ChatGPT 订阅已失效/);
    expect(await store.read()).toBeNull();
    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    // Second call must not retry with a stale cache — it should throw the
    // "no credentials" path instead of invoking refreshFn again.
    await expect(store.getValidAccessToken()).rejects.toThrow();
    expect(refreshFn).toHaveBeenCalledTimes(1);
  });

  it('preserves stored auth when refresh fails with a transient network error', async () => {
    const refreshFn = vi.fn().mockRejectedValue(new Error('network timeout'));
    const { store, filePath } = makeStore({ refreshFn });
    const auth = baseAuth({ expiresAt: NOW - 1000 });
    await store.write(auth);

    await expect(store.getValidAccessToken()).rejects.toThrow(/network timeout/);

    // File must still be on disk; a fresh store must read the original auth.
    const store2 = new CodexTokenStore({ filePath, refreshFn: vi.fn(), now: () => NOW });
    expect(await store2.read()).toEqual(auth);
  });

  it('read throws when schemaVersion is not 1', async () => {
    const { store, filePath } = makeStore();
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 2,
        accessToken: 'a',
        refreshToken: 'r',
        idToken: 'i',
        expiresAt: 1,
        accountId: null,
        email: null,
        updatedAt: 1,
      }),
      'utf8',
    );
    await expect(store.read()).rejects.toThrow(/Invalid Codex token store/);
  });
});
