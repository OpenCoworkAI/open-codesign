import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import {
  buildAuthorizeUrl,
  type CallbackServer,
  CodexTokenStore,
  decodeJwtClaims,
  exchangeCode,
  generatePkce,
  type StoredCodexAuth,
  startCallbackServer,
  type TokenSet,
} from '@open-codesign/providers/codex';
import {
  CHATGPT_CODEX_PROVIDER_ID,
  CodesignError,
  type Config,
  ERROR_CODES,
  hydrateConfig,
  type ProviderEntry,
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

const CHATGPT_CODEX_DEFAULT_MODEL = 'gpt-5.5';
const CHATGPT_CODEX_MODELS = [
  CHATGPT_CODEX_DEFAULT_MODEL,
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.2',
];

const CHATGPT_CODEX_PROVIDER: ProviderEntry = {
  id: CHATGPT_CODEX_PROVIDER_ID,
  name: 'ChatGPT 订阅',
  builtin: false,
  wire: 'openai-codex-responses',
  // pi-ai's openai-codex-responses wire appends `/codex/responses` itself, so
  // we store the bare base. Do not add `/codex` here — it'd produce
  // `/codex/codex/responses`.
  baseUrl: 'https://chatgpt.com/backend-api',
  defaultModel: CHATGPT_CODEX_DEFAULT_MODEL,
  // Static hint for the keyless ChatGPT/Codex OAuth path. This endpoint has
  // no usable /models discovery flow, so keep the list aligned with the
  // official Codex model picker and ordered strongest-first.
  modelsHint: CHATGPT_CODEX_MODELS,
  requiresApiKey: false,
  capabilities: {
    supportsKeyless: true,
    supportsModelsEndpoint: false,
    supportsReasoning: true,
    requiresClaudeCodeIdentity: false,
    modelDiscoveryMode: 'static-hint',
  },
};

let tokenStoreSingleton: CodexTokenStore | null = null;
let activeLoginAbortController: AbortController | null = null;
let activeLoginPromise: Promise<CodexOAuthStatus> | null = null;

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
  activeLoginAbortController = null;
  activeLoginPromise = null;
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

async function runLoginFlow(abortController: AbortController): Promise<CodexOAuthStatus> {
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
    const { code } = await server.waitForCode(state, abortController.signal);
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
    if (abortController.signal.aborted) {
      logger.info('codex.oauth.login.cancelled');
      throw new CodesignError('Codex login cancelled', ERROR_CODES.PROVIDER_ABORTED, {
        cause: err,
      });
    }
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

async function runLogin(): Promise<CodexOAuthStatus> {
  if (activeLoginPromise !== null) return activeLoginPromise;

  const abortController = new AbortController();
  activeLoginAbortController = abortController;

  const promise = runLoginFlow(abortController);
  const trackedPromise = promise.finally(() => {
    if (activeLoginAbortController === abortController) {
      activeLoginAbortController = null;
    }
    if (activeLoginPromise === trackedPromise) {
      activeLoginPromise = null;
    }
  });

  activeLoginPromise = trackedPromise;
  return trackedPromise;
}

async function runCancelLogin(): Promise<boolean> {
  if (activeLoginAbortController === null || activeLoginAbortController.signal.aborted) {
    return false;
  }
  activeLoginAbortController.abort();
  return true;
}

async function runLogout(): Promise<CodexOAuthStatus> {
  await getCodexTokenStore().clear();
  const cfg = getCachedConfig();
  if (
    cfg !== null &&
    (cfg.providers[CHATGPT_CODEX_PROVIDER_ID] !== undefined ||
      cfg.activeProvider === CHATGPT_CODEX_PROVIDER_ID)
  ) {
    const nextProviders = { ...cfg.providers };
    delete nextProviders[CHATGPT_CODEX_PROVIDER_ID];
    const activeWasCodex = cfg.activeProvider === CHATGPT_CODEX_PROVIDER_ID;
    const next: Config = hydrateConfig({
      version: 3,
      activeProvider: activeWasCodex ? '' : cfg.activeProvider,
      activeModel: activeWasCodex ? '' : cfg.activeModel,
      secrets: cfg.secrets,
      providers: nextProviders,
      ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
    });
    await writeConfig(next);
    setCachedConfig(next);
  }
  logger.info('codex.oauth.logout.ok');
  return { loggedIn: false, email: null, accountId: null, expiresAt: null };
}

function sameModelHints(input: string[] | undefined): boolean {
  return (
    input !== undefined &&
    input.length === CHATGPT_CODEX_MODELS.length &&
    input.every((model, index) => model === CHATGPT_CODEX_MODELS[index])
  );
}

function isKnownChatgptCodexModel(modelId: string): boolean {
  return CHATGPT_CODEX_MODELS.includes(modelId);
}

/**
 * One-shot boot migration for feat-branch testers: if an older build wrote
 * `chatgpt-codex` with Phase 1's stale `wire`/`baseUrl`, overwrite with the
 * current canonical values so the first generate after upgrade works without
 * requiring a manual re-login. This also refreshes the static model hint list
 * when ChatGPT subscription model availability changes.
 *
 * The public card used to ship disabled, so this migration only fires for
 * users who ran the experimental branch directly; zero writes on fresh
 * installs or first-time upgraders from a stock main build.
 */
export async function migrateStaleCodexEntryIfNeeded(): Promise<void> {
  const cfg = getCachedConfig();
  const entry = cfg?.providers[CHATGPT_CODEX_PROVIDER_ID];
  if (cfg === null || entry === undefined) return;

  const providerIsStale =
    entry.wire !== CHATGPT_CODEX_PROVIDER.wire ||
    entry.baseUrl !== CHATGPT_CODEX_PROVIDER.baseUrl ||
    entry.defaultModel !== CHATGPT_CODEX_PROVIDER.defaultModel ||
    !sameModelHints(entry.modelsHint);
  const activeModelIsStale =
    cfg.activeProvider === CHATGPT_CODEX_PROVIDER_ID && !isKnownChatgptCodexModel(cfg.activeModel);

  if (!providerIsStale && !activeModelIsStale) return;

  const nextProviders = {
    ...cfg.providers,
    [CHATGPT_CODEX_PROVIDER_ID]: { ...CHATGPT_CODEX_PROVIDER },
  };
  const next: Config = hydrateConfig({
    version: 3,
    activeProvider: cfg.activeProvider,
    activeModel: activeModelIsStale ? CHATGPT_CODEX_DEFAULT_MODEL : cfg.activeModel,
    secrets: cfg.secrets,
    providers: nextProviders,
    ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
  });
  await writeConfig(next);
  setCachedConfig(next);
  logger.info('codex.oauth.migrate.stale_entry_rewritten', {
    previousWire: entry.wire,
    previousBaseUrl: entry.baseUrl,
    previousDefaultModel: entry.defaultModel,
    activeModelReset: activeModelIsStale,
  });
}

export function registerCodexOAuthIpc(): void {
  ipcMain.handle('codex-oauth:v1:status', async (): Promise<CodexOAuthStatus> => runStatus());
  ipcMain.handle('codex-oauth:v1:login', async (): Promise<CodexOAuthStatus> => runLogin());
  ipcMain.handle('codex-oauth:v1:cancel-login', async (): Promise<boolean> => runCancelLogin());
  ipcMain.handle('codex-oauth:v1:logout', async (): Promise<CodexOAuthStatus> => runLogout());
}
