/**
 * Pure URL validation for the `codesign:v1:open-external` IPC.
 *
 * The renderer is only allowed to open two kinds of URLs on the GitHub repo:
 *   - `/releases/...`  — update banner → release notes
 *   - `/issues/...`    — Report flow → prefilled bug issue
 *
 * Local preview controls may also open explicit loopback HTTP(S) URLs. Those
 * URLs are configured or detected by the user and only opened from direct UI
 * actions, so remote hosts and non-HTTP schemes still stay out of scope.
 *
 * Anything else (different host, different repo, different path) is rejected
 * so a compromised renderer can't coerce the main process into opening an
 * attacker-controlled URL via `shell.openExternal`.
 */

const GITHUB_OWNER = 'OpenCoworkAI';
const GITHUB_REPO = 'open-codesign';
const ALLOWED_HOST = 'github.com';
const ALLOWED_PATHS = [
  `/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
  `/${GITHUB_OWNER}/${GITHUB_REPO}/issues`,
];
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isAllowedLoopbackUrl(parsed: URL): boolean {
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const hostname = parsed.hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(hostname) || hostname.endsWith('.localhost');
}

export function isAllowedExternalUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (isAllowedLoopbackUrl(parsed)) return true;
  if (parsed.protocol !== 'https:') return false;
  if (parsed.hostname !== ALLOWED_HOST) return false;
  return ALLOWED_PATHS.some((p) => parsed.pathname === p || parsed.pathname.startsWith(`${p}/`));
}
