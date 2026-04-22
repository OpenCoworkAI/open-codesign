/**
 * Tests for codex-oauth-ipc. Mocks the callback server, exchange, shell open,
 * token store file I/O (via a tmp path), and the parent onboarding-ipc
 * cachedConfig setter so we can observe provider mutation.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('./electron-runtime', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
  shell: { openExternal: vi.fn(async () => true) },
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false, getVersion: vi.fn(() => '0.0.0') },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn(async () => true) },
}));

vi.mock('electron-log/main', () => ({
  default: {
    scope: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
    transports: {
      file: { resolvePathFn: null, maxSize: 0, format: '' },
      console: { level: 'info', format: '' },
    },
    errorHandler: { startCatching: vi.fn() },
    eventLogger: { startLogging: vi.fn() },
    info: vi.fn(),
  },
}));

vi.mock('./logger', () => ({
  getLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

// writeConfig is a spy so we can assert it was invoked.
const writeConfigMock = vi.fn(async () => {});
vi.mock('./config', () => ({
  configDir: () => tmpConfigDir,
  writeConfig: writeConfigMock,
}));

// Minimal in-memory replacement for onboarding-ipc's cached-config surface.
let fakeCachedConfig: {
  activeProvider: string;
  activeModel: string;
  secrets: Record<string, unknown>;
  providers: Record<string, unknown>;
  designSystem?: unknown;
} | null = null;
vi.mock('./onboarding-ipc', () => ({
  getCachedConfig: () => fakeCachedConfig,
  setCachedConfig: (cfg: typeof fakeCachedConfig) => {
    fakeCachedConfig = cfg;
  },
}));

// Capture callback-server mock so individual tests can swap waitForCode behavior.
const waitForCodeMock = vi.fn();
const closeMock = vi.fn();
const startCallbackServerMock = vi.fn(async () => ({
  redirectUri: 'http://localhost:1455/auth/callback',
  waitForCode: waitForCodeMock,
  close: closeMock,
}));
const exchangeCodeMock = vi.fn();

vi.mock('@open-codesign/providers/codex', async () => {
  const actual = await vi.importActual<typeof import('@open-codesign/providers/codex')>(
    '@open-codesign/providers/codex',
  );
  return {
    ...actual,
    startCallbackServer: startCallbackServerMock,
    exchangeCode: exchangeCodeMock,
  };
});

let tmpConfigDir: string;

beforeEach(() => {
  tmpConfigDir = mkdtempSync(join(tmpdir(), 'codex-oauth-ipc-'));
  fakeCachedConfig = null;
  handlers.clear();
  writeConfigMock.mockClear();
  waitForCodeMock.mockReset();
  closeMock.mockReset();
  startCallbackServerMock.mockClear();
  exchangeCodeMock.mockReset();
});

afterEach(async () => {
  const mod = await import('./codex-oauth-ipc');
  mod.__resetCodexTokenStoreForTests();
  rmSync(tmpConfigDir, { recursive: true, force: true });
});

async function register() {
  const { registerCodexOAuthIpc } = await import('./codex-oauth-ipc');
  registerCodexOAuthIpc();
}

function makeIdToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

describe('codex-oauth:v1:status', () => {
  it('returns loggedIn: false when no token file is present', async () => {
    await register();
    const result = await handlers.get('codex-oauth:v1:status')?.();
    expect(result).toEqual({
      loggedIn: false,
      email: null,
      accountId: null,
      expiresAt: null,
    });
  });

  it('returns loggedIn: true with email/accountId/expiresAt from disk', async () => {
    const { getCodexTokenStore } = await import('./codex-oauth-ipc');
    await getCodexTokenStore().write({
      schemaVersion: 1,
      accessToken: 'at',
      refreshToken: 'rt',
      idToken: 'id',
      expiresAt: 12345,
      accountId: 'acc-1',
      email: 'a@b.com',
      updatedAt: 1,
    });
    await register();
    const result = await handlers.get('codex-oauth:v1:status')?.();
    expect(result).toEqual({
      loggedIn: true,
      email: 'a@b.com',
      accountId: 'acc-1',
      expiresAt: 12345,
    });
  });
});

describe('codex-oauth:v1:login', () => {
  it('runs the happy path: opens browser, writes token, injects provider, persists config', async () => {
    const { shell } = await import('./electron-runtime');
    const shellOpen = shell.openExternal as ReturnType<typeof vi.fn>;
    shellOpen.mockClear();

    waitForCodeMock.mockImplementation(async (expectedState: string) => ({
      code: 'AUTH_CODE',
      state: expectedState,
    }));
    exchangeCodeMock.mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      idToken: makeIdToken({ email: 'user@example.com' }),
      expiresAt: 99999,
      accountId: 'acct-xyz',
    });

    await register();
    const result = (await handlers.get('codex-oauth:v1:login')?.()) as {
      loggedIn: boolean;
      email: string | null;
      accountId: string | null;
    };

    expect(shellOpen).toHaveBeenCalledTimes(1);
    const openedUrl = shellOpen.mock.calls[0]?.[0] as string;
    expect(openedUrl).toContain('https://auth.openai.com/oauth/authorize');
    expect(openedUrl).toContain('code_challenge=');

    expect(result.loggedIn).toBe(true);
    expect(result.email).toBe('user@example.com');
    expect(result.accountId).toBe('acct-xyz');

    expect(writeConfigMock).toHaveBeenCalledTimes(2);
    expect(fakeCachedConfig?.providers['chatgpt-codex']).toMatchObject({
      id: 'chatgpt-codex',
      wire: 'openai-codex-responses',
      baseUrl: 'https://chatgpt.com/backend-api',
      defaultModel: 'gpt-5.3-codex',
      requiresApiKey: false,
    });

    // Token file written to tmp configDir.
    const { getCodexTokenStore } = await import('./codex-oauth-ipc');
    const stored = await getCodexTokenStore().read();
    expect(stored?.accessToken).toBe('new-access');
    expect(closeMock).toHaveBeenCalled();
  });

  it('throws CodesignError and closes the callback server when waitForCode rejects', async () => {
    waitForCodeMock.mockRejectedValue(new Error('callback timeout'));
    await register();
    await expect(handlers.get('codex-oauth:v1:login')?.()).rejects.toThrow(/Codex login failed/);
    expect(closeMock).toHaveBeenCalled();
    expect(writeConfigMock).not.toHaveBeenCalled();
  });

  it('closes callback server when exchangeCode throws', async () => {
    waitForCodeMock.mockImplementation(async (expectedState: string) => ({
      code: 'AUTH_CODE',
      state: expectedState,
    }));
    exchangeCodeMock.mockRejectedValue(new Error('openai returned 400'));

    await register();
    await expect(handlers.get('codex-oauth:v1:login')?.()).rejects.toThrow(/Codex login failed/);

    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(writeConfigMock).not.toHaveBeenCalled();

    const { getCodexTokenStore } = await import('./codex-oauth-ipc');
    const stored = await getCodexTokenStore().read();
    expect(stored).toBeNull();
  });

  it('auto-activates chatgpt-codex when no active provider is set', async () => {
    waitForCodeMock.mockImplementation(async (expectedState: string) => ({
      code: 'AUTH_CODE',
      state: expectedState,
    }));
    exchangeCodeMock.mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      idToken: makeIdToken({ email: 'user@example.com' }),
      expiresAt: 99999,
      accountId: 'acct-xyz',
    });
    fakeCachedConfig = {
      activeProvider: '',
      activeModel: '',
      secrets: {},
      providers: {},
    };

    await register();
    await handlers.get('codex-oauth:v1:login')?.();

    expect(fakeCachedConfig?.activeProvider).toBe('chatgpt-codex');
    expect(fakeCachedConfig?.activeModel).toBe('gpt-5.3-codex');
  });

  it('leaves active provider alone when one is already set and valid', async () => {
    waitForCodeMock.mockImplementation(async (expectedState: string) => ({
      code: 'AUTH_CODE',
      state: expectedState,
    }));
    exchangeCodeMock.mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      idToken: makeIdToken({ email: 'user@example.com' }),
      expiresAt: 99999,
      accountId: 'acct-xyz',
    });
    fakeCachedConfig = {
      activeProvider: 'anthropic',
      activeModel: 'claude-sonnet-4-6',
      secrets: {},
      providers: {
        anthropic: {
          id: 'anthropic',
          name: 'Anthropic Claude',
          builtin: true,
          wire: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          defaultModel: 'claude-sonnet-4-6',
        },
      },
    };

    await register();
    await handlers.get('codex-oauth:v1:login')?.();

    expect(fakeCachedConfig?.activeProvider).toBe('anthropic');
    expect(fakeCachedConfig?.activeModel).toBe('claude-sonnet-4-6');
    expect(fakeCachedConfig?.providers['chatgpt-codex']).toBeDefined();
  });

  it('rejects login when exchangeCode returns a null accountId', async () => {
    waitForCodeMock.mockImplementation(async (expectedState: string) => ({
      code: 'AUTH_CODE',
      state: expectedState,
    }));
    exchangeCodeMock.mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      idToken: makeIdToken({ email: 'user@example.com' }),
      expiresAt: 99999,
      accountId: null,
    });

    await register();
    await expect(handlers.get('codex-oauth:v1:login')?.()).rejects.toThrow(/无法读取.*账户/);
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(writeConfigMock).not.toHaveBeenCalled();

    const { getCodexTokenStore } = await import('./codex-oauth-ipc');
    const stored = await getCodexTokenStore().read();
    expect(stored).toBeNull();
    expect(fakeCachedConfig).toBeNull();
  });
});

describe('codex-oauth:v1:logout', () => {
  it('clears stored token and removes chatgpt-codex from providers', async () => {
    const { getCodexTokenStore } = await import('./codex-oauth-ipc');
    await getCodexTokenStore().write({
      schemaVersion: 1,
      accessToken: 'at',
      refreshToken: 'rt',
      idToken: 'id',
      expiresAt: 99,
      accountId: 'a',
      email: 'e@f.g',
      updatedAt: 1,
    });
    fakeCachedConfig = {
      activeProvider: 'chatgpt-codex',
      activeModel: 'gpt-5.3-codex',
      secrets: {},
      providers: {
        'chatgpt-codex': {
          id: 'chatgpt-codex',
          name: 'ChatGPT 订阅',
          builtin: false,
          wire: 'openai-responses',
          baseUrl: 'https://chatgpt.com/backend-api/codex',
          defaultModel: 'gpt-5.3-codex',
          requiresApiKey: false,
        },
      },
    };

    await register();
    const result = await handlers.get('codex-oauth:v1:logout')?.();

    expect(result).toEqual({
      loggedIn: false,
      email: null,
      accountId: null,
      expiresAt: null,
    });
    expect(writeConfigMock).toHaveBeenCalledTimes(2);
    expect(fakeCachedConfig?.providers['chatgpt-codex']).toBeUndefined();
    expect(fakeCachedConfig?.activeProvider).toBe('');
    expect(fakeCachedConfig?.activeModel).toBe('');
    const stored = await getCodexTokenStore().read();
    expect(stored).toBeNull();
  });
});

describe('migrateStaleCodexEntryIfNeeded', () => {
  it('rewrites Phase-1-shaped codex entry with current wire + baseUrl', async () => {
    fakeCachedConfig = {
      activeProvider: 'chatgpt-codex',
      activeModel: 'gpt-5.3-codex',
      secrets: {},
      providers: {
        'chatgpt-codex': {
          id: 'chatgpt-codex',
          name: 'ChatGPT 订阅',
          builtin: false,
          // Phase 1 stale shape
          wire: 'openai-responses',
          baseUrl: 'https://chatgpt.com/backend-api/codex',
          defaultModel: 'gpt-5.3-codex',
          modelsHint: ['gpt-5.3-codex'],
          requiresApiKey: false,
        },
      },
    };

    const { migrateStaleCodexEntryIfNeeded } = await import('./codex-oauth-ipc');
    await migrateStaleCodexEntryIfNeeded();

    const rewritten = fakeCachedConfig?.providers['chatgpt-codex'] as Record<string, unknown>;
    expect(rewritten['wire']).toBe('openai-codex-responses');
    expect(rewritten['baseUrl']).toBe('https://chatgpt.com/backend-api');
    expect(writeConfigMock).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the codex entry is already canonical', async () => {
    fakeCachedConfig = {
      activeProvider: 'chatgpt-codex',
      activeModel: 'gpt-5.3-codex',
      secrets: {},
      providers: {
        'chatgpt-codex': {
          id: 'chatgpt-codex',
          name: 'ChatGPT 订阅',
          builtin: false,
          wire: 'openai-codex-responses',
          baseUrl: 'https://chatgpt.com/backend-api',
          defaultModel: 'gpt-5.3-codex',
          requiresApiKey: false,
        },
      },
    };
    writeConfigMock.mockClear();

    const { migrateStaleCodexEntryIfNeeded } = await import('./codex-oauth-ipc');
    await migrateStaleCodexEntryIfNeeded();

    expect(writeConfigMock).not.toHaveBeenCalled();
  });

  it('is a no-op when no codex entry exists', async () => {
    fakeCachedConfig = {
      activeProvider: 'anthropic',
      activeModel: 'claude-sonnet-4-6',
      secrets: {},
      providers: {},
    };
    writeConfigMock.mockClear();

    const { migrateStaleCodexEntryIfNeeded } = await import('./codex-oauth-ipc');
    await migrateStaleCodexEntryIfNeeded();

    expect(writeConfigMock).not.toHaveBeenCalled();
  });

  it('is a no-op when cachedConfig is null (pre-onboarding boot)', async () => {
    fakeCachedConfig = null;
    writeConfigMock.mockClear();

    const { migrateStaleCodexEntryIfNeeded } = await import('./codex-oauth-ipc');
    await migrateStaleCodexEntryIfNeeded();

    expect(writeConfigMock).not.toHaveBeenCalled();
  });
});
