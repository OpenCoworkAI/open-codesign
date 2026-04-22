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
  CHATGPT_CODEX_PROVIDER_ID,
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

// Re-export the id so callers that already import from this module don't have
// to add a second import from shared. The value itself lives in shared to
// avoid a module cycle with `provider-settings`.
export { CHATGPT_CODEX_PROVIDER_ID };

const CHATGPT_CODEX_PROVIDER: ProviderEntry = {
  id: CHATGPT_CODEX_PROVIDER_ID,
  name: 'ChatGPT 订阅',
  builtin: false,
  wire: 'openai-codex-responses',
  // pi-ai's openai-codex-responses wire appends `/codex/responses` itself, so
  // we store the bare base. Do not add `/codex` here — it'd produce
  // `/codex/codex/responses`.
  baseUrl: 'https://chatgpt.com/backend-api',
  defaultModel: 'gpt-5.3-codex',
  // Ordered strongest-first by pricing tier / recency, so the UI model
  // picker surfaces the best choice at the top. `defaultModel` is the
  // codex-specialized flagship rather than gpt-5.4 because the
  // codex-trained family produces more reliable artifact output today.
  modelsHint: [
    'gpt-5.4',
    'gpt-5.3-codex',
    'gpt-5.3-codex-spark',
    'gpt-5.2-codex',
    'gpt-5.2',
    'gpt-5.1-codex-max',
    'gpt-5.1',
    'gpt-5.4-mini',
    'gpt-5.1-codex-mini',
  ],
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
    if (err instanceof CodesignError) throw err;
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
  const cfgAfter = getCachedConfig();
  if (cfgAfter !== null && cfgAfter.activeProvider === CHATGPT_CODEX_PROVIDER_ID) {
    const next: Config = { ...cfgAfter, activeProvider: '', activeModel: '' };
    await writeConfig(next);
    setCachedConfig(next);
  }
  logger.info('codex.oauth.logout.ok');
  return { loggedIn: false, email: null, accountId: null, expiresAt: null };
}

/**
 * One-shot boot migration for feat-branch testers: if an older build wrote
 * `chatgpt-codex` with Phase 1's stale `wire`/`baseUrl`, overwrite with the
 * Phase 2 canonical values so the first generate after upgrade works without
 * requiring a manual re-login. No-op when the entry is absent or already
 * canonical. Safe to call on every boot — writes only when state diverges.
 *
 * Phase 1 released the card in "coming soon" disabled mode, so this migration
 * only fires for users who ran this feat branch directly; zero writes on
 * fresh installs or first-time upgraders from a stock main build.
 */
export async function migrateStaleCodexEntryIfNeeded(): Promise<void> {
  const cfg = getCachedConfig();
  const entry = cfg?.providers[CHATGPT_CODEX_PROVIDER_ID];
  if (cfg === null || entry === undefined) return;
  const isStale =
    entry.wire !== CHATGPT_CODEX_PROVIDER.wire || entry.baseUrl !== CHATGPT_CODEX_PROVIDER.baseUrl;
  if (!isStale) return;
  await persistProviderMutation((providers) => {
    providers[CHATGPT_CODEX_PROVIDER_ID] = { ...CHATGPT_CODEX_PROVIDER };
    return providers;
  });
  logger.info('codex.oauth.migrate.stale_entry_rewritten', {
    previousWire: entry.wire,
    previousBaseUrl: entry.baseUrl,
  });
}

export function registerCodexOAuthIpc(): void {
  ipcMain.handle('codex-oauth:v1:status', async (): Promise<CodexOAuthStatus> => runStatus());
  ipcMain.handle('codex-oauth:v1:login', async (): Promise<CodexOAuthStatus> => runLogin());
  ipcMain.handle('codex-oauth:v1:logout', async (): Promise<CodexOAuthStatus> => runLogout());
}
