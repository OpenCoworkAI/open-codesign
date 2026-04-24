import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ProviderEntry } from '@open-codesign/shared';
import { safeReadImportFile } from './safe-read';

/**
 * One-click import for the Gemini CLI (`github.com/google-gemini/gemini-cli`).
 *
 * Google's ToS explicitly forbids reusing the CLI's OAuth token from third-party
 * apps and threatens account suspension for anyone who does. This importer
 * therefore ONLY handles the static API-key path: the user has set
 * `GEMINI_API_KEY=AIzaSy…` either in `~/.gemini/.env`, `~/.env`, or the shell
 * environment, and we extract it. The encrypted keychain fallback
 * (`~/.gemini/gemini-credentials.json`) is ignored because its encryption key
 * is derived from hostname+username and cannot be read outside the CLI.
 *
 * `settings.json` has no `apiKey` field in the current CLI schema, so we do
 * NOT read it — the field was removed when Google moved to keychain storage.
 *
 * Routing: Google exposes an OpenAI-compatible endpoint at
 * `generativelanguage.googleapis.com/v1beta/openai`, so the imported provider
 * uses `wire: openai-chat` with the key as a Bearer token. That keeps us inside
 * the three wire types the app already supports (no WireApi schema churn).
 */

/** User home → canonical path of the Gemini CLI's user-scope env file. */
export function geminiDotEnvPath(home: string = homedir()): string {
  return join(home, '.gemini', '.env');
}

/** User home → canonical path of the generic user-scope env file. */
export function homeDotEnvPath(home: string = homedir()): string {
  return join(home, '.env');
}

/** OpenAI-compatible Gemini endpoint. `/openai` suffix puts the server into
 *  OpenAI wire-protocol mode; bare `/v1beta` is the native Google protocol,
 *  which we don't speak. */
export const GEMINI_OPENAI_COMPAT_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai';

/** Default model after import. `gemini-2.5-flash` is the cheap/fast default
 *  Google recommends for first-time users; `gemini-2.5-pro` is reachable by
 *  changing the model in Settings. */
export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';

/** Pattern all Google API keys share. Empirically stable: `AIzaSy` prefix +
 *  33 base64url-safe chars = 39 chars total. Used as a soft filter — we
 *  surface a warning when the match fails but still return the raw value
 *  so callers can decide whether to trust it. */
export const GEMINI_API_KEY_PATTERN = /^AIzaSy[A-Za-z0-9_-]{33}$/;

export type GeminiKeySource = 'gemini-env' | 'home-env' | 'shell-env' | 'none';

/** Tagged union over the three states readGeminiCliConfig can produce
 *  (plus `null` at the top level for "no gemini-cli config present at all"):
 *
 *    `found`   — we located an API key and built a ProviderEntry.
 *    `blocked` — we found evidence of Gemini CLI (currently: Vertex AI env
 *                flag) but refuse to import because the key format we'd
 *                need isn't available here. UI should show a warning
 *                banner with no import button.
 *
 *  The previous product-type shape (`provider: X | null` + `apiKey: X | null`
 *  + `apiKeySource` + …) allowed semantically-illegal combinations like
 *  `{provider: entry, apiKey: null}`. The union eliminates those by making
 *  the state transitions explicit. */
export type GeminiImport =
  | {
      kind: 'found';
      provider: ProviderEntry;
      apiKey: string;
      apiKeySource: Exclude<GeminiKeySource, 'none'>;
      /** Absolute path of the .env file that supplied the key, if any —
       *  null only when the key came from the shell env directly. */
      keyPath: string | null;
      warnings: string[];
    }
  | {
      kind: 'blocked';
      warnings: string[];
    };

