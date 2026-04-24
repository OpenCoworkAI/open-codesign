/**
 * Diagnostics IPC handlers (main process).
 *
 * All channels are namespaced diagnostics:v1:* and carry schemaVersion: 1
 * on every object payload.
 *
 * Channels:
 *   diagnostics:v1:log            — relay a renderer log entry to electron-log
 *   diagnostics:v1:openLogFolder  — open the logs directory in Finder/Explorer
 *   diagnostics:v1:exportDiagnostics — bundle logs + metadata into a zip
 *   diagnostics:v1:showItemInFolder  — reveal a file in the OS file manager
 *   diagnostics:v1:listEvents     — list recent diagnostic events
 *   diagnostics:v1:reportEvent    — build bundle + return GH issue URL + markdown
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, sep as pathSep } from 'node:path';
import {
  type ActionTimelineEntry,
  CodesignError,
  type DiagnosticEventInput,
  type ListEventsInput,
  type ListEventsResult,
  type RecordRendererErrorResult,
  type ReportEventInput,
  type ReportEventResult,
  type ReportableError,
} from '@open-codesign/shared';
import { computeFingerprint } from '@open-codesign/shared/fingerprint';
import type BetterSqlite3 from 'better-sqlite3';
import { configDir, configPath } from './config';
import {
  composeSummaryMarkdown,
  redactPathsAndUrls,
  scrubPromptInLine,
} from './diagnostic-summary';
import { app, ipcMain, shell } from './electron-runtime';
import { getLogPath, getLogger, logsDir } from './logger';
import { findRecent, recordReported } from './reported-fingerprints';
import {
  getDiagnosticEventById,
  listDiagnosticEvents,
  recordDiagnosticEvent,
} from './snapshots-db';

type Database = BetterSqlite3.Database;

const logger = getLogger('diagnostics-ipc');

const GITHUB_REPO_URL = 'https://github.com/OpenCoworkAI/open-codesign';
// GitHub issue URL soft cap. Past ~8KB the URL is silently truncated on some
// browsers; we keep 7KB as headroom and trim `logs` first when needed.
const GH_URL_MAX = 7000;
const ACTUAL_MAX = 1000;
const LOGS_MAX = 4000;
const DIAGNOSTICS_MAX = 500;
const REPORTED_FINGERPRINTS_FILENAME = 'reported-fingerprints.json';

// Defense-in-depth caps on IPC payload strings. A compromised renderer or
// buggy caller could otherwise flood the main process / SQLite / bundle with
// multi-MB fields. Keep these generous enough for real stack traces.
const MESSAGE_MAX = 8_000;
const STACK_MAX = 16_000;
const CONTEXT_JSON_MAX = 4_000;

/**
 * Map `process.platform` to the exact labels in `.github/ISSUE_TEMPLATE/bug_report.yml`
 * platform dropdown. Anything else (freebsd, aix, …) is left blank so the yml
 * form shows its placeholder rather than a rejected pre-fill.
 */
function mapPlatform(p: NodeJS.Platform): '' | 'macOS' | 'Windows' | 'Linux' {
  if (p === 'darwin') return 'macOS';
  if (p === 'win32') return 'Windows';
  if (p === 'linux') return 'Linux';
  return '';
}

/**
 * Map an upstream_provider string (already normalized lowercase like
 * `anthropic`, `openai`, `google`, `openrouter`, `groq`) to the exact labels
 * the yml provider dropdown accepts. Unknown providers fall back to 'Other'.
 */
function mapProvider(
  raw: unknown,
): '' | 'Anthropic' | 'OpenAI' | 'Google' | 'OpenRouter' | 'Groq' | 'Other' | 'N/A' {
  if (raw == null) return '';
  const s = String(raw).toLowerCase().trim();
  if (s === 'anthropic') return 'Anthropic';
  if (s === 'openai') return 'OpenAI';
  if (s === 'google' || s === 'gemini') return 'Google';
  if (s === 'openrouter') return 'OpenRouter';
  if (s === 'groq') return 'Groq';
  if (s.length === 0) return '';
  return 'Other';
}

function reportedFingerprintsPath(): string {
  return join(configDir(), REPORTED_FINGERPRINTS_FILENAME);
}

