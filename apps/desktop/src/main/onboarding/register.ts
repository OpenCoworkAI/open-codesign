import { pingProvider, type ValidateResult } from '@open-codesign/providers';
import {
  CodesignError,
  ERROR_CODES,
  type ExternalConfigsDetection,
  type OnboardingState,
} from '@open-codesign/shared';
import { ipcMain } from '../electron-runtime';
import { readClaudeCodeSettings } from '../imports/claude-code-config';
import { readCodexConfig } from '../imports/codex-config';
import { readGeminiCliConfig } from '../imports/gemini-cli-config';
import { readOpencodeConfig } from '../imports/opencode-config';
import { getLogger } from '../logger';
import type { ProviderRow } from '../provider-settings';
import type { AppPaths } from '../storage-settings';
import { createWarnOnce } from '../warnOnce';
import { getCachedConfig, toState } from './config-cache';
import {
  runImportClaudeCode,
  runImportCodex,
  runImportGemini,
  runImportOpencode,
} from './external-imports';
import {
  parseAddProviderPayload,
  parseSaveKey,
  parseSetProviderAndModels,
  parseUpdateProviderPayload,
  parseValidateKey,
} from './provider-parsers';
import {
  runAddCustomProvider,
  runAddProvider,
  runDeleteProvider,
  runListEndpointModels,
  runListProviders,
  runSetActiveProvider,
  runSetProviderAndModels,
  runUpdateProvider,
} from './providers-crud';
import { runChooseStorageFolder, runGetPaths, runOpenFolder, runResetOnboarding } from './storage';

const logger = getLogger('settings-ipc');
const warnLegacy = createWarnOnce(logger);

// `ExternalConfigsDetection` and its four `*DetectionMeta` satellites live in
// `packages/shared/src/detection.ts` so the main process and the preload
// facade import one source — see that file's header for the "we were drifting
// silently" background.