export interface ReadGeminiCliOptions {
  /** Defaults to `process.env`. Tests inject a stub. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Minimal .env parser. Handles the subset the Gemini CLI itself emits:
 *   - `KEY=value` lines, one per line
 *   - `KEY="value"` / `KEY='value'` with surrounding quotes stripped
 *   - Leading/trailing whitespace on key or value trimmed
 *   - `# comment` lines and blank lines ignored
 *   - Optional `export ` prefix (shells that source the file)
 *
 * Does NOT expand `${OTHER_VAR}` references — the Gemini CLI writes the
 * literal key and no user in practice parameterizes it.
 *
 * `parseDotEnvLines` additionally returns malformed (non-blank, non-comment)
 * lines that were skipped, so callers can warn about `GEMINI_API_KEY value`
 * (space instead of `=`) instead of silently dropping it.
 */
type DotEnvLine =
  | { kind: 'empty' }
  | { kind: 'skip'; raw: string }
  | { kind: 'kv'; key: string; value: string };

function stripSurroundingQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

function parseDotEnvLine(rawLine: string): DotEnvLine {
  const line = rawLine.trim();
  if (line.length === 0) return { kind: 'empty' };
  if (line.startsWith('#')) return { kind: 'empty' };
  const withoutExport = line.startsWith('export ') ? line.slice(7).trimStart() : line;
  const eq = withoutExport.indexOf('=');
  if (eq <= 0) return { kind: 'skip', raw: line };
  const key = withoutExport.slice(0, eq).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return { kind: 'skip', raw: line };
  const value = stripSurroundingQuotes(withoutExport.slice(eq + 1).trim());
  return { kind: 'kv', key, value };
}

export function parseDotEnvLines(content: string): {
  vars: Record<string, string>;
  skipped: string[];
} {
  const vars: Record<string, string> = {};
  const skipped: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const parsed = parseDotEnvLine(rawLine);
    if (parsed.kind === 'kv') vars[parsed.key] = parsed.value;
    else if (parsed.kind === 'skip') skipped.push(parsed.raw);
  }
  return { vars, skipped };
}

export function parseDotEnv(content: string): Record<string, string> {
  return parseDotEnvLines(content).vars;
}

async function readEnvFileIfPresent(
  path: string,
): Promise<{ vars: Record<string, string>; skipped: string[] } | null> {
  const raw = await safeReadImportFile(path);
  if (raw === null) return null;
  return parseDotEnvLines(raw);
}

/** Look through the skipped-lines output of parseDotEnvLines for entries
 *  that the user probably intended as a GEMINI_API_KEY declaration but got
 *  the syntax wrong (e.g. `GEMINI_API_KEY AIzaSy…` with a space instead of
 *  `=`). Returns a human-readable warning or null. */
function suspiciousGeminiLineWarning(path: string, skipped: string[]): string | null {
  for (const line of skipped) {
    if (/^(export\s+)?GEMINI_API_KEY\b/.test(line) && !line.includes('=')) {
      return `${path} has a line that looks like GEMINI_API_KEY but is missing \`=\` — check the syntax (expected \`GEMINI_API_KEY=AIzaSy…\`).`;
    }
  }
  return null;
}

/**
 * Resolve `GEMINI_API_KEY` in the same order the CLI itself does:
 *   1. `~/.gemini/.env`        (CLI-scoped)
 *   2. `~/.env`                (generic user-scope)
 *   3. process.env             (shell export)
 *
 * We intentionally skip the per-project bubble-up (`./.gemini/.env` walked up
 * to filesystem root) because this importer runs inside an Electron main
 * process without a meaningful CWD — reproducing the walk would read arbitrary
 * files from wherever the app happened to be launched.
 *
 * Vertex AI detection: when `GOOGLE_GENAI_USE_VERTEXAI` is set in the shell,
 * the user is configured for Vertex and the key (if any) is a service-account
 * JSON path, not an `AIzaSy…` string. We surface a warning and return null so
 * the caller can show a helpful "configure Vertex manually" message instead
 * of silently failing on a bogus provider entry.
 */
/** Matches the gemini-cli's own truthiness semantics for
 *  `GOOGLE_GENAI_USE_VERTEXAI`: any of true/1/yes/on in any case counts. */
const VERTEX_TRUTHY = new Set(['true', '1', 'yes', 'on']);

function checkVertexAiBlocked(env: NodeJS.ProcessEnv): GeminiImport | null {
  const vertexFlag = env['GOOGLE_GENAI_USE_VERTEXAI']?.trim().toLowerCase();
  if (vertexFlag === undefined || !VERTEX_TRUTHY.has(vertexFlag)) return null;
  return {
    kind: 'blocked',
    warnings: [
      "Google Vertex AI projects aren't supported yet — paste a Gemini Developer API key (starts with AIzaSy…) to use Gemini here.",
    ],
  };
}

