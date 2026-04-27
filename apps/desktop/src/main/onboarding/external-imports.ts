import {
  BUILTIN_PROVIDERS,
  CodesignError,
  ERROR_CODES,
  hydrateConfig,
  type OnboardingState,
  type ProviderEntry,
} from '@open-codesign/shared';
import { writeConfig } from '../config';
import type { ClaudeCodeImport } from '../imports/claude-code-config';
import type { CodexImport } from '../imports/codex-config';
import type { GeminiImport } from '../imports/gemini-cli-config';
import type { OpencodeImport } from '../imports/opencode-config';
import { buildSecretRef } from '../keychain';
import { isKeylessProviderAllowed } from '../provider-settings';
import { detectChatgptSubscription } from './chatgpt-detect';
import { getCachedConfig, setCachedConfig, toState } from './config-cache';

function providerHasUsableCredential(
  entry: ProviderEntry,
  secrets: Record<string, unknown>,
): boolean {
  return secrets[entry.id] !== undefined || isKeylessProviderAllowed(entry.id, entry);
}

function firstUsableImportedProvider(
  providers: ProviderEntry[],
  secrets: Record<string, unknown>,
): ProviderEntry | null {
  return providers.find((entry) => providerHasUsableCredential(entry, secrets)) ?? null;
}

function chooseUsableImportedProvider(
  providers: ProviderEntry[],
  preferredProviderId: string | null,
  secrets: Record<string, unknown>,
): ProviderEntry | null {
  const preferred =
    preferredProviderId !== null
      ? (providers.find((entry) => entry.id === preferredProviderId) ?? null)
      : null;
  if (preferred !== null && providerHasUsableCredential(preferred, secrets)) return preferred;
  return firstUsableImportedProvider(providers, secrets);
}

function throwNoUsableImport(source: string): never {
  throw new CodesignError(
    `${source} import did not find a usable API key. Paste a key in Settings or export the provider key before importing.`,
    ERROR_CODES.PROVIDER_KEY_MISSING,
  );
}

function activeModelForImport(
  activeEntry: ProviderEntry,
  preferredProviderId: string | null,
  preferredModel: string | null,
): string {
  return activeEntry.id === preferredProviderId && preferredModel !== null
    ? preferredModel
    : activeEntry.defaultModel;
}

export async function runImportCodex(imported: CodexImport): Promise<OnboardingState> {
  if (imported.providers.length === 0) {
    throw new CodesignError(
      (await detectChatgptSubscription())
        ? 'Detected Codex ChatGPT subscription login (auth_mode: chatgpt). It cannot be imported as an API-key provider yet — the "Sign in with ChatGPT subscription" feature is still being polished and will ship in the next release. For now, configure [model_providers] in ~/.codex/config.toml manually, or switch to API-key mode in Codex. / 检测到 Codex 使用 ChatGPT 订阅登录，无法自动导入为 API key provider。"用 ChatGPT 订阅登录"功能仍在打磨中，下个版本开放 —— 目前请在 ~/.codex/config.toml 里手动配置 [model_providers]，或改用 API key 登录 Codex。'
        : 'No importable API provider found in Codex config (~/.codex/config.toml is missing a [model_providers] section). / Codex 配置里没有可导入的 API provider（~/.codex/config.toml 里缺少 [model_providers] 段）。',
      ERROR_CODES.CONFIG_MISSING,
    );
  }
  const cachedConfig = getCachedConfig();
  const nextProviders: Record<string, ProviderEntry> = { ...(cachedConfig?.providers ?? {}) };
  const nextSecrets = { ...(cachedConfig?.secrets ?? {}) };
  // Seed builtins if we're on a fresh install so the user keeps a usable default.
  if (cachedConfig === null) {
    for (const [id, entry] of Object.entries(BUILTIN_PROVIDERS)) {
      if (nextProviders[id] === undefined) nextProviders[id] = { ...entry };
    }
  }
  for (const entry of imported.providers) {
    nextProviders[entry.id] = entry;
    const importedApiKey = imported.apiKeyMap[entry.id]?.trim();
    if (entry.envKey !== undefined) {
      const envValue = process.env[entry.envKey]?.trim();
      if (envValue !== undefined && envValue.length > 0) {
        // buildSecretRef throws only on empty input — length is already
        // guarded. Bare call instead of wrapping in try/catch so any future
        // invariant break fails loudly rather than quietly writing a row
        // with no key and reporting success.
        nextSecrets[entry.id] = buildSecretRef(envValue);
        continue;
      }
    }
    const importTimeApiKey =
      importedApiKey !== undefined && importedApiKey.length > 0
        ? importedApiKey
        : entry.requiresApiKey === true
          ? process.env['OPENAI_API_KEY']?.trim()
          : undefined;
    if (importTimeApiKey !== undefined && importTimeApiKey.length > 0) {
      nextSecrets[entry.id] = buildSecretRef(importTimeApiKey);
    }
  }
  const activeEntry = chooseUsableImportedProvider(
    imported.providers,
    imported.activeProvider,
    nextSecrets,
  );
  if (activeEntry === null) throwNoUsableImport('Codex');
  const activeProvider = activeEntry.id;
  const activeModel = activeModelForImport(
    activeEntry,
    imported.activeProvider,
    imported.activeModel,
  );
  const next = hydrateConfig({
    version: 3,
    activeProvider,
    activeModel,
    secrets: nextSecrets,
    providers: nextProviders,
    ...(cachedConfig?.designSystem !== undefined
      ? { designSystem: cachedConfig.designSystem }
      : {}),
  });
  await writeConfig(next);
  setCachedConfig(next);
  return toState(next);
}

