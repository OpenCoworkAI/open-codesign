import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ProviderEntry, WireApi } from '@open-codesign/shared';
import { safeReadImportFile } from './safe-read';

/**
 * One-click import for the OpenCode CLI (`github.com/sst/opencode`).
 *
 * Schema was verified against upstream `sst/opencode`:
 *   - `packages/opencode/src/auth/index.ts` defines an Effect.Schema discriminated
 *     union written to `<Global.Path.data>/auth.json`: each top-level key is a
 *     provider ID (e.g. "anthropic", "openai", "google", "openrouter") and the
 *     value is `{type: "api", key, metadata?}` | `{type: "oauth", refresh, access,
 *     expires, ...}` | `{type: "wellknown", key, token}`. The file is written
 *     plaintext with mode 0600.
 *   - `packages/opencode/src/global/index.ts` resolves `Global.Path.data` via
 *     `xdg-basedir`. In that package (`github.com/sindresorhus/xdg-basedir`),
 *     `xdgData = XDG_DATA_HOME || ~/.local/share` on every platform, including
 *     macOS and Windows. OpenCode does NOT switch to `~/Library/Application
 *     Support` on macOS or `%APPDATA%` on Windows.
 *   - `packages/opencode/src/config/config.ts` loads `opencode.jsonc` →
 *     `opencode.json` → `config.json` from `xdgConfig/opencode/` and exposes a
 *     `model: "provider/model"` string. That's the closest thing to a persisted
 *     "active model" — there is no `activeProvider` field; the provider is the
 *     slash-prefix of `model`.
 *
 * We import only `type: "api"` entries. OAuth and wellknown are skipped with a
 * warning — reusing them without the CLI's session tracker risks a refresh race
 * with the user's OpenCode session.
 */

interface ProviderMapping {
  wire: WireApi;
  baseUrl: string;
  defaultModel: string;
  /** Display name used in the Settings list — "OpenCode · Anthropic" etc. */
  label: string;
  /** Upstream env var the provider's native CLI honors. Kept as import
   *  metadata; runtime credential resolution requires a persisted secret or an
   *  explicit keyless provider. */
  envKey: string;
}

const PROVIDER_MAP = {
  anthropic: {
    wire: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-6',
    label: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
  },
  openai: {
    wire: 'openai-chat',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    label: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
  },
  google: {
    wire: 'openai-chat',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    label: 'Google',
    envKey: 'GEMINI_API_KEY',
  },
  openrouter: {
    wire: 'openai-chat',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-4.6',
    label: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
  },
  mistral: {
    wire: 'openai-chat',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    label: 'Mistral',
    envKey: 'MISTRAL_API_KEY',
  },
  groq: {
    wire: 'openai-chat',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    label: 'Groq',
    envKey: 'GROQ_API_KEY',
  },
  deepseek: {
    wire: 'openai-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    label: 'DeepSeek',
    envKey: 'DEEPSEEK_API_KEY',
  },
  xai: {
    wire: 'openai-chat',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-2',
    label: 'xAI',
    envKey: 'XAI_API_KEY',
  },
  together: {
    wire: 'openai-chat',
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    label: 'Together',
    envKey: 'TOGETHER_API_KEY',
  },
  fireworks: {
    wire: 'openai-chat',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    label: 'Fireworks',
    envKey: 'FIREWORKS_API_KEY',
  },
  cerebras: {
    wire: 'openai-chat',
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'llama-3.3-70b',
    label: 'Cerebras',
    envKey: 'CEREBRAS_API_KEY',
  },
  'vercel-ai-gateway': {
    wire: 'openai-chat',
    baseUrl: 'https://gateway.ai.vercel.app/v1',
    defaultModel: 'openai/gpt-4o',
    label: 'Vercel AI Gateway',
    envKey: 'AI_GATEWAY_API_KEY',
  },
} as const satisfies Record<string, ProviderMapping>;

/** Derived from `PROVIDER_MAP` so the union and the map can never drift.
 *  Adding a new provider means exactly one edit in one place. */
type OpencodeProviderKey = keyof typeof PROVIDER_MAP;

function opencodeDataDir(home: string, env: NodeJS.ProcessEnv): string {
  const xdgData = env['XDG_DATA_HOME'];
  if (typeof xdgData === 'string' && xdgData.length > 0) return join(xdgData, 'opencode');
  return join(home, '.local', 'share', 'opencode');
}

function opencodeConfigDir(home: string, env: NodeJS.ProcessEnv): string {
  const xdgConfig = env['XDG_CONFIG_HOME'];
  if (typeof xdgConfig === 'string' && xdgConfig.length > 0) return join(xdgConfig, 'opencode');
  return join(home, '.config', 'opencode');
}

export function opencodeAuthPath(
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(opencodeDataDir(home, env), 'auth.json');
}

