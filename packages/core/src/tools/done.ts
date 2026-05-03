/**
 * done — self-check tool the agent calls when it believes the artifact is
 * complete. Two layers:
 *   1. Static lint over `index.html` (unclosed tags, duplicate IDs, missing
 *      alt). Cheap and host-free; runs in every environment.
 *   2. Optional runtime verifier injected by the host. The desktop app passes
 *      a callback that loads the artifact in a hidden Electron BrowserWindow,
 *      captures `console-message` + `did-fail-load` for ~3s, and returns the
 *      collected errors. Without this callback (e.g. in vitest), step 2 is
 *      skipped and only static issues are reported.
 *
 * Result: `{ status: 'ok' | 'has_errors', errors: [...] }`. The agent
 * self-heals via `str_replace_based_edit_tool` and calls `done` again.
 */

import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import type { TextEditorFsCallbacks } from './text-editor.js';

const DoneParams = Type.Object({
  summary: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
});

export interface DoneError {
  message: string;
  source?: string;
  lineno?: number;
}

export interface DoneDetails {
  status: 'ok' | 'has_errors';
  path: string;
  errors: DoneError[];
  summary?: string;
}

/** Host-injected runtime verifier. Receives the raw artifact source (the
 *  agent's JSX module, NOT a fully-built srcdoc) and returns any console /
 *  load errors observed when the host actually executed it. */
export type DoneRuntimeVerifier = (artifactSource: string) => Promise<DoneError[]>;

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function findUnclosedTags(html: string): DoneError[] {
  const issues: DoneError[] = [];
  const stack: Array<{ tag: string; lineno: number }> = [];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/)?>/g;
  let match = tagRe.exec(html);
  while (match !== null) {
    const name = (match[1] ?? '').toLowerCase();
    const isClose = match[0].startsWith('</');
    const selfClosing = match[2] === '/' || VOID_ELEMENTS.has(name);
    if (selfClosing) {
      match = tagRe.exec(html);
      continue;
    }
    const lineno = html.slice(0, match.index).split('\n').length;
    if (isClose) {
      const top = stack[stack.length - 1];
      if (top && top.tag === name) stack.pop();
      else
        issues.push({
          message: `Closing </${name}> without matching open`,
          lineno,
          source: 'html',
        });
    } else {
      stack.push({ tag: name, lineno });
    }
    match = tagRe.exec(html);
  }
  for (const { tag, lineno } of stack) {
    issues.push({ message: `Unclosed <${tag}>`, lineno, source: 'html' });
  }
  return issues;
}

function findDuplicateIds(html: string): DoneError[] {
  const seen = new Map<string, number>();
  const idRe = /\bid\s*=\s*["']([^"']+)["']/g;
  let m = idRe.exec(html);
  while (m !== null) {
    const id = m[1] ?? '';
    seen.set(id, (seen.get(id) ?? 0) + 1);
    m = idRe.exec(html);
  }
  const dupes: DoneError[] = [];
  for (const [id, count] of seen) {
    if (count > 1)
      dupes.push({ message: `Duplicate id="${id}" (${count} occurrences)`, source: 'html' });
  }
  return dupes;
}

function findMissingAlt(html: string): DoneError[] {
  const issues: DoneError[] = [];
  const imgRe = /<img\b[^>]*>/gi;
  let m = imgRe.exec(html);
  while (m !== null) {
    if (!/\balt\s*=/i.test(m[0])) {
      const lineno = html.slice(0, m.index).split('\n').length;
      issues.push({ message: '<img> without alt attribute', lineno, source: 'html' });
    }
    m = imgRe.exec(html);
  }
  return issues;
}

function isFullHtmlDocument(src: string): boolean {
  return (
    /<!doctype\s+html/i.test(src) ||
    /<html[\s>]/i.test(src) ||
    (/<head[\s>]/i.test(src) && /<body[\s>]/i.test(src))
  );
}

