/**
 * Fingerprint — a short stable hash identifying "the same bug" across runs.
 *
 * Used by the diagnostic event store (and PR4's "You reported this
 * yesterday" dedup prompt) to group recurring errors without over-merging
 * superficially similar but genuinely distinct failures.
 *
 * Design:
 *   fingerprint = stable8hex(errorCode + "|" + top-3-normalized-stack-frames)
 *
 * Normalized stack frame:
 *   - strip absolute paths (keep basename only)
 *   - strip line/column numbers
 *   - strip node_modules/.pnpm/PKG@VER noise
 *   - keep function/method name + short file name
 *   - ignore frames without identifiable code ("<anonymous>", "internal/")
 *
 * We hash the code + top-3 frames rather than the whole stack because
 *   - top-3 is where the bug actually lives; deeper frames are scaffolding
 *   - different message text for the same bug (user names, ids, etc.) shouldn't
 *     fork the fingerprint
 *   - short hash keeps it greppable in GitHub issue titles
 *
 * This implementation deliberately avoids `node:crypto` so the shared package
 * can be bundled into both Electron main and renderer targets. Cryptographic
 * strength is unnecessary here; we only need a stable low-collision bucket key.
 */

export interface FingerprintInput {
  errorCode: string;
  stack: string | undefined;
  /** Used as a secondary signal when stack is empty, to avoid collapsing
      all stack-less errors to the same fingerprint. */
  message?: string;
}

export function computeFingerprint(input: FingerprintInput): string {
  const frames = extractTopFrames(input.stack, 3).map(normalizeFrame);
  const basis =
    frames.length > 0
      ? `${input.errorCode}|${frames.join('\n')}`
      : `${input.errorCode}|msg:${input.message ?? ''}`;
  return hash32Hex(basis);
}

function hash32Hex(value: string): string {
  // FNV-1a 32-bit: tiny, deterministic, and available in every JS runtime.
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function extractTopFrames(stack: string | undefined, limit: number): string[] {
  if (typeof stack !== 'string' || stack.length === 0) return [];
  const lines = stack.split('\n');
  const frames: string[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('at ')) continue;
    if (isNoiseFrame(trimmed)) continue;
    frames.push(trimmed);
    if (frames.length >= limit) break;
  }
  return frames;
}

function isNoiseFrame(frame: string): boolean {
  return (
    frame.includes('<anonymous>') ||
    frame.includes('internal/') ||
    frame.includes('node:internal') ||
    /node_modules[\\/]\.pnpm[\\/]vitest/.test(frame) ||
    /node_modules[\\/]\.pnpm[\\/]@vitest/.test(frame)
  );
}

export function normalizeFrame(frame: string): string {
  // Drop trailing "(path:line:col)" — keep function name only when available.
  // Examples we want to normalize:
  //   at generate (/Users/x/code/pkg/src/index.ts:482:11)
  //     -> at generate (index.ts)
  //   at Object.<anonymous> (/Users/x/foo.js:1:1)
  //     -> at Object (foo.js)
  //   at /Users/x/foo.js:1:1
  //     -> at foo.js
  //   at ProviderCard (Settings.tsx?t=1776846744402)
  //     -> at ProviderCard (Settings.tsx)  (Vite's HMR cache-buster stripped)
  const withoutLineCol = stripTrailingLineColumn(frame);
  const withParenReplaced = replaceParenPathWithBasename(withoutLineCol);
  // Paren-less `at /path/to/file.js` (V8 emits this for top-level frames).
  // Keep basename only so absolute paths never escape the fingerprint input
  // or the rendered stack block. Also strip any `?query` on the basename.
  if (isParenlessPathFrame(withParenReplaced)) {
    return `at ${basenameWithoutQuery(withParenReplaced.trim().slice(3).trim())}`;
  }
  return withParenReplaced;
}

function stripTrailingLineColumn(frame: string): string {
  let out = frame;
  const hadParen = out.endsWith(')');
  if (hadParen) out = out.slice(0, -1);
  for (let count = 0; count < 2; count += 1) {
    const colon = out.lastIndexOf(':');
    if (colon < 0) break;
    const tail = out.slice(colon + 1);
    if (!tail || [...tail].some((ch) => ch < '0' || ch > '9')) break;
    out = out.slice(0, colon);
  }
  return hadParen ? `${out})` : out;
}

function basenameWithoutQuery(rawPath: string): string {
  const normalized = rawPath.replaceAll('\\', '/');
  const slash = normalized.lastIndexOf('/');
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const query = base.indexOf('?');
  return query >= 0 ? base.slice(0, query) : base;
}

function replaceParenPathWithBasename(frame: string): string {
  const open = frame.lastIndexOf('(');
  const close = frame.lastIndexOf(')');
  if (open < 0 || close <= open) return frame;
  const inner = frame.slice(open + 1, close);
  if (!inner.includes('/') && !inner.includes('\\') && !inner.includes('?')) return frame;
  return `${frame.slice(0, open + 1)}${basenameWithoutQuery(inner)}${frame.slice(close)}`;
}

function isParenlessPathFrame(frame: string): boolean {
  const trimmed = frame.trim();
  if (!trimmed.startsWith('at ')) return false;
  const rest = trimmed.slice(3).trim();
  if (rest.includes(' ') || rest.includes('(') || rest.includes(')')) return false;
  if (rest.startsWith('/') || rest.startsWith('\\') || rest.startsWith('~')) return true;
  return rest.length >= 3 && rest[1] === ':' && (rest[2] === '\\' || rest[2] === '/');
}