type EnvFileKeyProbe =
  | { kind: 'found'; apiKey: string }
  | { kind: 'suspicious'; warning: string }
  | { kind: 'absent' };

/** Read one .env file and probe for a usable GEMINI_API_KEY. Returns
 *  `absent` when the file itself doesn't exist. Quiet `absent` when the
 *  file is present but has no GEMINI_API_KEY and no suspicious near-miss
 *  line (so the caller keeps walking the lookup chain). */
async function probeGeminiKeyInEnvFile(path: string): Promise<EnvFileKeyProbe> {
  const envFile = await readEnvFileIfPresent(path);
  if (envFile === null) return { kind: 'absent' };
  const raw = envFile.vars['GEMINI_API_KEY'];
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return { kind: 'found', apiKey: raw.trim() };
  }
  const warning = suspiciousGeminiLineWarning(path, envFile.skipped);
  if (warning !== null) return { kind: 'suspicious', warning };
  return { kind: 'absent' };
}

type Resolved = {
  apiKey: string;
  apiKeySource: Exclude<GeminiKeySource, 'none'>;
  keyPath: string | null;
};

/** Walk the three lookup locations — ~/.gemini/.env, ~/.env, shell env —
 *  in priority order and return the first usable key plus any near-miss
 *  warnings gathered along the way. */
async function resolveGeminiKey(
  home: string,
  env: NodeJS.ProcessEnv,
): Promise<{ resolved: Resolved | null; earlyWarnings: string[] }> {
  const earlyWarnings: string[] = [];
  const sources: Array<{
    source: Exclude<GeminiKeySource, 'none' | 'shell-env'>;
    path: string;
  }> = [
    { source: 'gemini-env', path: geminiDotEnvPath(home) },
    { source: 'home-env', path: homeDotEnvPath(home) },
  ];
  for (const { source, path } of sources) {
    const probe = await probeGeminiKeyInEnvFile(path);
    if (probe.kind === 'found') {
      return {
        resolved: { apiKey: probe.apiKey, apiKeySource: source, keyPath: path },
        earlyWarnings,
      };
    }
    if (probe.kind === 'suspicious') earlyWarnings.push(probe.warning);
  }
  const shellKey = env['GEMINI_API_KEY'];
  if (typeof shellKey === 'string' && shellKey.trim().length > 0) {
    return {
      resolved: { apiKey: shellKey.trim(), apiKeySource: 'shell-env', keyPath: null },
      earlyWarnings,
    };
  }
  return { resolved: null, earlyWarnings };
}

export async function readGeminiCliConfig(
  home: string = homedir(),
  options: ReadGeminiCliOptions = {},
): Promise<GeminiImport | null> {
  const env = options.env ?? process.env;

  const blocked = checkVertexAiBlocked(env);
  if (blocked !== null) return blocked;

  const { resolved, earlyWarnings } = await resolveGeminiKey(home, env);
  if (resolved === null) {
    // Not null if we flagged a malformed line — surface that instead of
    // a completely silent "nothing to import."
    if (earlyWarnings.length > 0) {
      return { kind: 'blocked', warnings: earlyWarnings };
    }
    return null;
  }

  const warnings: string[] = [...earlyWarnings];
  if (!GEMINI_API_KEY_PATTERN.test(resolved.apiKey)) {
    warnings.push(
      `GEMINI_API_KEY does not match the expected format (AIzaSy + 33 chars). Found at ${resolved.keyPath ?? 'shell env'}. The import will proceed but the key may be rejected at validation.`,
    );
  }

  const provider: ProviderEntry = {
    id: 'gemini-import',
    name: 'Gemini (imported)',
    builtin: false,
    wire: 'openai-chat',
    baseUrl: GEMINI_OPENAI_COMPAT_BASE_URL,
    defaultModel: GEMINI_DEFAULT_MODEL,
    envKey: 'GEMINI_API_KEY',
  };

  return {
    kind: 'found',
    provider,
    apiKey: resolved.apiKey,
    apiKeySource: resolved.apiKeySource,
    keyPath: resolved.keyPath,
    warnings,
  };
}
