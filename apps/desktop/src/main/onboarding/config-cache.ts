import {
  CodesignError,
  type Config,
  ERROR_CODES,
  hydrateConfig,
  type OnboardingState,
  StoredDesignSystem,
  type StoredDesignSystem as StoredDesignSystemValue,
} from '@open-codesign/shared';
import { readConfig, writeConfig } from '../config';
import { ALLOWED_IMPORT_ENV_KEYS } from '../imports/codex-config';
import { decryptSecret, migrateSecrets } from '../keychain';
import { getLogger } from '../logger';
import { isKeylessProviderAllowed } from '../provider-settings';

const logger = getLogger('settings-ipc');

let cachedConfig: Config | null = null;
let configLoaded = false;

export async function loadConfigOnBoot(): Promise<void> {
  const parsed = await readConfig();
  configLoaded = true;
  if (parsed === null) {
    cachedConfig = null;
    return;
  }
  // Boot-time migration: rewrite any legacy safeStorage-encrypted secrets
  // as plaintext, and fill in missing display masks. This is the ONLY path
  // that can trigger a keychain prompt (and only on an upgrade from an
  // older build that still used safeStorage). After one successful run the
  // config is pure plaintext forever.
  const migrated = migrateSecrets(parsed);
  cachedConfig = migrated.config;
  if (migrated.changed) {
    try {
      await writeConfig(migrated.config);
    } catch (err) {
      logger.warn('boot.migrate_secrets.writeConfig_failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Overwrite the cached config reference. For use by sibling IPC modules (e.g.
 * `codex-oauth-ipc`) that mutate `config.providers` via their own write path
 * and need `getCachedConfig` / `toState` to reflect the change immediately.
 * Callers are responsible for having already persisted `next` to disk.
 */
export function setCachedConfig(next: Config): void {
  cachedConfig = next;
  configLoaded = true;
}

export function getCachedConfig(): Config | null {
  if (!configLoaded) {
    throw new CodesignError(
      'getCachedConfig called before loadConfigOnBoot',
      ERROR_CODES.CONFIG_NOT_LOADED,
    );
  }
  return cachedConfig;
}

export function getApiKeyForProvider(provider: string): string {
  const cfg = getCachedConfig();
  if (cfg === null) {
    throw new CodesignError(
      'No configuration found. Complete onboarding first.',
      ERROR_CODES.CONFIG_MISSING,
    );
  }
  const ref = cfg.secrets[provider as keyof typeof cfg.secrets];
  if (ref !== undefined) return decryptSecret(ref.ciphertext);

  // Fallback: if the provider entry declares an envKey (e.g. imported
  // Claude Code providers always declare ANTHROPIC_AUTH_TOKEN), resolve
  // the key from the process environment. This rescues two cases that
  // would otherwise be dead ends:
  //   1. User exported ANTHROPIC_API_KEY in their shell and launched
  //      from a terminal — the env is inherited but our onboarding never
  //      called `encryptSecret`, so cfg.secrets[provider] is empty.
  //   2. User deleted the persisted key from Settings but the env var is
  //      still present. Treat it as a valid credential rather than
  //      throwing a misleading "key missing" error.
  const entry = cfg.providers[provider];
  if (entry?.envKey !== undefined) {
    // Defense in depth against legacy configs: Codex's config.toml env_key
    // field is now allowlisted at import time, but older configs may have
    // stored arbitrary env-var names (pre-allowlist). Re-check here so a
    // stale `envKey: "AWS_SECRET_ACCESS_KEY"` can't still exfiltrate on
    // every LLM call.
    if (!ALLOWED_IMPORT_ENV_KEYS.has(entry.envKey)) {
      logger.warn('get_api_key.envKey_blocked', {
        provider,
        envKey: entry.envKey,
      });
    } else {
      const fromEnv = process.env[entry.envKey]?.trim();
      if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
    }
  }

  throw new CodesignError(
    `No API key stored for provider "${provider}". Re-run onboarding to add one.`,
    ERROR_CODES.PROVIDER_KEY_MISSING,
  );
}

export function getBaseUrlForProvider(provider: string): string | undefined {
  const cfg = getCachedConfig();
  if (cfg === null) return undefined;
  return cfg.providers[provider]?.baseUrl;
}

export function toState(cfg: Config | null): OnboardingState {
  if (cfg === null) {
    return {
      hasKey: false,
      provider: null,
      modelPrimary: null,
      baseUrl: null,
      designSystem: null,
    };
  }
  const active = cfg.activeProvider;
  const ref = cfg.secrets[active];
  if (ref === undefined && !isKeylessProviderAllowed(active, cfg.providers[active])) {
    return {
      hasKey: false,
      provider: active,
      modelPrimary: null,
      baseUrl: null,
      designSystem: cfg.designSystem ?? null,
    };
  }
  return {
    hasKey: true,
    provider: active,
    modelPrimary: cfg.activeModel,
    baseUrl: cfg.providers[active]?.baseUrl ?? null,
    designSystem: cfg.designSystem ?? null,
  };
}

export function getOnboardingState(): OnboardingState {
  return toState(getCachedConfig());
}

export async function setDesignSystem(
  designSystem: StoredDesignSystemValue | null,
): Promise<OnboardingState> {
  const cfg = getCachedConfig();
  if (cfg === null) {
    throw new CodesignError(
      'Cannot save a design system before onboarding has completed.',
      ERROR_CODES.CONFIG_MISSING,
    );
  }
  const next: Config = hydrateConfig({
    version: 3,
    activeProvider: cfg.activeProvider,
    activeModel: cfg.activeModel,
    secrets: cfg.secrets,
    providers: cfg.providers,
    ...(designSystem !== null ? { designSystem: StoredDesignSystem.parse(designSystem) } : {}),
  });
  await writeConfig(next);
  setCachedConfig(next);
  return toState(next);
}
