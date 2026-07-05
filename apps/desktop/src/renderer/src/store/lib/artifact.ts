import { findArtifactSourceReference } from '@open-codesign/runtime';

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: existing complexity, see #118
function delimiterDeltaOutsideStrings(src: string, open: string, close: string): number {
  let delta = 0;
  let inStr: '"' | "'" | '`' | null = null;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inStr) {
      if (ch === '\\') {
        escaped = true;
      } else if (ch === inStr) {
        inStr = null;
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
      continue;
    }
    if (ch === open) delta += 1;
    if (ch === close) delta -= 1;
  }

  return delta;
}

/**
 * Quick sanity gate for artifact content before we overwrite the design's
 * latest snapshot. Catches the dominant failure mode: an agent run that was
 * interrupted mid-edit (context blowup, provider 400, autopolish crash, user
 * cancel) leaves a truncated JSX file in the virtual FS — its tail is missing
 * the `ReactDOM.createRoot(...).render(<App/>)` line and braces are wildly
 * unbalanced. Persisting that as the new snapshot would blank the hub
 * thumbnail and lose the previous good state. The check is intentionally
 * tolerant (±2 on bracket count) so whitespace quirks in valid artifacts pass.
 */
export function looksRunnableArtifact(src: string): boolean {
  const trimmed = src.trim();
  if (trimmed.length === 0) return false;
  const hasExplicitMount = /ReactDOM\.createRoot\s*\([\s\S]*?\)\s*\.render\s*\(/.test(trimmed);
  if (findArtifactSourceReference(trimmed) !== null && !hasExplicitMount) return false;
  if (/<html[\s>]/i.test(trimmed) || /<body[\s>]/i.test(trimmed)) return true;
  if (!hasExplicitMount) return false;
  if (Math.abs(delimiterDeltaOutsideStrings(trimmed, '{', '}')) > 2) return false;
  if (Math.abs(delimiterDeltaOutsideStrings(trimmed, '(', ')')) > 2) return false;
  return true;
}
