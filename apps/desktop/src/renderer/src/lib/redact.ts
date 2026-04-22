/**
 * Client-side redaction helpers for the Report dialog preview.
 *
 * Must match shape of diagnostic-summary.ts:PATH_REGEX / URL_REGEX and the
 * three scrubPromptInLine branches — failure to match is a privacy bug. The
 * preview shown to users in the renderer has to line up with what the main
 * process will actually write into summary.md; otherwise users will approve
 * a preview that differs from the submitted bundle.
 *
 * Placeholder strings MUST be byte-equal to main's
 * diagnostic-summary.ts constants (PROMPT_OMITTED / PATH_OMITTED /
 * URL_OMITTED) or the preview drifts from the submitted bundle.
 */

// Three branches mirror main's scrubPromptInLine exactly:
// 1. JSON-quoted "prompt": "..."       — dominant in log lines from structured loggers
// 2. Bareword  prompt: "..." / prompt = "..."
// 3. Bareword  prompt: `...` / prompt = `...`  (template-literal form)
const PROMPT_JSON_REGEX = /("prompt"\s*:\s*)"(?:[^"\\]|\\.)*"/g;
const PROMPT_BAREWORD_QUOTE_REGEX = /(\bprompt\s*[:=]\s*)"(?:[^"\\]|\\.)*"/g;
const PROMPT_BAREWORD_TICK_REGEX = /(\bprompt\s*[:=]\s*)`(?:[^`\\]|\\.)*`/g;

const PATH_REGEX =
  /(?:(?:\b[A-Za-z]:[\\/]|\\\\)[^\s'"<>`]+|(?:[/\\](?:Users|home|root|opt|Applications|var|tmp|etc|private))[/\\][^\s'"<>`]+|~[/\\][^\s'"<>`]+)/g;
const URL_REGEX = /(?:https?|wss?|file):\/\/[^\s'"<>]+/g;

/** Byte-identical to main's diagnostic-summary.ts constants. */
export const PROMPT_OMITTED = '[prompt omitted]';
export const PATH_OMITTED = '[path omitted]';
export const URL_OMITTED = '[url omitted]';

export function scrubPromptInLine(s: string): string {
  return s
    .replace(PROMPT_JSON_REGEX, `$1"${PROMPT_OMITTED}"`)
    .replace(PROMPT_BAREWORD_QUOTE_REGEX, `$1"${PROMPT_OMITTED}"`)
    .replace(PROMPT_BAREWORD_TICK_REGEX, `$1\`${PROMPT_OMITTED}\``);
}

export function redactPaths(s: string): string {
  return s.replace(PATH_REGEX, PATH_OMITTED);
}

export function redactUrls(s: string): string {
  return s.replace(URL_REGEX, URL_OMITTED);
}

/** Mirrors main's looksLikePrompt in diagnostic-summary.ts. */
function looksLikePrompt(text: string): boolean {
  if (/"prompt"\s*:\s*"/.test(text)) return true;
  if (/\bprompt\s*[:=]\s*"/.test(text)) return true;
  if (/\bprompt\s*[:=]\s*`/.test(text)) return true;
  return false;
}

export interface RedactOpts {
  includePromptText: boolean;
  includePaths: boolean;
  includeUrls: boolean;
}

export function applyRedaction(text: string, opts: RedactOpts): string {
  let out = text;
  if (!opts.includePromptText) {
    // Mirror main's redact(): replace the whole message when it structurally
    // looks like a prompt field (as opposed to an embedded one within a line).
    if (looksLikePrompt(out)) {
      out = out.replace(PROMPT_JSON_REGEX, `$1"${PROMPT_OMITTED}"`);
      out = out.replace(PROMPT_BAREWORD_QUOTE_REGEX, `$1"${PROMPT_OMITTED}"`);
      out = out.replace(PROMPT_BAREWORD_TICK_REGEX, `$1\`${PROMPT_OMITTED}\``);
    } else {
      out = scrubPromptInLine(out);
    }
  }
  if (!opts.includePaths) out = redactPaths(out);
  if (!opts.includeUrls) out = redactUrls(out);
  return out;
}