export function opencodeConfigCandidatePaths(
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const dir = opencodeConfigDir(home, env);
  return [join(dir, 'opencode.jsonc'), join(dir, 'opencode.json'), join(dir, 'config.json')];
}

export interface OpencodeImport {
  providers: ProviderEntry[];
  apiKeyMap: Record<string, string>;
  activeProvider: string | null;
  activeModel: string | null;
  warnings: string[];
}

/** Discriminated union for the known shapes of opencode `auth.json` entries.
 *  The final arm catches any future `type` strings opencode might add so we
 *  can narrow-and-warn rather than silently dropping them as "unknown". All
 *  arms carry an optional `key` since TS can't narrow `string` literal from
 *  the wide `string` branch on a negative check like `type !== 'api'`. */
type AuthEntry =
  | { type: 'api'; key?: unknown; metadata?: unknown }
  | { type: 'oauth'; refresh?: unknown; access?: unknown; expires?: unknown; key?: unknown }
  | { type: 'wellknown'; key?: unknown; token?: unknown }
  | { type: string; key?: unknown };

function isKnownProvider(id: string): id is OpencodeProviderKey {
  return Object.hasOwn(PROVIDER_MAP, id);
}

async function readAuthJson(path: string): Promise<{
  raw: Record<string, unknown> | null;
  warning: string | null;
}> {
  const text = await safeReadImportFile(path);
  if (text === null) return { raw: null, warning: null };
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { raw: null, warning: `OpenCode auth.json has unexpected top-level shape at ${path}` };
    }
    return { raw: parsed as Record<string, unknown>, warning: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { raw: null, warning: `OpenCode auth.json is not valid JSON: ${msg}` };
  }
}

/** Advance past a `// ... \n` line comment. Returns the new cursor, which
 *  lands on the newline (or at EOF) so the outer loop picks it back up. */
function skipLineComment(input: string, start: number): number {
  let i = start;
  while (i < input.length && input[i] !== '\n') i += 1;
  return i;
}

/** Advance past a `/* ... *\/` block comment. Returns the cursor positioned
 *  after the closing `*\/`. */
function skipBlockComment(input: string, start: number): number {
  let i = start + 2;
  while (i < input.length - 1 && !(input[i] === '*' && input[i + 1] === '/')) i += 1;
  return i + 2;
}

/** Copy one string literal (opened at `start` with quote `quote`) into `out`
 *  and return the cursor positioned after the closing quote. Preserves
 *  backslash-escapes so `"foo\"bar"` parses correctly. */
function copyString(input: string, start: number, quote: string, out: string[]): number {
  out.push(input.charAt(start));
  let i = start + 1;
  while (i < input.length) {
    const ch = input.charAt(i);
    out.push(ch);
    if (ch === '\\' && i + 1 < input.length) {
      out.push(input.charAt(i + 1));
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i += 1;
  }
  return i;
}

/** Strip `//` and `/* ... *\/` comments so `opencode.jsonc` can be parsed as
 *  JSON. Good enough for the narrow case where we only read one string field;
 *  we intentionally don't pull in a jsonc dep. Exported for direct testing. */
export function stripJsonComments(input: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input.charAt(i);
    const next = input.charAt(i + 1);
    if (ch === '"' || ch === "'") {
      i = copyString(input, i, ch, out);
      continue;
    }
    if (ch === '/' && next === '/') {
      i = skipLineComment(input, i);
      continue;
    }
    if (ch === '/' && next === '*') {
      i = skipBlockComment(input, i);
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out.join('');
}

function extractModelField(path: string, parsed: unknown, warnings: string[]): string | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    warnings.push(`Could not read active OpenCode model from ${path}: expected an object`);
    return null;
  }
  const model = (parsed as Record<string, unknown>)['model'];
  if (model === undefined) return null;
  if (typeof model !== 'string' || model.trim().length === 0) {
    warnings.push(`Could not read active OpenCode model from ${path}: model must be a string`);
    return null;
  }
  return model.trim();
}

/** Parse the text of a single opencode config candidate and extract `model`.
 *  `first` means "the lookup chain stops here" — either we found a usable
 *  config file (so later candidates don't shadow it) or we hit a parse error
 *  and already surfaced a warning. `null`/`continue` means "keep looking." */
function parseConfigCandidate(
  path: string,
  text: string,
  warnings: string[],
): { first: string | null } {
  try {
    const parsed: unknown = JSON.parse(path.endsWith('.jsonc') ? stripJsonComments(text) : text);
    return { first: extractModelField(path, parsed, warnings) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`Could not parse ${path}: ${msg}`);
    return { first: null };
  }
}

async function readActiveModelFromConfig(
  home: string,
  env: NodeJS.ProcessEnv,
  warnings: string[],
): Promise<string | null> {
  for (const path of opencodeConfigCandidatePaths(home, env)) {
    const text = await safeReadImportFile(path);
    if (text === null) continue;
    return parseConfigCandidate(path, text, warnings).first;
  }
  return null;
}