type LogLevel = 'info' | 'warn' | 'error';

export interface RendererLogEntry {
  schemaVersion: 1;
  level: LogLevel;
  scope: string;
  message: string;
  data?: Record<string, unknown>;
  stack?: string;
}

function parseLogEntry(raw: unknown): RendererLogEntry {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('diagnostics:v1:log expects an object payload', 'IPC_BAD_INPUT');
  }
  const r = raw as Record<string, unknown>;
  if (r['schemaVersion'] !== 1) {
    throw new CodesignError('diagnostics:v1:log requires schemaVersion: 1', 'IPC_BAD_INPUT');
  }
  if (r['level'] !== 'info' && r['level'] !== 'warn' && r['level'] !== 'error') {
    throw new CodesignError('level must be info | warn | error', 'IPC_BAD_INPUT');
  }
  if (typeof r['scope'] !== 'string' || r['scope'].trim().length === 0) {
    throw new CodesignError('scope must be a non-empty string', 'IPC_BAD_INPUT');
  }
  if (typeof r['message'] !== 'string') {
    throw new CodesignError('message must be a string', 'IPC_BAD_INPUT');
  }
  if (r['data'] !== undefined && (typeof r['data'] !== 'object' || r['data'] === null)) {
    throw new CodesignError('data must be an object if provided', 'IPC_BAD_INPUT');
  }
  if (r['stack'] !== undefined && typeof r['stack'] !== 'string') {
    throw new CodesignError('stack must be a string if provided', 'IPC_BAD_INPUT');
  }
  const base: RendererLogEntry = {
    schemaVersion: 1,
    level: r['level'] as LogLevel,
    scope: r['scope'] as string,
    message: r['message'] as string,
  };
  if (r['data'] !== undefined) {
    base.data = r['data'] as Record<string, unknown>;
  }
  if (r['stack'] !== undefined) {
    base.stack = r['stack'] as string;
  }
  return base;
}

function parseListEventsInput(raw: unknown): ListEventsInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('diagnostics:v1:listEvents expects an object payload', 'IPC_BAD_INPUT');
  }
  const r = raw as Record<string, unknown>;
  if (r['schemaVersion'] !== 1) {
    throw new CodesignError('diagnostics:v1:listEvents requires schemaVersion: 1', 'IPC_BAD_INPUT');
  }
  if (r['limit'] !== undefined && typeof r['limit'] !== 'number') {
    throw new CodesignError('limit must be a number if provided', 'IPC_BAD_INPUT');
  }
  if (r['includeTransient'] !== undefined && typeof r['includeTransient'] !== 'boolean') {
    throw new CodesignError('includeTransient must be a boolean if provided', 'IPC_BAD_INPUT');
  }
  const out: ListEventsInput = { schemaVersion: 1 };
  if (r['limit'] !== undefined) out.limit = r['limit'] as number;
  if (r['includeTransient'] !== undefined) out.includeTransient = r['includeTransient'] as boolean;
  return out;
}

