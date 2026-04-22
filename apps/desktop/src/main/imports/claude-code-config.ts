import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ProviderEntry } from '@open-codesign/shared';
import { safeReadImportFile } from './safe-read';

export function claudeCodeSettingsPath(home: string = homedir()): string {
  return join(home, '.claude', 'settings.json');
}

/**
 * Coarse classification of the Claude Code user we just scanned. Drives
 * which banner the Settings UI shows (subscription warning vs. one-click
 * import vs. manual-finish-required) and which import path we take.
 *
 * The app cannot reuse an OAuth subscription — Anthropic binds the token
 * to the Claude Code client, and refreshing it requires that client's
 * embedded OAuth ID. So `oauth-only` is a terminal "please get an API
 * key" state, not a failure we can code around.
 */
export type ClaudeCodeUserType =
  /** settings.json or shell env exposes a real ANTHROPIC_* key we can use. */
  | 'has-api-key'
  /** No key anywhere, and filesystem evidence suggests the user logs in via OAuth. */
  | 'oauth-only'
  /** baseUrl points at localhost — typical Claude Code Proxy / LiteLLM setup. */
  | 'local-proxy'
  /** baseUrl points at a non-anthropic remote endpoint, but no key was found. */
  | 'remote-gateway'
  /** settings.json exists but is malformed (invalid JSON / wrong shape). */
  | 'parse-error'
  /** No settings.json, no OAuth evidence — nothing to offer. */
  | 'no-config';

export interface ClaudeCodeImport {
  provider: ProviderEntry | null;
  apiKey: string | null;
  apiKeySource: 'settings-json' | 'shell-env' | 'none';
  userType: ClaudeCodeUserType;
  hasOAuthEvidence: boolean;
  activeModel: string | null;
  /** Absolute path to the scanned settings.json, resolved against the user's
   *  home directory. Surfaced to the renderer so the parse-error banner can
   *  show/copy a clickable path rather than a tilde-prefixed display form. */
  settingsPath: string;
  warnings: string[];
}

type ClaudeCodeSettings = {
  env?: Record<string, string>;
  apiKeyHelper?: string;
};

export interface ParseClaudeCodeOptions {
  /** Defaults to `process.env`. Tests can inject a stub. */
  env?: NodeJS.ProcessEnv;
  /** Defaults to the result of `checkClaudeCodeOAuthEvidence()`. */
  oauthEvidence?: boolean;
  /** Absolute path to the settings.json that produced `json`. Returned on
   *  the `ClaudeCodeImport` so the renderer can show a copyable absolute
   *  path on the parse-error banner. Defaults to the canonical location. */
  settingsPath?: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

function baseUrlHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function classifyUserType(args: {
  apiKeySource: 'settings-json' | 'shell-env' | 'none';
  baseUrl: string;
  oauthEvidence: boolean;
}): ClaudeCodeUserType {
  if (args.apiKeySource !== 'none') return 'has-api-key';
  const host = baseUrlHost(args.baseUrl);
  if (host !== null && LOCAL_HOSTS.has(host)) return 'local-proxy';
  if (args.oauthEvidence) return 'oauth-only';
  if (host !== null && host !== 'api.anthropic.com') return 'remote-gateway';
  // Default Anthropic endpoint, no key, no OAuth evidence — treat as no-config
  // rather than oauth-only so we don't nag users who happen to have a stray
  // settings.json without a key.
  return 'no-config';
}

/**
 * Sentinel value emitted for the non-object parse-error branch, so the
 * banner can translate it rather than surfacing an English-only blob
 * inside an otherwise-localized template.
 */
export const PARSE_REASON_NOT_JSON_OBJECT = '__parse_reason_not_json_object__';

export function parseClaudeCodeSettings(
  json: string,
  options: ParseClaudeCodeOptions = {},
): ClaudeCodeImport {
  const env = options.env ?? process.env;
  const oauthEvidence = options.oauthEvidence ?? false;
  const settingsPath = options.settingsPath ?? claudeCodeSettingsPath();
  const warnings: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    // Emit the RAW technical reason only — the banner template owns the
    // localized prefix, so concatenating a pre-built English preamble here
    // would produce bilingual mojibake in zh locale.
    const msg = err instanceof Error ? err.message : String(err);
    return {
      provider: null,
      apiKey: null,
      apiKeySource: 'none',
      userType: 'parse-error',
      hasOAuthEvidence: oauthEvidence,
      activeModel: null,
      settingsPath,
      warnings: [msg],
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      provider: null,
      apiKey: null,
      apiKeySource: 'none',
      userType: 'parse-error',
      hasOAuthEvidence: oauthEvidence,
      activeModel: null,
      settingsPath,
      warnings: [PARSE_REASON_NOT_JSON_OBJECT],
    };
  }

  const settings = parsed as ClaudeCodeSettings;
  const settingsEnv = settings.env ?? {};
  const baseUrl = settingsEnv['ANTHROPIC_BASE_URL'] ?? 'https://api.anthropic.com';
  const model = settingsEnv['ANTHROPIC_MODEL'] ?? 'claude-sonnet-4-6';

