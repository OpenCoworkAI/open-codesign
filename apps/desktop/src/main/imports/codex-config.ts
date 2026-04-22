import { homedir } from 'node:os';
import { join } from 'node:path';
import { type ProviderEntry, type WireApi, detectWireFromBaseUrl } from '@open-codesign/shared';
import { safeReadImportFile } from './safe-read';

/**
 * Path resolution for `~/.codex/config.toml`. Exported for testing.
 */
export function codexConfigPath(home: string = homedir()): string {
  return join(home, '.codex', 'config.toml');
}

export function codexAuthPath(home: string = homedir()): string {
  return join(home, '.codex', 'auth.json');
}

export interface CodexImport {
  providers: ProviderEntry[];
  activeProvider: string | null;
  activeModel: string | null;
  /** Env-key lookups the caller should run to resolve keys. */
  envKeyMap: Record<string, string>; // providerId → envVarName
  /** API keys resolved from Codex auth.json, keyed by imported provider id. */
  apiKeyMap: Record<string, string>;
  warnings: string[];
}

/**
 * Upstream LLM provider env var names we'll honor when Codex's config.toml
 * declares `env_key = "..."`. Without this allowlist, an attacker who can
 * drop `~/.codex/config.toml` (malicious dotfile, shared machine, supply
 * chain) could set `env_key = "AWS_SECRET_ACCESS_KEY"` or `"GITHUB_TOKEN"`
 * and exfiltrate those values on every subsequent LLM call via our env-var
 * fallback path in `onboarding-ipc.ts` (`getApiKeyForProvider`).
 *
 * Codex's own config field is intended to name the upstream provider's
 * API-key env var — not arbitrary process env. Anything outside this list
 * is dropped with a warning.
 */
export const ALLOWED_IMPORT_ENV_KEYS: ReadonlySet<string> = new Set([
  'AI_GATEWAY_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'AZURE_OPENAI_API_KEY',
  'CEREBRAS_API_KEY',
  'DEEPSEEK_API_KEY',
  'FIREWORKS_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'PERPLEXITY_API_KEY',
  'TOGETHER_API_KEY',
  'XAI_API_KEY',
]);

type CodexProviderBlock = {
  name?: string;
  base_url?: string;
  env_key?: string;
  model?: string;
  wire_api?: string;
  requires_openai_auth?: boolean;
  http_headers?: Record<string, string>;
  query_params?: Record<string, string>;
};

const FALLBACK_IMPORTED_MODEL = 'gpt-4o';

/**
 * Parse a Codex `config.toml` string and translate each `[model_providers.X]`
 * block into a v3 `ProviderEntry`. Unknown keys are silently ignored so a
 * future Codex schema bump doesn't break import — the importer degrades to
 * "what we recognise" rather than refusing the whole file.
 */