function parseReportableError(raw: unknown): ReportableError {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('error payload must be an object', 'IPC_BAD_INPUT');
  }
  const r = raw as Record<string, unknown>;
  const requireString = (key: string): string => {
    if (typeof r[key] !== 'string' || (r[key] as string).length === 0) {
      throw new CodesignError(`${key} must be a non-empty string`, 'IPC_BAD_INPUT');
    }
    return r[key] as string;
  };
  const optString = (key: string): string | undefined => {
    if (r[key] === undefined) return undefined;
    if (typeof r[key] !== 'string') {
      throw new CodesignError(`${key} must be a string if provided`, 'IPC_BAD_INPUT');
    }
    return r[key] as string;
  };
  if (typeof r['ts'] !== 'number' || !Number.isFinite(r['ts'])) {
    throw new CodesignError('error.ts must be a finite number', 'IPC_BAD_INPUT');
  }
  if (
    r['context'] !== undefined &&
    (typeof r['context'] !== 'object' || r['context'] === null || Array.isArray(r['context']))
  ) {
    throw new CodesignError('error.context must be an object if provided', 'IPC_BAD_INPUT');
  }
  if (r['persistedEventId'] !== undefined && typeof r['persistedEventId'] !== 'number') {
    throw new CodesignError('error.persistedEventId must be a number if provided', 'IPC_BAD_INPUT');
  }
  const messageField = typeof r['message'] === 'string' ? (r['message'] as string) : '';
  if (messageField.length > MESSAGE_MAX) {
    throw new CodesignError(`error.message exceeds ${MESSAGE_MAX} characters`, 'IPC_BAD_INPUT');
  }
  const out: ReportableError = {
    localId: requireString('localId'),
    code: requireString('code'),
    scope: requireString('scope'),
    message: messageField,
    fingerprint: requireString('fingerprint'),
    ts: r['ts'] as number,
  };
  const stack = optString('stack');
  if (stack !== undefined) {
    if (stack.length > STACK_MAX) {
      throw new CodesignError(`error.stack exceeds ${STACK_MAX} characters`, 'IPC_BAD_INPUT');
    }
    out.stack = stack;
  }
  const runId = optString('runId');
  if (runId !== undefined) out.runId = runId;
  if (r['context'] !== undefined) {
    const ctx = r['context'] as Record<string, unknown>;
    let serializedLen: number;
    try {
      serializedLen = JSON.stringify(ctx).length;
    } catch {
      throw new CodesignError('error.context must be JSON-serializable', 'IPC_BAD_INPUT');
    }
    if (serializedLen > CONTEXT_JSON_MAX) {
      throw new CodesignError(
        `error.context serialized length exceeds ${CONTEXT_JSON_MAX} characters`,
        'IPC_BAD_INPUT',
      );
    }
    out.context = ctx;
  }
  if (r['persistedEventId'] !== undefined) out.persistedEventId = r['persistedEventId'] as number;
  const persistedFp = optString('persistedFingerprint');
  if (persistedFp !== undefined) out.persistedFingerprint = persistedFp;
  return out;
}

function parseReportEventInput(raw: unknown): ReportEventInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError(
      'diagnostics:v1:reportEvent expects an object payload',
      'IPC_BAD_INPUT',
    );
  }
  const r = raw as Record<string, unknown>;
  if (r['schemaVersion'] !== 1) {
    throw new CodesignError(
      'diagnostics:v1:reportEvent requires schemaVersion: 1',
      'IPC_BAD_INPUT',
    );
  }
  const error = parseReportableError(r['error']);
  for (const key of ['includePromptText', 'includePaths', 'includeUrls', 'includeTimeline']) {
    if (typeof r[key] !== 'boolean') {
      throw new CodesignError(`${key} must be a boolean`, 'IPC_BAD_INPUT');
    }
  }
  if (typeof r['notes'] !== 'string') {
    throw new CodesignError('notes must be a string', 'IPC_BAD_INPUT');
  }
  if ((r['notes'] as string).length > 4000) {
    throw new CodesignError('reportEvent notes exceed 4000 characters', 'IPC_BAD_INPUT');
  }
  if (!Array.isArray(r['timeline'])) {
    throw new CodesignError('timeline must be an array', 'IPC_BAD_INPUT');
  }
  if ((r['timeline'] as unknown[]).length > 100) {
    throw new CodesignError('reportEvent timeline exceeds 100 entries', 'IPC_BAD_INPUT');
  }
  return {
    schemaVersion: 1,
    error,
    includePromptText: r['includePromptText'] as boolean,
    includePaths: r['includePaths'] as boolean,
    includeUrls: r['includeUrls'] as boolean,
    includeTimeline: r['includeTimeline'] as boolean,
    notes: r['notes'] as string,
    timeline: r['timeline'] as ActionTimelineEntry[],
  };
}

function parseIsFingerprintRecentInput(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError(
      'diagnostics:v1:isFingerprintRecentlyReported expects an object payload',
      'IPC_BAD_INPUT',
    );
  }
  const r = raw as Record<string, unknown>;
  if (r['schemaVersion'] !== 1) {
    throw new CodesignError(
      'diagnostics:v1:isFingerprintRecentlyReported requires schemaVersion: 1',
      'IPC_BAD_INPUT',
    );
  }
  if (typeof r['fingerprint'] !== 'string' || (r['fingerprint'] as string).length === 0) {
    throw new CodesignError('fingerprint must be a non-empty string', 'IPC_BAD_INPUT');
  }
  return r['fingerprint'] as string;
}

