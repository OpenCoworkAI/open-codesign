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
import { getCodexModelOptions } from './codex-models';
import { configDir, writeConfig } from './config';
import { BACKGROUND_DEBUG, ipcMain, shell } from './electron-runtime';
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

const CHATGPT_CODEX_PROVIDER = {
  id: CHATGPT_CODEX_PROVIDER_ID,
  name: 'ChatGPT 订阅',
  builtin: false,
  wire: 'openai-codex-responses',
  // pi-ai's openai-codex-responses wire appends `/codex/responses` itself, so
  // we store the bare base. Do not add `/codex` here — it'd produce
  // `/codex/codex/responses`.
  baseUrl: 'https://chatgpt.com/backend-api',
  requiresApiKey: false,
  capabilities: {
    supportsKeyless: true,
    supportsModelsEndpoint: false,
    supportsReasoning: true,
    requiresClaudeCodeIdentity: false,
    modelDiscoveryMode: 'manual',
  },
} satisfies Omit<ProviderEntry, 'defaultModel'>;

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
      ...(BACKGROUND_DEBUG
        ? {
            refreshFn: async () => {
              throw new Error('BACKGROUND_MODEL_OAUTH_REFRESH_UNSUPPORTED');
            },
          }
        : {}),
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
  selectedModel?: string,
): Promise<void> {
  const cfg = getCachedConfig();
  const prevProviders: Record<string, ProviderEntry> = cfg?.providers ?? {};
  const nextProviders = mutate({ ...prevProviders });
  const next: Config = hydrateConfig({
    version: 3,
    activeProvider: cfg?.activeProvider ?? '',
    activeModel:
      cfg?.activeProvider === CHATGPT_CODEX_PROVIDER_ID && selectedModel !== undefined
        ? selectedModel
        : (cfg?.activeModel ?? ''),
    secrets: cfg?.secrets ?? {},
    providers: nextProviders,
    ...(cfg?.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
    ...(cfg?.imageGeneration !== undefined ? { imageGeneration: cfg.imageGeneration } : {}),
    ...(cfg?.webSearch !== undefined ? { webSearch: cfg.webSearch } : {}),
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
    activeModel: cfg.providers[CHATGPT_CODEX_PROVIDER_ID]?.defaultModel ?? '',
    secrets: cfg.secrets,
    providers: cfg.providers,
    ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
    ...(cfg.imageGeneration !== undefined ? { imageGeneration: cfg.imageGeneration } : {}),
    ...(cfg.webSearch !== undefined ? { webSearch: cfg.webSearch } : {}),
  });
  await writeConfig(next);
  setCachedConfig(next);
}

async function runLoginFlow(
  abortController: AbortController,
  model: string,
  modelChanged: boolean,
): Promise<CodexOAuthStatus> {
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
    await persistProviderMutation(
      (providers) => {
        const previous = providers[CHATGPT_CODEX_PROVIDER_ID];
        const { modelsHint: _legacyHints, ...retained } = previous ?? {};
        providers[CHATGPT_CODEX_PROVIDER_ID] = {
          ...retained,
          ...CHATGPT_CODEX_PROVIDER,
          name: previous?.name ?? CHATGPT_CODEX_PROVIDER.name,
          defaultModel: modelChanged ? model : (previous?.defaultModel ?? model),
        };
        return providers;
      },
      modelChanged ? model : undefined,
    );
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

async function runLogin(raw?: unknown): Promise<CodexOAuthStatus> {
  if (activeLoginPromise !== null) return activeLoginPromise;

  if (raw !== undefined && (typeof raw !== 'string' || raw.trim().length === 0)) {
    throw new CodesignError(
      'Choose a ChatGPT subscription model in Settings > Models.',
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  const abortController = new AbortController();
  activeLoginAbortController = abortController;

  const promise = (async () => {
    const cfg = getCachedConfig();
    const currentModel =
      cfg?.activeProvider === CHATGPT_CODEX_PROVIDER_ID
        ? cfg.activeModel
        : cfg?.providers[CHATGPT_CODEX_PROVIDER_ID]?.defaultModel;
    const model =
      typeof raw === 'string'
        ? raw.trim()
        : (currentModel ?? (await getCodexModelOptions()).suggestedModel);
    if (abortController.signal.aborted) {
      throw new CodesignError('Codex login cancelled', ERROR_CODES.PROVIDER_ABORTED);
    }
    if (!model) {
      throw new CodesignError(
        'Choose a ChatGPT subscription model in Settings > Models. Model access depends on your account.',
        ERROR_CODES.CONFIG_MISSING,
      );
    }
    return runLoginFlow(abortController, model, typeof raw === 'string' && model !== currentModel);
  })();
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
      ...(cfg.imageGeneration !== undefined ? { imageGeneration: cfg.imageGeneration } : {}),
      ...(cfg.webSearch !== undefined ? { webSearch: cfg.webSearch } : {}),
    });
    await writeConfig(next);
    setCachedConfig(next);
  }
  logger.info('codex.oauth.logout.ok');
  return { loggedIn: false, email: null, accountId: null, expiresAt: null };
}

/**
 * Repair transport metadata only. A catalog omission is never evidence that
 * a user's model is stale; upgrades and re-login must preserve that choice.
 */
export async function migrateStaleCodexEntryIfNeeded(): Promise<void> {
  const cfg = getCachedConfig();
  const entry = cfg?.providers[CHATGPT_CODEX_PROVIDER_ID];
  if (cfg === null || entry === undefined) return;

  const providerIsStale =
    entry.wire !== CHATGPT_CODEX_PROVIDER.wire ||
    entry.baseUrl !== CHATGPT_CODEX_PROVIDER.baseUrl ||
    entry.modelsHint !== undefined ||
    entry.capabilities?.modelDiscoveryMode !== 'manual';

  if (!providerIsStale) return;

  const { modelsHint: _legacyHints, ...retained } = entry;
  const nextProviders = {
    ...cfg.providers,
    [CHATGPT_CODEX_PROVIDER_ID]: { ...retained, ...CHATGPT_CODEX_PROVIDER, name: entry.name },
  };
  const next: Config = hydrateConfig({
    version: 3,
    activeProvider: cfg.activeProvider,
    activeModel: cfg.activeModel,
    secrets: cfg.secrets,
    providers: nextProviders,
    ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
    ...(cfg.imageGeneration !== undefined ? { imageGeneration: cfg.imageGeneration } : {}),
    ...(cfg.webSearch !== undefined ? { webSearch: cfg.webSearch } : {}),
  });
  await writeConfig(next);
  setCachedConfig(next);
  logger.info('codex.oauth.migrate.stale_entry_rewritten', {
    previousWire: entry.wire,
    previousBaseUrl: entry.baseUrl,
    previousDefaultModel: entry.defaultModel,
  });
}

export function registerCodexOAuthIpc(): void {
  ipcMain.handle('codex-oauth:v1:status', async (): Promise<CodexOAuthStatus> => runStatus());
  ipcMain.handle('codex-oauth:v1:models', async () => {
    const options = await getCodexModelOptions();
    const cfg = getCachedConfig();
    return {
      ...options,
      suggestedModel:
        cfg?.activeProvider === CHATGPT_CODEX_PROVIDER_ID
          ? cfg.activeModel
          : (cfg?.providers[CHATGPT_CODEX_PROVIDER_ID]?.defaultModel ?? options.suggestedModel),
    };
  });
  ipcMain.handle(
    'codex-oauth:v1:login',
    async (_event, model?: unknown): Promise<CodexOAuthStatus> => runLogin(model),
  );
  ipcMain.handle('codex-oauth:v1:cancel-login', async (): Promise<boolean> => runCancelLogin());
  ipcMain.handle('codex-oauth:v1:logout', async (): Promise<CodexOAuthStatus> => runLogout());
}
