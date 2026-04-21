import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import {
  type CallbackServer,
  CodexTokenStore,
  type StoredCodexAuth,
  type TokenSet,
  buildAuthorizeUrl,
  decodeJwtClaims,
  exchangeCode,
  generatePkce,
  startCallbackServer,
} from '@open-codesign/providers/codex';
import {
  CodesignError,
  type Config,
  ERROR_CODES,
  type ProviderEntry,
  hydrateConfig,
} from '@open-codesign/shared';
import { configDir, writeConfig } from './config';
import { ipcMain, shell } from './electron-runtime';
import { getLogger } from './logger';
import { getCachedConfig, setCachedConfig } from './onboarding-ipc';

const logger = getLogger('codex-oauth-ipc');

export interface CodexOAuthStatus {
  loggedIn: boolean;
  email: string | null;
  accountId: string | null;
  expiresAt: number | null;
}

export const CHATGPT_CODEX_PROVIDER_ID = 'chatgpt-codex';

const CHATGPT_CODEX_PROVIDER: ProviderEntry = {
  id: CHATGPT_CODEX_PROVIDER_ID,
  name: 'ChatGPT 订阅',
  builtin: false,
  wire: 'openai-responses',
  baseUrl: 'https://chatgpt.com/backend-api/codex',
  defaultModel: 'gpt-5.3-codex',
  modelsHint: ['gpt-5.3-codex', 'gpt-5.4', 'gpt-5.1-codex-mini'],
  requiresApiKey: false,
};

let tokenStoreSingleton: CodexTokenStore | null = null;

/**
 * Lazily instantiated module-scoped store. Shared with Task 7's generate flow
 * so refresh-on-use and login-time writes hit the same file + in-memory cache.
 */
export function getCodexTokenStore(): CodexTokenStore {
  if (tokenStoreSingleton === null) {
    tokenStoreSingleton = new CodexTokenStore({
      filePath: join(configDir(), 'codex-auth.json'),
    });
  }
  return tokenStoreSingleton;
}

/** Test-only reset hook — vitest resets module state between test cases. */
export function __resetCodexTokenStoreForTests(): void {
  tokenStoreSingleton = null;
}

function extractEmail(jwt: string): string | null {
  const claims = decodeJwtClaims(jwt);
  if (claims === null) return null;
  const email = claims['email'];
  return typeof email === 'string' && email.length > 0 ? email : null;
}

function toStatus(stored: StoredCodexAuth | null): CodexOAuthStatus {
  if (stored === null) {
    return { loggedIn: false, email: null, accountId: null, expiresAt: null };
  }
  return {
    loggedIn: true,
    email: stored.email,
    accountId: stored.accountId,
    expiresAt: stored.expiresAt,
  };
}

async function runStatus(): Promise<CodexOAuthStatus> {
  const stored = await getCodexTokenStore().read();
  return toStatus(stored);
}

async function persistProviderMutation(
  mutate: (providers: Record<string, ProviderEntry>) => Record<string, ProviderEntry>,
): Promise<void> {
  const cfg = getCachedConfig();
  const prevProviders: Record<string, ProviderEntry> = cfg?.providers ?? {};
  const nextProviders = mutate({ ...prevProviders });
  const next: Config = hydrateConfig({
    version: 3,
    activeProvider: cfg?.activeProvider ?? '',
    activeModel: cfg?.activeModel ?? '',
    secrets: cfg?.secrets ?? {},
    providers: nextProviders,
    ...(cfg?.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
  });
  await writeConfig(next);
  setCachedConfig(next);
}

async function claimActiveProviderIfUnset(): Promise<void> {
  const cfg = getCachedConfig();
  if (cfg === null) return;
  const current = cfg.activeProvider;
  const hasValidActive =
    current !== undefined &&
    current !== null &&
    current !== '' &&
    cfg.providers[current] !== undefined;
  if (hasValidActive) return;
  const next: Config = hydrateConfig({
    version: 3,
    activeProvider: CHATGPT_CODEX_PROVIDER_ID,
    activeModel: CHATGPT_CODEX_PROVIDER.defaultModel,
    secrets: cfg.secrets,
    providers: cfg.providers,
    ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
  });
  await writeConfig(next);
  setCachedConfig(next);
}

async function runLogin(): Promise<CodexOAuthStatus> {
  const pkce = generatePkce();
  const state = randomBytes(16).toString('hex');
  let server: CallbackServer | null = null;
  try {
    server = await startCallbackServer();
    const authorizeUrl = buildAuthorizeUrl({
      redirectUri: server.redirectUri,
      state,
      challenge: pkce.challenge,
    });
    await shell.openExternal(authorizeUrl);
    logger.info('codex.oauth.login.started', { redirectUri: server.redirectUri });
    const { code } = await server.waitForCode(state);
    const tokenSet: TokenSet = await exchangeCode(code, pkce.verifier, server.redirectUri);
    if (tokenSet.accountId === null) {
      throw new CodesignError(
        'Codex 登录成功但无法读取 ChatGPT 账户 ID，请重试登录。',
        ERROR_CODES.PROVIDER_ERROR,
        { cause: null },
      );
    }
    const email = extractEmail(tokenSet.idToken);
    const stored: StoredCodexAuth = {
      schemaVersion: 1,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      idToken: tokenSet.idToken,
      expiresAt: tokenSet.expiresAt,
      accountId: tokenSet.accountId,
      email,
      updatedAt: Date.now(),
    };
    await getCodexTokenStore().write(stored);
    await persistProviderMutation((providers) => {
      providers[CHATGPT_CODEX_PROVIDER_ID] = { ...CHATGPT_CODEX_PROVIDER };
      return providers;
    });
    await claimActiveProviderIfUnset();
    logger.info('codex.oauth.login.ok', { accountId: stored.accountId, hasEmail: email !== null });
    return toStatus(stored);
  } catch (err) {
    logger.error('codex.oauth.login.fail', {
      message: err instanceof Error ? err.message : String(err),
    });
    throw new CodesignError(
      `Codex login failed: ${err instanceof Error ? err.message : String(err)}`,
      ERROR_CODES.PROVIDER_ERROR,
      { cause: err },
    );
  } finally {
    server?.close();
  }
}

async function runLogout(): Promise<CodexOAuthStatus> {
  await getCodexTokenStore().clear();
  const cfg = getCachedConfig();
  if (cfg?.providers[CHATGPT_CODEX_PROVIDER_ID] !== undefined) {
    await persistProviderMutation((providers) => {
      delete providers[CHATGPT_CODEX_PROVIDER_ID];
      return providers;
    });
  }
  logger.info('codex.oauth.logout.ok');
  return { loggedIn: false, email: null, accountId: null, expiresAt: null };
}

export function registerCodexOAuthIpc(): void {
  ipcMain.handle('codex-oauth:v1:status', async (): Promise<CodexOAuthStatus> => runStatus());
  ipcMain.handle('codex-oauth:v1:login', async (): Promise<CodexOAuthStatus> => runLogin());
  ipcMain.handle('codex-oauth:v1:logout', async (): Promise<CodexOAuthStatus> => runLogout());
}