type ParsedAuthEntry =
  | { kind: 'skip'; warning: string }
  | { kind: 'provider'; provider: ProviderEntry; apiKey: string };

/** Classify one entry from opencode's auth.json. Returns a ProviderEntry
 *  we can append, or a warning explaining why this one didn't import. */
function parseAuthBlock(providerId: string, entry: unknown): ParsedAuthEntry {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return {
      kind: 'skip',
      warning: `OpenCode provider "${providerId}" has an invalid entry shape; skipping`,
    };
  }
  const auth = entry as AuthEntry;
  if (auth.type === 'oauth') {
    return {
      kind: 'skip',
      warning: `OpenCode provider "${providerId}" uses OAuth and can't be imported. Log in with an API key in OpenCode, or paste one manually here.`,
    };
  }
  if (auth.type === 'wellknown') {
    return {
      kind: 'skip',
      warning: `OpenCode provider "${providerId}" uses a well-known two-token auth scheme that can't be reused outside the CLI; skipping.`,
    };
  }
  if (auth.type !== 'api') {
    return {
      kind: 'skip',
      warning: `OpenCode provider "${providerId}" has unknown auth type "${String(auth.type)}"; skipping`,
    };
  }
  if (typeof auth.key !== 'string' || auth.key.trim().length === 0) {
    return {
      kind: 'skip',
      warning: `OpenCode provider "${providerId}" has no API key; skipping`,
    };
  }
  if (!isKnownProvider(providerId)) {
    return {
      kind: 'skip',
      warning: `OpenCode provider "${providerId}" isn't supported yet — add it as a custom provider.`,
    };
  }
  const mapping = PROVIDER_MAP[providerId];
  const importedId = `opencode-${providerId}`;
  return {
    kind: 'provider',
    provider: {
      id: importedId,
      name: `OpenCode · ${mapping.label}`,
      builtin: false,
      wire: mapping.wire,
      baseUrl: mapping.baseUrl,
      defaultModel: mapping.defaultModel,
      envKey: mapping.envKey,
    },
    apiKey: auth.key.trim(),
  };
}

function collectProvidersFromAuthJson(
  raw: Record<string, unknown>,
  warnings: string[],
): { providers: ProviderEntry[]; apiKeyMap: Record<string, string> } {
  const providers: ProviderEntry[] = [];
  const apiKeyMap: Record<string, string> = {};
  for (const [providerId, entry] of Object.entries(raw)) {
    const parsed = parseAuthBlock(providerId, entry);
    if (parsed.kind === 'skip') {
      warnings.push(parsed.warning);
      continue;
    }
    providers.push(parsed.provider);
    apiKeyMap[parsed.provider.id] = parsed.apiKey;
  }
  return { providers, apiKeyMap };
}

/** Split opencode's `model: "provider/model"` string, matching it against
 *  imported providers. Mutates the matched provider's defaultModel to the
 *  model-suffix so the UI starts on the same model OpenCode last used. */
function resolveActiveSelection(
  providers: ProviderEntry[],
  rawActiveModel: string | null,
  warnings: string[],
): { activeProvider: string | null; activeModel: string | null } {
  if (rawActiveModel === null) return { activeProvider: null, activeModel: null };
  const slash = rawActiveModel.indexOf('/');
  if (slash <= 0 || slash >= rawActiveModel.length - 1) {
    warnings.push(`OpenCode active model "${rawActiveModel}" must use provider/model format`);
    return { activeProvider: null, activeModel: null };
  }
  const providerPart = rawActiveModel.slice(0, slash);
  const modelPart = rawActiveModel.slice(slash + 1);
  const candidateId = `opencode-${providerPart}`;
  const entry = providers.find((p) => p.id === candidateId);
  if (entry === undefined) {
    warnings.push(
      `OpenCode active model "${rawActiveModel}" references provider "${providerPart}", but that provider was not imported`,
    );
    return { activeProvider: null, activeModel: null };
  }
  entry.defaultModel = modelPart;
  return { activeProvider: candidateId, activeModel: modelPart };
}

export async function readOpencodeConfig(
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<OpencodeImport | null> {
  const authPath = opencodeAuthPath(home, env);
  const { raw, warning } = await readAuthJson(authPath);
  if (raw === null && warning === null) return null;

  const warnings: string[] = [];
  if (warning !== null) warnings.push(warning);

  const { providers, apiKeyMap } =
    raw !== null ? collectProvidersFromAuthJson(raw, warnings) : { providers: [], apiKeyMap: {} };

  const rawActiveModel = await readActiveModelFromConfig(home, env, warnings);
  const { activeProvider, activeModel } = resolveActiveSelection(
    providers,
    rawActiveModel,
    warnings,
  );

  return {
    providers,
    apiKeyMap,
    activeProvider,
    activeModel,
    warnings,
  };
}