function parseRecordRendererErrorInput(raw: unknown): {
  code: string;
  scope: string;
  message: string;
  stack?: string;
  runId?: string;
  context?: Record<string, unknown>;
} {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError(
      'diagnostics:v1:recordRendererError expects an object payload',
      'IPC_BAD_INPUT',
    );
  }
  const r = raw as Record<string, unknown>;
  if (r['schemaVersion'] !== 1) {
    throw new CodesignError(
      'diagnostics:v1:recordRendererError requires schemaVersion: 1',
      'IPC_BAD_INPUT',
    );
  }
  if (typeof r['code'] !== 'string' || (r['code'] as string).length === 0) {
    throw new CodesignError('code must be a non-empty string', 'IPC_BAD_INPUT');
  }
  if (typeof r['scope'] !== 'string' || (r['scope'] as string).length === 0) {
    throw new CodesignError('scope must be a non-empty string', 'IPC_BAD_INPUT');
  }
  if (typeof r['message'] !== 'string') {
    throw new CodesignError('message must be a string', 'IPC_BAD_INPUT');
  }
  if ((r['message'] as string).length > MESSAGE_MAX) {
    throw new CodesignError(`message exceeds ${MESSAGE_MAX} characters`, 'IPC_BAD_INPUT');
  }
  if (r['stack'] !== undefined && typeof r['stack'] !== 'string') {
    throw new CodesignError('stack must be a string if provided', 'IPC_BAD_INPUT');
  }
  if (r['stack'] !== undefined && (r['stack'] as string).length > STACK_MAX) {
    throw new CodesignError(`stack exceeds ${STACK_MAX} characters`, 'IPC_BAD_INPUT');
  }
  if (r['runId'] !== undefined && typeof r['runId'] !== 'string') {
    throw new CodesignError('runId must be a string if provided', 'IPC_BAD_INPUT');
  }
  if (r['context'] !== undefined && (typeof r['context'] !== 'object' || r['context'] === null)) {
    throw new CodesignError('context must be an object if provided', 'IPC_BAD_INPUT');
  }
  if (r['context'] !== undefined) {
    let serializedLen: number;
    try {
      serializedLen = JSON.stringify(r['context']).length;
    } catch {
      throw new CodesignError('context must be JSON-serializable', 'IPC_BAD_INPUT');
    }
    if (serializedLen > CONTEXT_JSON_MAX) {
      throw new CodesignError(
        `context serialized length exceeds ${CONTEXT_JSON_MAX} characters`,
        'IPC_BAD_INPUT',
      );
    }
  }
  const out: {
    code: string;
    scope: string;
    message: string;
    stack?: string;
    runId?: string;
    context?: Record<string, unknown>;
  } = {
    code: r['code'] as string,
    scope: r['scope'] as string,
    message: r['message'] as string,
  };
  if (r['stack'] !== undefined) out.stack = r['stack'] as string;
  if (r['runId'] !== undefined) out.runId = r['runId'] as string;
  if (r['context'] !== undefined) out.context = r['context'] as Record<string, unknown>;
  return out;
}

/** Regex that matches common API key shapes; used as a secondary pass so keys
 *  that leak into unexpected fields (e.g. `notes = "my sk-abcdef..."`) still
 *  get masked. Format-based so it is necessarily narrow — the primary defense
 *  is field-based redaction below. The alternation covers:
 *    - OpenAI/Anthropic-style `sk-...`
 *    - Google Gemini `AIzaSy...`
 *    - AWS access key `AKIA...`
 *    - Azure-shape 43-char base64 ending in `=` (slightly greedy but rare)
 *    - Hex-32+ (generic hash/token)
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
function redactForIssueUrl(
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
    // Field-based redaction is the primary defense; format-based is a fallback
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

async function readLogTail(maxLines: number): Promise<string[]> {
  try {
    const content = await readFile(getLogPath(), 'utf8');
    if (content.length === 0) return [];
    const lines = content.split('\n');
    // Drop trailing empty line from final newline.
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

/**
 * Build the diagnostics zip bundle. Always writes `summary.md` at the root
 * alongside `main.log`, `config-redacted.toml`, and `metadata.json`.
 *
 * The redaction toggles apply not only to `summary.md` (composed upstream)
 * but also to the raw `main.log` contents staged into the zip. Callers that
 * have no user-chosen toggles (e.g. the standalone Export Diagnostics
 * action) should pass all three flags as `false` to default to the safest
 * redaction.
 */
