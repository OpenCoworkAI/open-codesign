/**
 * Fingerprint — a short stable hash identifying "the same bug" across runs.
 *
 * Used by PR3's diagnostic_events store (and PR4's "You reported this
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
  /** Used as a fallback signal when stack is empty, to avoid collapsing
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
  const withoutLineCol = frame.replace(/:\d+:\d+\)?$/, (m) => (m.endsWith(')') ? ')' : ''));
  const withParenReplaced = withoutLineCol.replace(
    /\(([^()]*[\\/])?([^()\\/:?]+)(?:\?[^()]*)?(?::\d+(?::\d+)?)?\)/,
    '($2)',
  );
  // Paren-less `at /path/to/file.js` (V8 emits this for top-level frames).
  // Keep basename only so absolute paths never escape the fingerprint input
  // or the rendered stack block. Also strip any `?query` on the basename.
  if (
    /^\s*at\s+[\\/~][^\s()]+$/.test(withParenReplaced) ||
    /^\s*at\s+[A-Za-z]:\\[^\s()]+$/.test(withParenReplaced)
  ) {
    return withParenReplaced
      .replace(/[\\/]/g, '/')
      .replace(/^\s*at\s+.*\/([^/]+)$/, 'at $1')
      .replace(/\?.*$/, '');
  }
  return withParenReplaced;
}
