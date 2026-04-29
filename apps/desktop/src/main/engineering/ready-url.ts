/**
 * Best-effort ready-URL detector for dev server stdout.
 *
 * Vite, Next, CRA, Remix, Rsbuild and friends all emit a localhost URL on
 * the first ready line. We do not try to be exhaustive — we just match the
 * first http(s)://...:port[/path] substring in any of the well-known leading
 * tokens, with fallback to a bare URL match when nothing matches the labels.
 *
 * The strict regex stays first so noisy startup banners (which often print
 * unrelated URLs in an "About" or telemetry footer) do not race the real
 * ready signal.
 */

const LABELED_RE =
  /(?:Local|local|ready|Ready|listening on|started server on|→\s*Local)[^\n]*?(https?:\/\/[^\s)]+)/;
const BARE_URL_RE = /(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/[^\s)]*)?)/;

/** Returns the first ready URL detected in `chunk`, or null. The chunk may
 *  be a single line or multiple lines glued together — the regex anchors are
 *  lax on purpose so partial buffering does not lose the signal. */
export function extractReadyUrl(chunk: string): string | null {
  if (chunk === '') return null;
  // Strip ANSI escape codes (FORCE_COLOR=0 helps but does not catch every
  // dev server). \u001B is the ESC literal.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI stripping requires the ESC literal.
  const stripped = chunk.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '');
  const labeled = stripped.match(LABELED_RE);
  if (labeled?.[1]) return normalize(labeled[1]);
  const bare = stripped.match(BARE_URL_RE);
  if (bare?.[1]) return normalize(bare[1]);
  return null;
}

function normalize(url: string): string {
  // Dev servers occasionally tack a trailing slash, comma, or punctuation on.
  return url.replace(/[),.;]+$/, '');
}