export async function buildBundle(opts: {
  summaryMarkdown: string;
  includePromptText: boolean;
  includePaths: boolean;
  includeUrls: boolean;
}): Promise<string> {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { Zip } = await import('zip-lib');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const destDir = app.getPath('downloads');
  const destPath = path.join(destDir, `open-codesign-diagnostics-${timestamp}.zip`);

  let logContent: string;
  try {
    logContent = await readFile(getLogPath(), 'utf8');
  } catch {
    logContent = '(log file not readable)';
  }

  const scrubbedLog = logContent
    .split('\n')
    .map((line) => {
      let l = line;
      if (!opts.includePromptText) l = scrubPromptInLine(l);
      if (!opts.includePaths || !opts.includeUrls) {
        l = redactPathsAndUrls(l, {
          includePaths: opts.includePaths,
          includeUrls: opts.includeUrls,
        });
      }
      return l;
    })
    .join('\n');

  const configContent = await readConfigRedacted({
    includePaths: opts.includePaths,
    includeUrls: opts.includeUrls,
  });

  const meta = JSON.stringify(
    {
      schemaVersion: 1,
      version: app.getVersion(),
      platform: process.platform,
      electron: process.versions.electron,
      node: process.versions.node,
      exportedAt: new Date().toISOString(),
    },
    null,
    2,
  );

  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codesign-diag-'));
  try {
    const logStagePath = path.join(stagingDir, 'main.log');
    const configStagePath = path.join(stagingDir, 'config-redacted.toml');
    const metaStagePath = path.join(stagingDir, 'metadata.json');
    const summaryStagePath = path.join(stagingDir, 'summary.md');

    await Promise.all([
      fs.writeFile(logStagePath, scrubbedLog, 'utf8'),
      fs.writeFile(configStagePath, configContent, 'utf8'),
      fs.writeFile(metaStagePath, meta, 'utf8'),
      fs.writeFile(summaryStagePath, opts.summaryMarkdown, 'utf8'),
    ]);

    await fs.mkdir(destDir, { recursive: true });

    const zip = new Zip();
    zip.addFile(logStagePath, 'main.log');
    zip.addFile(configStagePath, 'config-redacted.toml');
    zip.addFile(metaStagePath, 'metadata.json');
    zip.addFile(summaryStagePath, 'summary.md');
    await zip.archive(destPath);
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }

  return destPath;
}

async function buildDiagnosticsZip(): Promise<string> {
  // Generic summary used by the standalone "Export Diagnostics" action; the
  // richer per-event summary is produced by the Report flow via buildBundle.
  const summary = [
    '# Diagnostic Export',
    '',
    `Exported at ${new Date().toISOString()} from open-codesign ${app.getVersion()}.`,
    '',
    'This bundle contains recent logs, redacted config, and environment metadata.',
    '',
  ].join('\n');
  return buildBundle({
    summaryMarkdown: summary,
    includePromptText: false,
    includePaths: false,
    includeUrls: false,
  });
}

/**
 * Build a URL that pre-fills `.github/ISSUE_TEMPLATE/bug_report.yml`. This
 * replaces the legacy `?title=&body=` freeform URL so reports land in the
 * structured yml form (error_code / platform / version / logs / diagnostics)
 * that maintainers triage against.
 *
 * Field caps (ACTUAL_MAX, LOGS_MAX, DIAGNOSTICS_MAX) guard each field on its
 * own. If the assembled URL still exceeds GH_URL_MAX we trim `logs` first and
 * append a pointer to the attached bundle.
 */