export async function runImportClaudeCode(imported: ClaudeCodeImport): Promise<OnboardingState> {
  // OAuth-only users: bail loudly without touching config. The renderer
  // catches this error code and shows the "subscription can't be shared"
  // banner instead of a fake "imported" toast that would then immediately
  // leave the user in a dead-locked hasKey:false state.
  if (imported.userType === 'oauth-only') {
    throw new CodesignError(
      'Claude Code uses OAuth subscription auth. Generate an API key at https://console.anthropic.com to use it here.',
      ERROR_CODES.CLAUDE_CODE_OAUTH_ONLY,
    );
  }
  if (imported.provider === null) {
    throw new CodesignError('Claude Code config produced no provider', ERROR_CODES.CONFIG_MISSING);
  }

  const cachedConfig = getCachedConfig();
  const nextProviders: Record<string, ProviderEntry> = { ...(cachedConfig?.providers ?? {}) };
  const nextSecrets = { ...(cachedConfig?.secrets ?? {}) };
  if (cachedConfig === null) {
    for (const [id, entry] of Object.entries(BUILTIN_PROVIDERS)) {
      if (nextProviders[id] === undefined) nextProviders[id] = { ...entry };
    }
  }
  nextProviders[imported.provider.id] = imported.provider;
  const importedApiKey = imported.apiKey?.trim();
  const keySaved = importedApiKey !== undefined && importedApiKey.length > 0;
  if (keySaved) {
    nextSecrets[imported.provider.id] = buildSecretRef(importedApiKey);
  }
  if (!providerHasUsableCredential(imported.provider, nextSecrets)) {
    throwNoUsableImport('Claude Code');
  }

  const next = hydrateConfig({
    version: 3,
    activeProvider: imported.provider.id,
    activeModel: imported.activeModel ?? imported.provider.defaultModel,
    secrets: nextSecrets,
    providers: nextProviders,
    ...(cachedConfig?.designSystem !== undefined
      ? { designSystem: cachedConfig.designSystem }
      : {}),
  });
  await writeConfig(next);
  setCachedConfig(next);
  return toState(next);
}

export async function runImportGemini(imported: GeminiImport): Promise<OnboardingState> {
  // Blocked state: Vertex detection etc. — no provider to write. The
  // renderer catches CONFIG_MISSING and surfaces the warning in a toast.
  if (imported.kind === 'blocked') {
    throw new CodesignError(
      imported.warnings[0] ?? 'Gemini CLI config produced no provider',
      ERROR_CODES.CONFIG_MISSING,
    );
  }

  const cachedConfig = getCachedConfig();
  const nextProviders: Record<string, ProviderEntry> = { ...(cachedConfig?.providers ?? {}) };
  const nextSecrets = { ...(cachedConfig?.secrets ?? {}) };
  if (cachedConfig === null) {
    for (const [id, entry] of Object.entries(BUILTIN_PROVIDERS)) {
      if (nextProviders[id] === undefined) nextProviders[id] = { ...entry };
    }
  }
  nextProviders[imported.provider.id] = imported.provider;
  const importedApiKey = imported.apiKey.trim();
  const keySaved = importedApiKey.length > 0;
  if (keySaved) {
    nextSecrets[imported.provider.id] = buildSecretRef(importedApiKey);
  }
  if (!providerHasUsableCredential(imported.provider, nextSecrets)) {
    throwNoUsableImport('Gemini CLI');
  }

  const next = hydrateConfig({
    version: 3,
    activeProvider: imported.provider.id,
    activeModel: imported.provider.defaultModel,
    secrets: nextSecrets,
    providers: nextProviders,
    ...(cachedConfig?.designSystem !== undefined
      ? { designSystem: cachedConfig.designSystem }
      : {}),
  });
  await writeConfig(next);
  setCachedConfig(next);
  return toState(next);
}

export async function runImportOpencode(imported: OpencodeImport): Promise<OnboardingState> {
  if (imported.providers.length === 0) {
    throw new CodesignError(
      'No importable API provider found in OpenCode auth.json (~/.local/share/opencode/auth.json). Log in to a provider with an API key in OpenCode first. / OpenCode 配置里没有可导入的 API provider，请先在 OpenCode 里用 API key 登录。',
      ERROR_CODES.CONFIG_MISSING,
    );
  }
  const cachedConfig = getCachedConfig();
  const nextProviders: Record<string, ProviderEntry> = { ...(cachedConfig?.providers ?? {}) };
  const nextSecrets = { ...(cachedConfig?.secrets ?? {}) };
  if (cachedConfig === null) {
    for (const [id, entry] of Object.entries(BUILTIN_PROVIDERS)) {
      if (nextProviders[id] === undefined) nextProviders[id] = { ...entry };
    }
  }
  for (const entry of imported.providers) {
    nextProviders[entry.id] = entry;
    const importedApiKey = imported.apiKeyMap[entry.id]?.trim();
    if (importedApiKey !== undefined && importedApiKey.length > 0) {
      nextSecrets[entry.id] = buildSecretRef(importedApiKey);
    }
  }
  const activeEntry = chooseUsableImportedProvider(
    imported.providers,
    imported.activeProvider,
    nextSecrets,
  );
  if (activeEntry === null) throwNoUsableImport('OpenCode');
  const activeProvider = activeEntry.id;
  const activeModel = activeModelForImport(
    activeEntry,
    imported.activeProvider,
    imported.activeModel,
  );
  const next = hydrateConfig({
    version: 3,
    activeProvider,
    activeModel,
    secrets: nextSecrets,
    providers: nextProviders,
    ...(cachedConfig?.designSystem !== undefined
      ? { designSystem: cachedConfig.designSystem }
      : {}),
  });
  await writeConfig(next);
  setCachedConfig(next);
  return toState(next);
}