function isJsxShaped(src: string): boolean {
  if (isFullHtmlDocument(src)) return false;
  return (
    /ReactDOM\.createRoot\s*\(/.test(src) ||
    /\/\*\s*EDITMODE-BEGIN\s*\*\//.test(src) ||
    /(?:^|\n)\s*function\s+App\s*\(/.test(src) ||
    /(?:^|\n)\s*const\s+App\s*=/.test(src) ||
    /<[A-Z][A-Za-z0-9]*(?:\s|>|\/)/.test(src)
  );
}

/**
 * Cheap structural JSX sanity check — catches the 90% of agent mistakes that
 * break Babel compile before the 3-second runtime BrowserWindow load even
 * has a chance. These are SYNCHRONOUS and deterministic so they surface in
 * every `done` call, not just when the error happens on first paint.
 *
 * Only fires for JSX-shaped artifacts. Pure HTML (legacy pastes, tests) is
 * skipped — those have their own checks via findUnclosedTags etc.
 */
function findJsxStructuralIssues(src: string): DoneError[] {
  // Plain HTML files are first-class in v0.2 (agent writes index.html into
  // the workspace; puppeteer renders file:// directly — no JSX wrap needed).
  // Skip the JSX structural checks entirely when the source looks like an
  // HTML document, otherwise the "missing ReactDOM.createRoot" error trains
  // the agent to rewrite the file as React, which is a regression.
  if (!isJsxShaped(src)) return [];

  const issues: DoneError[] = [];

  // Markdown code fences that sometimes leak when the agent slips into prose
  // mode and wraps JSX in ```jsx ... ```.
  const fenceMatch = src.match(/^```/m);
  if (fenceMatch) {
    const lineno = src.slice(0, fenceMatch.index ?? 0).split('\n').length;
    issues.push({
      message: 'Leftover markdown code fence (```) inside JSX — remove it.',
      lineno,
      source: 'syntax',
    });
  }

  // Brace / paren / bracket balance across the whole file. String-aware so
  // JSX string literals and template literals don't confuse the counter.
  const counters = { '(': 0, '{': 0, '[': 0 };
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
    if (ch === '(' || ch === '{' || ch === '[') {
      counters[ch] += 1;
      continue;
    }
    if (ch === ')') counters['('] -= 1;
    else if (ch === '}') counters['{'] -= 1;
    else if (ch === ']') counters['['] -= 1;
  }
  if (counters['('] !== 0) {
    issues.push({
      message: `Unbalanced parentheses: ${counters['(']} extra '(' (negative = extra ')').`,
      source: 'syntax',
    });
  }
  if (counters['{'] !== 0) {
    issues.push({
      message: `Unbalanced braces: ${counters['{']} extra '{' (negative = extra '}').`,
      source: 'syntax',
    });
  }
  if (counters['['] !== 0) {
    issues.push({
      message: `Unbalanced brackets: ${counters['[']} extra '[' (negative = extra ']').`,
      source: 'syntax',
    });
  }

  // Required JSX anchors — without them the runtime can't mount.
  if (!/ReactDOM\.createRoot\s*\(/.test(src)) {
    const legacyRender = /(?:^|\n)\s*render\s*\(\s*<([A-Z][A-Za-z0-9]*)\b/.exec(src);
    issues.push({
      message:
        legacyRender !== null
          ? `Legacy render(<${legacyRender[1]} />) helper is not available. Define function App() and mount with ReactDOM.createRoot(document.getElementById('root')).render(<App />).`
          : 'Missing ReactDOM.createRoot(...) call — the artifact will not mount.',
      source: 'syntax',
    });
  }
  if (!/(?:function\s+App\s*\(|const\s+App\s*=|let\s+App\s*=)/.test(src)) {
    issues.push({
      message: 'Missing `function App()` or `const App = ...` declaration.',
      source: 'syntax',
    });
  }

  // After the final ReactDOM.createRoot(...).render(...) call there should
  // only be whitespace or comments. Stray tokens here are the exact failure
  // mode that produced "Unexpected token (line:0)" in production.
  const renderRe = /ReactDOM\.createRoot\([\s\S]*?\)\s*\.render\([\s\S]*?\)\s*;?/g;
  let lastRender: RegExpExecArray | null = null;
  let match = renderRe.exec(src);
  while (match !== null) {
    lastRender = match;
    match = renderRe.exec(src);
  }
  if (lastRender) {
    const tail = src.slice(lastRender.index + lastRender[0].length);
    // Strip /* ... */ and // ... comments + whitespace and see what's left.
    const stripped = tail
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/[^\n]*$/gm, '')
      .trim();
    if (stripped.length > 0) {
      const lineno = src.slice(0, lastRender.index + lastRender[0].length).split('\n').length;
      issues.push({
        message: `Unexpected content after ReactDOM.createRoot(...).render(...): "${stripped.slice(0, 80)}${stripped.length > 80 ? '…' : ''}"`,
        lineno,
        source: 'syntax',
      });
    }
  }

  return issues;
}

export function makeDoneTool(
  fs: TextEditorFsCallbacks,
  runtimeVerify?: DoneRuntimeVerifier,
): AgentTool<typeof DoneParams, DoneDetails> {
  return {
    name: 'done',
    label: 'Done — self-check',
    description:
      'Call when you believe the artifact is complete. The host runs static ' +
      'syntax checks AND loads the file in an isolated runtime to capture ' +
      'console errors / load failures, then replies with ' +
      '`{ status: "ok" | "has_errors", errors: [...] }`. If errors come back, ' +
      'you MUST fix them with str_replace_based_edit_tool and call `done` again. ' +
      'Stop calling once status is "ok" or after 5 rounds. If errors still ' +
      'remain with a valid artifact after those repair rounds, the host may ' +
      'keep the latest artifact but will surface warnings to the user.',
    parameters: DoneParams,
    async execute(_id, params): Promise<AgentToolResult<DoneDetails>> {
      const path = params.path ?? 'index.html';
      const file = fs.view(path);
      if (file === null) {
        const details: DoneDetails = {
          status: 'has_errors',
          path,
          errors: [{ message: `File not found: ${path}`, source: 'fs' }],
          ...(params.summary !== undefined ? { summary: params.summary } : {}),
        };
        return {
          content: [{ type: 'text', text: `has_errors\n- File not found: ${path}` }],
          details,
        };
      }
      const errors: DoneError[] = [
        ...findJsxStructuralIssues(file.content),
        ...(isJsxShaped(file.content) ? [] : findUnclosedTags(file.content)),
        ...findDuplicateIds(file.content),
        ...findMissingAlt(file.content),
      ];
      if (runtimeVerify) {
        try {
          const runtimeErrors = await runtimeVerify(file.content);
          errors.push(...runtimeErrors);
        } catch (err) {
          errors.push({
            message: `Runtime verifier failed: ${err instanceof Error ? err.message : String(err)}`,
            source: 'runtime',
          });
        }
      }
      const status: DoneDetails['status'] = errors.length === 0 ? 'ok' : 'has_errors';
      const details: DoneDetails = {
        status,
        path,
        errors,
        ...(params.summary !== undefined ? { summary: params.summary } : {}),
      };
      const text =
        status === 'ok'
          ? [
              runtimeVerify
                ? 'ok — no syntactic or runtime issues detected.'
                : 'ok — no syntactic issues detected. (Runtime verification not configured in this host.)',
              '',
              'STOP. The design is verified. Your only remaining action is a short',
              '2–3 sentence natural-language summary of the design decisions — no',
              'code, no fenced blocks, no `<artifact>` tags, no file re-emission.',
              'Do NOT call `done` again. Do NOT call any other tool. The host',
              'extracts the artifact from the virtual filesystem automatically;',
              "anything else you emit is wasted tokens and pollutes the user's chat.",
            ].join('\n')
          : `has_errors\n${errors.map((e) => `- ${e.message}${e.lineno ? ` (line ${e.lineno})` : ''}`).join('\n')}`;
      return { content: [{ type: 'text', text }], details };
    },
  };
}