  // Resolve the API key in priority order: settings.json first (explicit
  // per-project config), shell env second (user exported globally). Note
  // that Electron inherits shell env only when launched from a terminal —
  // GUI launches on macOS will have a sparse process.env.
  let apiKey: string | null = null;
  let apiKeySource: 'settings-json' | 'shell-env' | 'none' = 'none';
  const settingsToken = settingsEnv['ANTHROPIC_AUTH_TOKEN'] ?? settingsEnv['ANTHROPIC_API_KEY'];
  if (typeof settingsToken === 'string' && settingsToken.trim().length > 0) {
    apiKey = settingsToken.trim();
    apiKeySource = 'settings-json';
  } else {
    const shellToken = env['ANTHROPIC_AUTH_TOKEN'] ?? env['ANTHROPIC_API_KEY'];
    if (typeof shellToken === 'string' && shellToken.trim().length > 0) {
      apiKey = shellToken.trim();
      apiKeySource = 'shell-env';
    }
  }

  if (
    apiKey === null &&
    typeof settings.apiKeyHelper === 'string' &&
    settings.apiKeyHelper.length > 0
  ) {
    warnings.push(
      `Claude Code settings.json defines apiKeyHelper ("${settings.apiKeyHelper}"). Open CoDesign does not execute helper scripts — please paste a key manually, or export ANTHROPIC_API_KEY in your shell before launching from terminal.`,
    );
  }

  const userType = classifyUserType({ apiKeySource, baseUrl, oauthEvidence });

  // For oauth-only and no-config we deliberately return provider=null:
  // there's no config worth saving, and callers treat provider===null as
  // "nothing to import" so Settings never seeds a zombie entry. parse-error
  // also returns provider=null via the early-return branches above, with
  // the parse reason in `warnings[0]`.
  if (userType === 'oauth-only') {
    return {
      provider: null,
      apiKey: null,
      apiKeySource: 'none',
      userType,
      hasOAuthEvidence: oauthEvidence,
      activeModel: null,
      settingsPath,
      warnings,
    };
  }
  if (userType === 'no-config') {
    return {
      provider: null,
      apiKey: null,
      apiKeySource: 'none',
      userType,
      hasOAuthEvidence: oauthEvidence,
      activeModel: null,
      settingsPath,
      warnings,
    };
  }

  const provider: ProviderEntry = {
    id: 'claude-code-imported',
    name: 'Claude Code (imported)',
    builtin: false,
    wire: 'anthropic',
    baseUrl,
    defaultModel: model,
    // Always attach the env key hint. Runtime `getApiKeyForProvider` uses
    // it as a last-resort fallback: if the stored secret gets wiped or the
    // user exports the token after import, we still resolve it without a
    // round-trip through onboarding.
    envKey: 'ANTHROPIC_AUTH_TOKEN',
    // Claude Code proxies commonly gate reasoning effort by plan — the
    // consumer-tier endpoint accepts only 'medium'. Seed this default so
    // imports just work; higher-tier users can raise it in Settings →
    // Providers → Reasoning depth.
    reasoningLevel: 'medium',
  };

  if (apiKey === null && userType !== 'local-proxy' && userType !== 'remote-gateway') {
    warnings.push(
      'Claude Code settings.json did not inline ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY — ' +
        'paste the key manually, or export it in your shell and relaunch from terminal.',
    );
  }

  return {
    provider,
    apiKey,
    apiKeySource,
    userType,
    hasOAuthEvidence: oauthEvidence,
    activeModel: model,
    settingsPath,
    warnings,
  };
}

/**
 * Best-effort probe for evidence that the user logs into Claude Code via
 * OAuth. We look at the filesystem only — `security find-generic-password`
 * would cover the macOS Keychain case but invoking shell from the main
 * process for classification feels heavier than the 5% extra accuracy buys.
 * False negatives (OAuth user with neither path present) fall through to
 * `no-config` and see no banner, which is safer than nagging.
 */
export async function checkClaudeCodeOAuthEvidence(home: string = homedir()): Promise<boolean> {
  const candidates = [
    join(home, '.claude', '.credentials.json'),
    join(home, 'Library', 'Application Support', 'Claude'),
  ];
  for (const path of candidates) {
    try {
      await access(path);
      return true;
    } catch {
      /* not present, keep trying */
    }
  }
  return false;
}

export async function readClaudeCodeSettings(
  home: string = homedir(),
): Promise<ClaudeCodeImport | null> {
  const path = claudeCodeSettingsPath(home);
  const oauthEvidence = await checkClaudeCodeOAuthEvidence(home);

  const raw = await safeReadImportFile(path);
  if (raw === null) {
    // settings.json absent or rejected by size/type guard. If OAuth evidence
    // is present, synthesize a minimal ClaudeCodeImport so the Settings
    // banner still offers the subscription-user guidance — otherwise
    // return null and stay silent.
    if (!oauthEvidence) return null;
    return {
      provider: null,
      apiKey: null,
      apiKeySource: 'none',
      userType: 'oauth-only',
      hasOAuthEvidence: true,
      activeModel: null,
      settingsPath: path,
      warnings: [],
    };
  }
  return parseClaudeCodeSettings(raw, { oauthEvidence, settingsPath: path });
}