export async function parseCodexConfig(toml: string): Promise<CodexImport> {
  const warnings: string[] = [];
  let parsed: unknown;
  try {
    const { parse } = await import('smol-toml');
    parsed = parse(toml);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      providers: [],
      activeProvider: null,
      activeModel: null,
      envKeyMap: {},
      apiKeyMap: {},
      warnings: [`Codex config.toml is not valid TOML: ${msg}`],
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      providers: [],
      activeProvider: null,
      activeModel: null,
      envKeyMap: {},
      apiKeyMap: {},
      warnings: ['Codex config.toml has unexpected top-level shape'],
    };
  }

  const root = parsed as Record<string, unknown>;
  const modelProviders = root['model_providers'];
  const activeProviderRaw = root['model_provider'];
  const activeModelRaw = root['model'];
  const activeProviderId =
    typeof activeProviderRaw === 'string' && activeProviderRaw.length > 0
      ? `codex-${activeProviderRaw}`
      : null;
  const activeModel =
    typeof activeModelRaw === 'string' && activeModelRaw.length > 0 ? activeModelRaw : null;
  const providers: ProviderEntry[] = [];
  const envKeyMap: Record<string, string> = {};

  if (modelProviders !== undefined) {
    if (typeof modelProviders !== 'object' || modelProviders === null) {
      warnings.push('Codex [model_providers] is not an object; skipping');
    } else {
      for (const [id, rawBlock] of Object.entries(modelProviders)) {
        if (typeof rawBlock !== 'object' || rawBlock === null || Array.isArray(rawBlock)) continue;
        const block = rawBlock as CodexProviderBlock;
        if (typeof block.base_url !== 'string' || block.base_url.trim().length === 0) {
          warnings.push(`Codex provider "${id}" missing base_url; skipping`);
          continue;
        }
        const wire: WireApi =
          block.wire_api === 'responses'
            ? 'openai-responses'
            : block.wire_api === 'chat'
              ? 'openai-chat'
              : detectWireFromBaseUrl(block.base_url);
        const blockModel = typeof block.model === 'string' ? block.model.trim() : '';
        const activeModelForProvider =
          activeProviderId === `codex-${id}` && activeModel !== null ? activeModel : null;
        const defaultModel = (activeModelForProvider ?? blockModel) || FALLBACK_IMPORTED_MODEL;
        const entry: ProviderEntry = {
          id: `codex-${id}`,
          name: 'Codex (imported)',
          builtin: false,
          wire,
          baseUrl: block.base_url,
          defaultModel,
        };
        if (typeof block.env_key === 'string' && block.env_key.length > 0) {
          if (ALLOWED_IMPORT_ENV_KEYS.has(block.env_key)) {
            entry.envKey = block.env_key;
            envKeyMap[entry.id] = block.env_key;
          } else {
            warnings.push(
              `Codex provider "${id}" references env_key "${block.env_key}" which isn't a known LLM-provider env var — ignoring to prevent arbitrary env-var exfiltration. Edit ~/.codex/config.toml if this is a legitimate new provider.`,
            );
          }
        }
        if (block.requires_openai_auth === true) {
          entry.requiresApiKey = true;
        }
        if (block.http_headers !== undefined && typeof block.http_headers === 'object') {
          const map: Record<string, string> = {};
          for (const [k, v] of Object.entries(block.http_headers)) {
            if (typeof v === 'string') map[k] = v;
          }
          if (Object.keys(map).length > 0) entry.httpHeaders = map;
        }
        if (block.query_params !== undefined && typeof block.query_params === 'object') {
          const map: Record<string, string> = {};
          for (const [k, v] of Object.entries(block.query_params)) {
            if (typeof v === 'string') map[k] = v;
          }
          if (Object.keys(map).length > 0) entry.queryParams = map;
        }
        providers.push(entry);
      }
    }
  }

  // Backfill defaultModel for the active provider so the UI has something to
  // offer by default even if the provider block did not declare a model.
  if (activeProviderId !== null && activeModel !== null) {
    const entry = providers.find((p) => p.id === activeProviderId);
    if (entry !== undefined) entry.defaultModel = activeModel;
  }

  return {
    providers,
    activeProvider: activeProviderId,
    activeModel,
    envKeyMap,
    apiKeyMap: {},
    warnings,
  };
}

async function readCodexOpenAiApiKey(home: string = homedir()): Promise<string | null> {
  const raw = await safeReadImportFile(codexAuthPath(home));
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const rawKey = record['OPENAI_API_KEY'] ?? record['openai_api_key'] ?? record['apiKey'];
  return typeof rawKey === 'string' && rawKey.trim().length > 0 ? rawKey.trim() : null;
}

export async function readCodexConfig(home: string = homedir()): Promise<CodexImport | null> {
  const path = codexConfigPath(home);
  const raw = await safeReadImportFile(path);
  if (raw === null) return null;
  const imported = await parseCodexConfig(raw);
  const openAiApiKey = await readCodexOpenAiApiKey(home);
  if (openAiApiKey === null) return imported;

  const apiKeyMap: Record<string, string> = {};
  for (const provider of imported.providers) {
    if (provider.requiresApiKey === true) {
      apiKeyMap[provider.id] = openAiApiKey;
    }
  }
  return { ...imported, apiKeyMap };
}
