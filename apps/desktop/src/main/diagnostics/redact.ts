import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { configPath } from '../config';
import { redactPathsAndUrls, scrubPromptInLine } from '../diagnostic-summary';

/**
 * Matches common API-key shapes we must never leak into bundles or GH issue
 * URLs:
 *    - OpenAI-style `sk-...` tokens
 *    - Google `AIzaSy...` tokens
 *    - AWS `AKIA...` access keys
 *    - Base64-like 43-char values ending in `=` (covers some Azure keys)
 *    - Hex tokens 32+ chars (CI tokens, Azure device codes)
 *    - `Bearer <token>` headers
 */
export const API_KEY_RE =
  /(sk-[A-Za-z0-9-_]{20,}|AIzaSy[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|[A-Za-z0-9+/]{43}=|[a-f0-9]{32,}|Bearer\s+[A-Za-z0-9._~+/=-]+)/g;

/**
 * Replace the user's home directory prefix in a path with `~` so bug reports
 * don't leak the OS account name. Handles both POSIX and Windows separators.
 */
export function aliasHome(p: string): string {
  const home = homedir();
  if (!home) return p;
  if (p === home) return '~';
  if (p.startsWith(`${home}/`)) return `~${p.slice(home.length)}`;
  if (p.startsWith(`${home}\\`)) return `~${p.slice(home.length)}`;
  return p;
}

/**
 * Convert `os.release()` into a user-recognizable marketing name when we can.
 *   - Windows NT build → "Windows 10" / "Windows 11" + the raw build in parens.
 *   - macOS / Linux: leave as-is (Darwin kernel version is what maintainers
 *     are used to, and Linux distro mapping is a rabbit hole).
 */
export function prettyPlatformVersion(platform: NodeJS.Platform, osRelease: string): string {
  if (platform !== 'win32') return osRelease;
  const match = /^10\.0\.(\d+)/.exec(osRelease);
  if (!match) return osRelease;
  const build = Number(match[1]);
  if (build >= 22000) return `Windows 11 (${osRelease})`;
  if (build >= 10240) return `Windows 10 (${osRelease})`;
  return osRelease;
}

/**
 * Apply the user's redaction toggles to free-form text — the same pipeline
 * `summary.md` uses — so fields pre-filled into a GitHub issue URL honor the
 * toggles rather than dumping raw log tails into browser history / referrer.
 */
export function redactForIssueUrl(
  text: string,
  opts: { includePromptText: boolean; includePaths: boolean; includeUrls: boolean },
): string {
  let out = text;
  if (!opts.includePromptText) out = scrubPromptInLine(out);
  out = redactPathsAndUrls(out, {
    includePaths: opts.includePaths,
    includeUrls: opts.includeUrls,
  });
  return out;
}

/** Mask the VALUE of any TOML line whose key looks sensitive, regardless of
 *  the value's format. Google (AIzaSy...), Azure base64, DeepSeek, and future
 *  bearer tokens all slip past format-based regexes. The `ciphertext` field
 *  is this codebase's specific storage slot for persisted secrets (safeStorage
 *  ciphertext, or in migrated/dev paths a literal plaintext token prefixed
 *  `plain:`) — redact unconditionally. `mask` is the user-visible display
 *  form and already pre-obscured, so it's intentionally NOT on this list. */
export function redactSensitiveTomlFields(s: string): string {
  return s.replace(
    /^(\s*(?:api_?key|token|bearer|secret|access_?token|refresh_?token|password|ciphertext|auth_?token|credential)\s*=\s*)"[^"]*"/gim,
    '$1"***REDACTED***"',
  );
}

export async function readConfigRedacted(opts: {
  includePaths: boolean;
  includeUrls: boolean;
}): Promise<string> {
  try {
    const raw = await readFile(configPath(), 'utf8');
    // Strip prompt / history fields first (multi-line values between quotes).
    const noPrompts = raw.replace(/^(prompt|history)\s*=\s*"""[\s\S]*?"""/gm, '');
    // Field-based redaction is the primary defense; format-based redaction is a secondary guard
    // for keys that leak into non-sensitive-looking fields.
    const fieldMasked = redactSensitiveTomlFields(noPrompts);
    const keyMasked = fieldMasked.replace(API_KEY_RE, '***REDACTED***');
    // Paths (baseUrl, designSystem.rootPath, …) and URLs (including ones with
    // embedded credentials) only get omitted if the caller hasn't explicitly
    // opted in. The filename says "redacted" — we must not lie about it.
    return redactPathsAndUrls(keyMasked, opts);
  } catch {
    return '(config not readable)';
  }
}