export function buildIssueUrlWithTemplate(params: {
  error: ReportableError;
  bundlePath: string;
  appVersion: string;
  platform: NodeJS.Platform;
  platformVersion?: string;
  logTail: string[];
  notes?: string;
  includePromptText?: boolean;
  includePaths?: boolean;
  includeUrls?: boolean;
}): string {
  const {
    error,
    bundlePath,
    appVersion,
    platform,
    platformVersion,
    logTail,
    notes,
    includePromptText = false,
    includePaths = false,
    includeUrls = false,
  } = params;
  const includeOpts = { includePromptText, includePaths, includeUrls };

  const title = `[Bug]: ${error.code} (fp: ${error.fingerprint})`;

  // actual — the short human explanation. Combine message + upstream status/code
  // so the triage reader sees the headline without opening the bundle. User
  // notes (if any) ride along so triagers see them in the form without needing
  // to unzip the bundle. Every component is pushed through the same redaction
  // pipeline the summary.md uses so disabled toggles are honored here too —
  // browser history, referrer, and shell history would otherwise retain raw
  // paths / URLs / prompts.
  const actualParts: string[] = [error.message];
  if (error.scope === 'provider' && error.context) {
    const status = error.context['upstream_status'];
    const requestId = error.context['upstream_request_id'];
    if (status != null) actualParts.push(`upstream_status=${String(status)}`);
    if (requestId != null) actualParts.push(`upstream_request_id=${String(requestId)}`);
  }
  const trimmedNotes = typeof notes === 'string' ? notes.trim() : '';
  if (trimmedNotes.length > 0) {
    actualParts.push(`user notes: ${trimmedNotes}`);
  }
  const actual = truncate(redactForIssueUrl(actualParts.join(' — '), includeOpts), ACTUAL_MAX);

  // logs — fenced so GitHub renders them as a code block. Redact per-line
  // BEFORE joining so path/url scrubbers can match on whole lines. Capped at
  // LOGS_MAX up front; may be trimmed further below if the whole URL is too
  // long.
  const redactedLogTail = logTail.map((line) => redactForIssueUrl(line, includeOpts));
  let logs = fenceLogs(redactedLogTail, LOGS_MAX);

  // Alias the user's home directory out of the bundle path — the `diagnostics`
  // field ends up in browser history and referrer, and `/Users/<username>/...`
  // leaks the OS account name on every click-through.
  const displayBundlePath = aliasHome(bundlePath);
  const diagnostics = truncate(
    `Bundle saved locally at ${displayBundlePath}. Attach it to this issue after submitting.`,
    DIAGNOSTICS_MAX,
  );

  const provider =
    error.scope === 'provider' ? mapProvider(error.context?.['upstream_provider']) : '';

  function assemble(logsField: string): string {
    const params = new URLSearchParams();
    params.set('template', 'bug_report.yml');
    params.set('title', title);
    params.set('labels', 'bug,triage,diagnostic-auto');
    params.set('version', appVersion);
    const mappedPlatform = mapPlatform(platform);
    if (mappedPlatform) params.set('platform', mappedPlatform);
    if (platformVersion) params.set('platform_version', platformVersion);
    if (provider) params.set('provider', provider);
    params.set('error_code', error.code);
    params.set('actual', actual);
    params.set('logs', logsField);
    params.set('diagnostics', diagnostics);
    return `${GITHUB_REPO_URL}/issues/new?${params.toString()}`;
  }

  let url = assemble(logs);
  if (url.length > GH_URL_MAX) {
    // Trim logs until the URL fits, then mark it so the reader knows to look
    // at the bundle for the full trace.
    const overflow = url.length - GH_URL_MAX;
    const trimmedLen = Math.max(0, logs.length - overflow - 200);
    logs = `${logs.slice(0, trimmedLen)}\n... (truncated; see attached bundle)\n\`\`\``;
    url = assemble(logs);
  }
  return url;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function fenceLogs(lines: string[], max: number): string {
  const joined = lines.join('\n');
  const body = joined.length <= max ? joined : `${joined.slice(joined.length - max)}`;
  return `\`\`\`\n${body}\n\`\`\``;
}

export function registerDiagnosticsIpc(db: Database | null): void {
  ipcMain.handle('diagnostics:v1:log', (_e: unknown, raw: unknown): void => {
    const entry = parseLogEntry(raw);
    const scopedLogger = getLogger(`renderer:${entry.scope}`);
    const fields: Record<string, unknown> = {};
    if (entry.data !== undefined) {
      Object.assign(fields, entry.data);
    }
    // Stack is forwarded as a separate key, never concatenated into the message,
    // so it doesn't duplicate what electron-log already captures per-error.
    if (entry.stack !== undefined) {
      fields['stack'] = entry.stack;
    }
    switch (entry.level) {
      case 'info':
        scopedLogger.info(entry.message, fields);
        break;
      case 'warn':
        scopedLogger.warn(entry.message, fields);
        break;
      case 'error':
        scopedLogger.error(entry.message, fields);
        break;
    }

    // Persist only error-level renderer entries into diagnostic_events.
    if (entry.level === 'error' && db !== null) {
      const dataCode =
        entry.data !== undefined && typeof entry.data['code'] === 'string'
          ? (entry.data['code'] as string)
          : undefined;
      const code = dataCode ?? 'RENDERER_ERROR';
      const runId =
        entry.data !== undefined && typeof entry.data['runId'] === 'string'
          ? (entry.data['runId'] as string)
          : undefined;
      recordDiagnosticEvent(db, {
        level: 'error',
        code,
        scope: entry.scope,
        runId,
        fingerprint: computeFingerprint({
          errorCode: code,
          stack: entry.stack,
          message: entry.message,
        }),
        message: entry.message,
        stack: entry.stack,
        transient: false,
      });
    }
  });

  ipcMain.handle(
    'diagnostics:v1:recordRendererError',
    (_e: unknown, raw: unknown): RecordRendererErrorResult => {
      const input = parseRecordRendererErrorInput(raw);
      if (db === null) {
        return { schemaVersion: 1, eventId: null, fingerprint: null };
      }
      const fingerprint = computeFingerprint({
        errorCode: input.code,
        stack: input.stack,
        message: input.message,
      });
      const recordInput: DiagnosticEventInput = {
        level: 'error',
        code: input.code,
        scope: input.scope,
        runId: input.runId,
        fingerprint,
        message: input.message,
        stack: input.stack,
        transient: false,
      };
      if (input.context !== undefined) recordInput.context = input.context;
      const eventId = recordDiagnosticEvent(db, recordInput);
      return { schemaVersion: 1, eventId, fingerprint };
    },
  );

  ipcMain.handle('diagnostics:v1:openLogFolder', async (): Promise<void> => {
    await shell.openPath(logsDir());
  });

  ipcMain.handle('diagnostics:v1:exportDiagnostics', async (): Promise<string> => {
    try {
      const zipPath = await buildDiagnosticsZip();
      logger.info('diagnostics.exported', { path: zipPath });
      return zipPath;
    } catch (err) {
      logger.error('diagnostics.export.fail', {
        message: err instanceof Error ? err.message : String(err),
      });
      throw new CodesignError(
        `Failed to export diagnostics: ${err instanceof Error ? err.message : String(err)}`,
        'DIAGNOSTICS_EXPORT_FAILED',
        { cause: err },
      );
    }
  });

  ipcMain.handle('diagnostics:v1:showItemInFolder', (_e: unknown, raw: unknown): void => {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new CodesignError(
        'diagnostics:v1:showItemInFolder expects a non-empty path string',
        'IPC_BAD_INPUT',
      );
    }
    // Renderer can only reveal paths the app itself produces: config files,
    // log files, and diagnostic bundles saved to Downloads. Without this gate
    // a compromised renderer could point Finder/Explorer at `/etc/shadow` or
    // `~/.ssh/id_rsa`.
    const target = raw;
    const allowedRoots = [configDir(), logsDir(), app.getPath('downloads')];
    const isAllowed = allowedRoots.some((root) => {
      if (!root) return false;
      if (target === root) return true;
      return target.startsWith(`${root}${pathSep}`) || target.startsWith(`${root}/`);
    });
    if (!isAllowed) {
      throw new CodesignError(
        'diagnostics:v1:showItemInFolder path outside allowlist',
        'IPC_BAD_INPUT',
      );
    }
    shell.showItemInFolder(target);
  });

  ipcMain.handle('diagnostics:v1:listEvents', (_e: unknown, raw: unknown): ListEventsResult => {
    const input = parseListEventsInput(raw);
    if (db === null) {
      return { schemaVersion: 1, events: [], dbAvailable: false };
    }
    const opts: { limit?: number; includeTransient?: boolean } = {};
    if (input.limit !== undefined) opts.limit = input.limit;
    if (input.includeTransient !== undefined) opts.includeTransient = input.includeTransient;
    const events = listDiagnosticEvents(db, opts);
    return { schemaVersion: 1, events, dbAvailable: true };
  });

  ipcMain.handle(
    'diagnostics:v1:reportEvent',
    async (_e: unknown, raw: unknown): Promise<ReportEventResult> => {
      const input = parseReportEventInput(raw);
      const error = input.error;

      // If the ReportableError was persisted into diagnostic_events earlier,
      // surface the DB row's `count` + `context_json` so the bundle carries
      // the richer repeat-count and any context the renderer didn't ship. All
      // of this is nice-to-have; Report works end-to-end without the DB.
      let dbCount = 1;
      if (db !== null && typeof error.persistedEventId === 'number') {
        const row = getDiagnosticEventById(db, error.persistedEventId);
        if (row !== undefined) {
          dbCount = row.count;
          if (error.context === undefined && row.context !== undefined) {
            error.context = row.context;
          }
        }
      }

      const recentLogTail = await readLogTail(50);
      const summaryMarkdown = composeSummaryMarkdown({
        error,
        count: dbCount,
        level: 'error',
        transient: false,
        appVersion: app.getVersion(),
        platform: process.platform,
        electronVersion: process.versions.electron ?? 'unknown',
        nodeVersion: process.versions.node,
        timeline: input.timeline,
        recentLogTail,
        notes: input.notes,
        includePromptText: input.includePromptText,
        includePaths: input.includePaths,
        includeUrls: input.includeUrls,
        includeTimeline: input.includeTimeline,
      });

      const bundlePath = await buildBundle({
        summaryMarkdown,
        includePromptText: input.includePromptText,
        includePaths: input.includePaths,
        includeUrls: input.includeUrls,
      });
      const os = await import('node:os');
      const issueUrl = buildIssueUrlWithTemplate({
        error,
        bundlePath,
        appVersion: app.getVersion(),
        platform: process.platform,
        platformVersion: prettyPlatformVersion(process.platform, os.release()),
        logTail: recentLogTail,
        notes: input.notes,
        includePromptText: input.includePromptText,
        includePaths: input.includePaths,
        includeUrls: input.includeUrls,
      });

      try {
        // SECURITY: never trust the renderer-supplied fingerprint for dedup.
        // Recompute main-side from errorCode + stack + message so a compromised
        // renderer can't spoof or bypass the "recently reported" record.
        const fp = computeFingerprint({
          errorCode: error.code,
          stack: error.stack,
          message: error.message,
        });
        recordReported(reportedFingerprintsPath(), fp, issueUrl);
      } catch (err) {
        logger.warn('diagnostics.reported.dedupWrite.fail', {
          message: err instanceof Error ? err.message : String(err),
        });
      }

      logger.info('diagnostics.reported', {
        localId: error.localId,
        code: error.code,
        fingerprint: error.fingerprint,
        persistedEventId: error.persistedEventId,
        bundlePath,
      });

      return { schemaVersion: 1, issueUrl, bundlePath, summaryMarkdown };
    },
  );

  ipcMain.handle('diagnostics:v1:isFingerprintRecentlyReported', (_e: unknown, raw: unknown) => {
    const fingerprint = parseIsFingerprintRecentInput(raw);
    const hit = findRecent(reportedFingerprintsPath(), fingerprint);
    if (hit === undefined) {
      return { schemaVersion: 1 as const, reported: false };
    }
    return {
      schemaVersion: 1 as const,
      reported: true,
      ts: hit.ts,
      issueUrl: hit.issueUrl,
    };
  });
}