export function registerOnboardingIpc(): void {
  ipcMain.handle('onboarding:get-state', (): OnboardingState => toState(getCachedConfig()));

  ipcMain.handle('onboarding:validate-key', async (_e, raw: unknown): Promise<ValidateResult> => {
    const input = parseValidateKey(raw);
    return pingProvider(input.provider, input.apiKey, input.baseUrl);
  });

  ipcMain.handle('onboarding:save-key', async (_e, raw: unknown): Promise<OnboardingState> => {
    // Onboarding always activates the provider it just saved — that's the
    // whole point of the first-time flow. Delegated to the canonical handler
    // so behavior matches Settings exactly.
    return runSetProviderAndModels({ ...parseSaveKey(raw), setAsActive: true });
  });

  ipcMain.handle('onboarding:skip', async (): Promise<OnboardingState> => {
    return toState(getCachedConfig());
  });

  // ── Canonical config mutation (preferred entry point) ─────────────────────

  ipcMain.handle(
    'config:v1:set-provider-and-models',
    async (_e, raw: unknown): Promise<OnboardingState> => {
      return runSetProviderAndModels(parseSetProviderAndModels(raw));
    },
  );

  // ── v3 custom provider IPC surface ────────────────────────────────────────

  ipcMain.handle('config:v1:add-provider', async (_e, raw: unknown): Promise<OnboardingState> => {
    return runAddCustomProvider(parseAddProviderPayload(raw));
  });

  ipcMain.handle(
    'config:v1:update-provider',
    async (_e, raw: unknown): Promise<OnboardingState> => {
      return runUpdateProvider(parseUpdateProviderPayload(raw));
    },
  );

  ipcMain.handle(
    'config:v1:remove-provider',
    async (_e, raw: unknown): Promise<OnboardingState> => {
      if (typeof raw !== 'string' || raw.length === 0) {
        throw new CodesignError(
          'config:v1:remove-provider expects a provider id',
          ERROR_CODES.IPC_BAD_INPUT,
        );
      }
      await runDeleteProvider(raw);
      return toState(getCachedConfig());
    },
  );

  ipcMain.handle(
    'config:v1:set-active-provider-and-model',
    async (_e, raw: unknown): Promise<OnboardingState> => {
      return runSetActiveProvider(raw);
    },
  );

  ipcMain.handle(
    'config:v1:detect-external-configs',
    async (): Promise<ExternalConfigsDetection> => {
      // Log non-ENOENT failures so an unreadable config (EACCES, EISDIR,
      // corrupted file) leaves a diagnostic trail instead of silently
      // degrading into "no config found". The file-not-present case
      // (ENOENT) is the common one and stays noiseless.
      const logDetectFailure = (source: string) => (err: unknown) => {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          logger.warn('detect_external_configs.read_failed', {
            source,
            code: code ?? 'unknown',
            err: err instanceof Error ? err.message : String(err),
          });
        }
        return null;
      };
      const [codex, claudeCode, gemini, opencode] = await Promise.all([
        readCodexConfig().catch(logDetectFailure('codex')),
        readClaudeCodeSettings().catch(logDetectFailure('claude-code')),
        readGeminiCliConfig().catch(logDetectFailure('gemini')),
        readOpencodeConfig().catch(logDetectFailure('opencode')),
      ]);
      const cachedConfig = getCachedConfig();
      const providerIds = Object.keys(cachedConfig?.providers ?? {});
      const alreadyHasCodex = providerIds.some((id) => id.startsWith('codex-'));
      const alreadyHasClaudeCode = providerIds.includes('claude-code-imported');
      const alreadyHasGemini = providerIds.includes('gemini-import');
      const alreadyHasOpencode = providerIds.some((id) => id.startsWith('opencode-'));
      const out: ExternalConfigsDetection = {};
      if (codex !== null && codex.providers.length > 0 && !alreadyHasCodex) {
        // Project to CodexDetectionMeta — strip `apiKeyMap` and `envKeyMap`
        // so plaintext keys never cross the IPC boundary. The import IPC
        // (`config:v1:import-codex-config`) re-reads the file at use time.
        out.codex = {
          providers: codex.providers,
          activeProvider: codex.activeProvider,
          activeModel: codex.activeModel,
          warnings: codex.warnings,
        };
      }
      // Surface Claude Code unless we already imported it. We still surface
      // `oauth-only` users (provider === null) because they need the
      // "subscription can't be shared" banner too — `alreadyHasClaudeCode`
      // is false in that case since no provider entry was ever created.
      if (claudeCode !== null && claudeCode.userType !== 'no-config' && !alreadyHasClaudeCode) {
        out.claudeCode = {
          userType: claudeCode.userType,
          baseUrl: claudeCode.provider?.baseUrl ?? 'https://api.anthropic.com',
          defaultModel:
            claudeCode.provider?.defaultModel ?? claudeCode.activeModel ?? 'claude-sonnet-4-6',
          hasApiKey: claudeCode.apiKey !== null,
          apiKeySource: claudeCode.apiKeySource,
          settingsPath: claudeCode.settingsPath,
          warnings: claudeCode.warnings,
        };
      }
      // Gemini: surface whenever we found either a usable key OR a Vertex AI
      // signal (kind='blocked'). `alreadyHasGemini` gates the regular import
      // path; Vertex users see the banner regardless since their config was
      // already imported by a previous Gemini session — the banner tells
      // them what they need to do manually.
      if (gemini !== null) {
        const blocked = gemini.kind === 'blocked';
        if (!alreadyHasGemini || blocked) {
          out.gemini = {
            hasApiKey: gemini.kind === 'found',
            apiKeySource: gemini.kind === 'found' ? gemini.apiKeySource : 'none',
            keyPath: gemini.kind === 'found' ? gemini.keyPath : null,
            baseUrl:
              gemini.kind === 'found'
                ? gemini.provider.baseUrl
                : 'https://generativelanguage.googleapis.com/v1beta/openai',
            defaultModel:
              gemini.kind === 'found' ? gemini.provider.defaultModel : 'gemini-2.5-flash',
            warnings: gemini.warnings,
            blocked,
          };
        }
      }
      if (opencode !== null && !alreadyHasOpencode) {
        // Surface whenever we found opencode evidence — either (a) there's
        // at least one importable provider (happy path), or (b) auth.json
        // exists but produced no usable entries (corrupt JSON, all OAuth,
        // all unsupported). Case (b) gets a warning-only banner so the
        // user at least sees we detected their setup.
        const blocked = opencode.providers.length === 0;
        if (!blocked || opencode.warnings.length > 0) {
          out.opencode = {
            providers: opencode.providers,
            activeProvider: opencode.activeProvider,
            activeModel: opencode.activeModel,
            warnings: opencode.warnings,
            blocked,
          };
        }
      }
      return out;
    },
  );

  ipcMain.handle('config:v1:import-codex-config', async (): Promise<OnboardingState> => {
    const imported = await readCodexConfig();
    if (imported === null) {
      throw new CodesignError(
        'No Codex config found at ~/.codex/config.toml',
        ERROR_CODES.CONFIG_MISSING,
      );
    }
    return runImportCodex(imported);
  });

  ipcMain.handle('config:v1:import-claude-code-config', async (): Promise<OnboardingState> => {
    const imported = await readClaudeCodeSettings();
    if (imported === null) {
      throw new CodesignError(
        'No Claude Code settings found at ~/.claude/settings.json',
        ERROR_CODES.CONFIG_MISSING,
      );
    }
    // Pass OAuth-only imports through to runImportClaudeCode so it can
    // throw the CLAUDE_CODE_OAUTH_ONLY error. The renderer distinguishes
    // that case and shows the subscription-warning banner — a generic
    // "no config found" swallows the nuance.
    if (imported.provider === null && imported.userType !== 'oauth-only') {
      throw new CodesignError(
        'No Claude Code settings found at ~/.claude/settings.json',
        ERROR_CODES.CONFIG_MISSING,
      );
    }
    return runImportClaudeCode(imported);
  });

  ipcMain.handle('config:v1:import-gemini-config', async (): Promise<OnboardingState> => {
    const imported = await readGeminiCliConfig();
    if (imported === null) {
      throw new CodesignError(
        'No GEMINI_API_KEY found in ~/.gemini/.env, ~/.env, or the shell environment.',
        ERROR_CODES.CONFIG_MISSING,
      );
    }
    return runImportGemini(imported);
  });

  ipcMain.handle('config:v1:import-opencode-config', async (): Promise<OnboardingState> => {
    const imported = await readOpencodeConfig();
    if (imported === null) {
      throw new CodesignError(
        'No OpenCode auth found at ~/.local/share/opencode/auth.json',
        ERROR_CODES.CONFIG_MISSING,
      );
    }
    return runImportOpencode(imported);
  });

  ipcMain.handle('config:v1:list-endpoint-models', async (_e, raw: unknown) => {
    return runListEndpointModels(raw);
  });

  // ── Settings v1 channels ────────────────────────────────────────────────────

  ipcMain.handle(
    'settings:v1:list-providers',
    async (): Promise<ProviderRow[]> => runListProviders(),
  );

  ipcMain.handle(
    'settings:v1:add-provider',
    async (_e, raw: unknown): Promise<ProviderRow[]> => runAddProvider(raw),
  );

  ipcMain.handle(
    'settings:v1:delete-provider',
    async (_e, raw: unknown): Promise<ProviderRow[]> => runDeleteProvider(raw),
  );

  ipcMain.handle(
    'settings:v1:set-active-provider',
    async (_e, raw: unknown): Promise<OnboardingState> => runSetActiveProvider(raw),
  );

  ipcMain.handle('settings:v1:get-paths', async (): Promise<AppPaths> => runGetPaths());

  ipcMain.handle(
    'settings:v1:choose-storage-folder',
    async (_e, raw: unknown): Promise<AppPaths> => runChooseStorageFolder(raw),
  );

  ipcMain.handle(
    'settings:v1:open-folder',
    async (_e, raw: unknown): Promise<void> => runOpenFolder(raw),
  );

  ipcMain.handle('settings:v1:reset-onboarding', async (): Promise<void> => runResetOnboarding());

  ipcMain.handle('settings:v1:toggle-devtools', (_e) => {
    _e.sender.toggleDevTools();
  });

  // ── Settings legacy shims (schedule removal next minor) ────────────────────

  ipcMain.handle('settings:list-providers', async (): Promise<ProviderRow[]> => {
    warnLegacy('legacy.settings.list-providers', 'channel used, schedule removal next minor');
    return runListProviders();
  });

  ipcMain.handle('settings:add-provider', async (_e, raw: unknown): Promise<ProviderRow[]> => {
    warnLegacy('legacy.settings.add-provider', 'channel used, schedule removal next minor');
    return runAddProvider(raw);
  });

  ipcMain.handle('settings:delete-provider', async (_e, raw: unknown): Promise<ProviderRow[]> => {
    warnLegacy('legacy.settings.delete-provider', 'channel used, schedule removal next minor');
    return runDeleteProvider(raw);
  });

  ipcMain.handle(
    'settings:set-active-provider',
    async (_e, raw: unknown): Promise<OnboardingState> => {
      warnLegacy(
        'legacy.settings.set-active-provider',
        'channel used, schedule removal next minor',
      );
      return runSetActiveProvider(raw);
    },
  );

  ipcMain.handle('settings:get-paths', async (): Promise<AppPaths> => {
    warnLegacy('legacy.settings.get-paths', 'channel used, schedule removal next minor');
    return runGetPaths();
  });

  ipcMain.handle('settings:choose-storage-folder', async (_e, raw: unknown): Promise<AppPaths> => {
    warnLegacy(
      'legacy.settings.choose-storage-folder',
      'channel used, schedule removal next minor',
    );
    return runChooseStorageFolder(raw);
  });

  ipcMain.handle('settings:open-folder', async (_e, raw: unknown) => {
    warnLegacy('legacy.settings.open-folder', 'channel used, schedule removal next minor');
    return runOpenFolder(raw);
  });

  ipcMain.handle('settings:reset-onboarding', async (): Promise<void> => {
    warnLegacy('legacy.settings.reset-onboarding', 'channel used, schedule removal next minor');
    return runResetOnboarding();
  });

  ipcMain.handle('settings:toggle-devtools', (_e) => {
    warnLegacy('legacy.settings.toggle-devtools', 'channel used, schedule removal next minor');
    _e.sender.toggleDevTools();
  });
}
