/**
 * Wiring test for diagnostics:v1:log → recordDiagnosticEvent.
 *
 * Proves that renderer `error`-level entries are persisted into the
 * diagnostic_events table, while `info` and `warn` are log-only.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const capturedFiles = new Map<string, string>();

vi.mock('./electron-runtime', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    }),
  },
  app: { getPath: vi.fn(() => '/tmp'), getVersion: vi.fn(() => '0.0.0-test') },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
}));

vi.mock('./logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  getLogPath: vi.fn(() => '/tmp/__codesign-test-main.log'),
  logsDir: vi.fn(() => '/tmp/logs'),
}));

vi.mock('./config', () => ({
  configPath: vi.fn(() => '/tmp/__codesign-test-config.toml'),
  configDir: vi.fn(() => '/tmp'),
}));

vi.mock('zip-lib', async () => {
  const { readFileSync } = await import('node:fs');
  return {
    Zip: class {
      addFile(src: string, name: string): void {
        try {
          capturedFiles.set(name, readFileSync(src, 'utf8'));
        } catch {
          // ignore
        }
      }
      async archive(): Promise<void> {}
    },
  };
});

import {
  API_KEY_RE,
  aliasHome,
  buildIssueUrlWithTemplate,
  prettyPlatformVersion,
  readConfigRedacted,
  redactSensitiveTomlFields,
  registerDiagnosticsIpc,
} from './diagnostics-ipc';
import { initInMemoryDb, listDiagnosticEvents, recordDiagnosticEvent } from './snapshots-db';

function invoke(channel: string, payload: unknown): unknown {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler registered for ${channel}`);
  return fn({}, payload);
}

beforeEach(() => {
  handlers.clear();
  capturedFiles.clear();
});

afterEach(() => {
  handlers.clear();
  capturedFiles.clear();
  vi.restoreAllMocks();
});

describe('diagnostics:v1:recordRendererError', () => {
  it('returns the new row id', () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);

    const result = invoke('diagnostics:v1:recordRendererError', {
      schemaVersion: 1,
      code: 'IMPORT_OPENCODE_FAILED',
      scope: 'onboarding',
      message: 'config:v1:import-opencode-config failed',
      stack: 'Error: boom\n    at foo',
    }) as { schemaVersion: 1; eventId: number | null };

    expect(result.schemaVersion).toBe(1);
    expect(typeof result.eventId).toBe('number');
    expect(result.eventId).toBeGreaterThan(0);

    const rows = listDiagnosticEvents(db, { includeTransient: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(result.eventId);
    expect(rows[0]?.code).toBe('IMPORT_OPENCODE_FAILED');
    expect(rows[0]?.scope).toBe('onboarding');
  });

  it('returns null when db is null', () => {
    registerDiagnosticsIpc(null);
    const result = invoke('diagnostics:v1:recordRendererError', {
      schemaVersion: 1,
      code: 'X',
      scope: 'y',
      message: 'z',
    }) as { schemaVersion: 1; eventId: number | null; fingerprint: string | null };
    expect(result).toEqual({ schemaVersion: 1, eventId: null, fingerprint: null });
  });

  it('echoes back the main-recomputed fingerprint', () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);
    const result = invoke('diagnostics:v1:recordRendererError', {
      schemaVersion: 1,
      code: 'FP_ECHO',
      scope: 'toast',
      message: 'hello',
      stack: 'Error\n    at foo (a.ts:1:1)',
    }) as { eventId: number | null; fingerprint: string | null };
    expect(typeof result.fingerprint).toBe('string');
    expect(result.fingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it('dedups fingerprint within 200ms and returns the existing id', () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);

    // Stack must contain `at ` frames so extractTopFrames drives the
    // fingerprint basis (message is only consulted when there are no frames).
    const stack = 'Error\n    at foo (a.ts:1:1)\n    at bar (b.ts:2:2)';
    const first = invoke('diagnostics:v1:recordRendererError', {
      schemaVersion: 1,
      code: 'SAME_CODE',
      scope: 'toast',
      message: 'first',
      stack,
    }) as { eventId: number | null };

    const second = invoke('diagnostics:v1:recordRendererError', {
      schemaVersion: 1,
      code: 'SAME_CODE',
      scope: 'toast',
      message: 'second',
      stack,
    }) as { eventId: number | null };

    expect(first.eventId).not.toBeNull();
    expect(second.eventId).toBe(first.eventId);
    const rows = listDiagnosticEvents(db, { includeTransient: true });
    expect(rows).toHaveLength(1);
  });

  it('rejects bad input (missing code)', () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);
    expect(() =>
      invoke('diagnostics:v1:recordRendererError', {
        schemaVersion: 1,
        scope: 'y',
        message: 'z',
      }),
    ).toThrow(/code/);
  });

  it('recordRendererError rejects oversized fields', () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);
    expect(() =>
      invoke('diagnostics:v1:recordRendererError', {
        schemaVersion: 1,
        code: 'X',
        scope: 'y',
        message: 'x'.repeat(8001),
      }),
    ).toThrow(/message exceeds 8000/);
    expect(() =>
      invoke('diagnostics:v1:recordRendererError', {
        schemaVersion: 1,
        code: 'X',
        scope: 'y',
        message: 'ok',
        stack: 'x'.repeat(16001),
      }),
    ).toThrow(/stack exceeds 16000/);
    expect(() =>
      invoke('diagnostics:v1:recordRendererError', {
        schemaVersion: 1,
        code: 'X',
        scope: 'y',
        message: 'ok',
        context: { huge: 'x'.repeat(4100) },
      }),
    ).toThrow(/context serialized length exceeds 4000/);
  });
});

describe('diagnostics:v1:log persistence', () => {
  it('persists error-level entries into diagnostic_events', () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);

    invoke('diagnostics:v1:log', {
      schemaVersion: 1,
      level: 'error',
      scope: 'renderer:app',
      message: 'something exploded',
      data: { code: 'SOME_CODE', runId: 'run-abc' },
      stack: 'Error: boom\n    at foo',
    });

    const rows = listDiagnosticEvents(db, { includeTransient: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.level).toBe('error');
    expect(rows[0]?.code).toBe('SOME_CODE');
    expect(rows[0]?.scope).toBe('renderer:app');
    expect(rows[0]?.runId).toBe('run-abc');
    expect(rows[0]?.message).toBe('something exploded');
  });

  it('falls back to RENDERER_ERROR when data.code is absent', () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);

    invoke('diagnostics:v1:log', {
      schemaVersion: 1,
      level: 'error',
      scope: 'renderer:app',
      message: 'boom',
    });

    const rows = listDiagnosticEvents(db, { includeTransient: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe('RENDERER_ERROR');
  });

  it('does NOT persist info or warn level entries', () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);

    invoke('diagnostics:v1:log', {
      schemaVersion: 1,
      level: 'info',
      scope: 'renderer:app',
      message: 'hello',
    });
    invoke('diagnostics:v1:log', {
      schemaVersion: 1,
      level: 'warn',
      scope: 'renderer:app',
      message: 'careful',
    });

    const rows = listDiagnosticEvents(db, { includeTransient: true });
    expect(rows).toHaveLength(0);
  });

  it('is a no-op when db is null', () => {
    registerDiagnosticsIpc(null);
    expect(() =>
      invoke('diagnostics:v1:log', {
        schemaVersion: 1,
        level: 'error',
        scope: 'renderer:app',
        message: 'boom',
      }),
    ).not.toThrow();
  });
});

describe('diagnostics:v1:listEvents', () => {
  it('returns events from the DB wrapped in schemaVersion:1', () => {
    const db = initInMemoryDb();
    recordDiagnosticEvent(db, {
      level: 'error',
      code: 'X_CODE',
      scope: 'renderer:app',
      fingerprint: 'fp-a',
      message: 'one',
      runId: undefined,
      stack: undefined,
      transient: false,
    });
    recordDiagnosticEvent(db, {
      level: 'error',
      code: 'Y_CODE',
      scope: 'renderer:app',
      fingerprint: 'fp-b',
      message: 'two',
      runId: undefined,
      stack: undefined,
      transient: false,
    });
    registerDiagnosticsIpc(db);

    const result = invoke('diagnostics:v1:listEvents', {
      schemaVersion: 1,
      limit: 10,
      includeTransient: true,
    }) as { schemaVersion: 1; events: Array<{ code: string }>; dbAvailable: boolean };

    expect(result.schemaVersion).toBe(1);
    expect(result.dbAvailable).toBe(true);
    expect(result.events).toHaveLength(2);
    const codes = result.events.map((e) => e.code).sort();
    expect(codes).toEqual(['X_CODE', 'Y_CODE']);
  });

  it('rejects bad input (missing schemaVersion)', () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);

    expect(() => invoke('diagnostics:v1:listEvents', { limit: 10 })).toThrowError(/schemaVersion/);
  });

  it('returns empty list with dbAvailable=false when db is null', () => {
    registerDiagnosticsIpc(null);
    const result = invoke('diagnostics:v1:listEvents', { schemaVersion: 1 }) as {
      schemaVersion: 1;
      events: unknown[];
      dbAvailable: boolean;
    };
    expect(result).toEqual({ schemaVersion: 1, events: [], dbAvailable: false });
  });
});

describe('diagnostics:v1:reportEvent', () => {
  function baseError(overrides: Record<string, unknown> = {}) {
    return {
      localId: 'local-report-1',
      code: 'SOMETHING_BROKE',
      scope: 'renderer:app',
      fingerprint: 'fp-deadbeef',
      message: 'it broke',
      ts: Date.now(),
      ...overrides,
    };
  }
  function baseReportInput(overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: 1 as const,
      error: baseError(overrides['error'] as Record<string, unknown> | undefined),
      includePromptText: false,
      includePaths: false,
      includeUrls: false,
      includeTimeline: true,
      notes: 'looks bad',
      timeline: [],
      ...overrides,
    };
  }

  it('returns issueUrl + bundlePath + summaryMarkdown without any DB row', async () => {
    // The Report flow no longer requires a diagnostic_events row — the
    // ReportableError payload alone is enough to build the bundle.
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);

    const result = (await invoke('diagnostics:v1:reportEvent', baseReportInput())) as {
      schemaVersion: 1;
      issueUrl: string;
      bundlePath: string;
      summaryMarkdown: string;
    };

    expect(result.schemaVersion).toBe(1);
    expect(result.bundlePath).toMatch(/open-codesign-diagnostics-.*\.zip$/);
    expect(result.summaryMarkdown).toMatch(/SOMETHING_BROKE/);
    expect(result.issueUrl).toContain('github.com/OpenCoworkAI/open-codesign/issues/new');

    const url = new URL(result.issueUrl);
    expect(url.searchParams.get('template')).toBe('bug_report.yml');
    expect(url.searchParams.get('labels')).toBe('bug,triage,diagnostic-auto');
    expect(url.searchParams.get('title')).toBe('[Bug]: SOMETHING_BROKE (fp: fp-deadbeef)');
    expect(url.searchParams.get('error_code')).toBe('SOMETHING_BROKE');
    expect(url.searchParams.get('version')).toBe('0.0.0-test');
    expect(['macOS', 'Windows', 'Linux']).toContain(url.searchParams.get('platform'));
    const diagnostics = url.searchParams.get('diagnostics') ?? '';
    expect(diagnostics).toContain('Bundle saved locally at');
    expect(diagnostics).toContain(result.bundlePath);
  });

  it('throws IPC_BAD_INPUT on bad payload shape', async () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);
    await expect(
      invoke('diagnostics:v1:reportEvent', { schemaVersion: 1, error: { bogus: true } }),
    ).rejects.toThrow();
  });

  it('rejects notes > 4000 chars (defense in depth — renderer cap is UX only)', async () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);
    await expect(
      invoke('diagnostics:v1:reportEvent', baseReportInput({ notes: 'x'.repeat(4001) })),
    ).rejects.toThrow(/4000 characters/);
  });

  it('rejects timeline with > 100 entries', async () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);
    const timeline = Array.from({ length: 101 }, (_, i) => ({
      ts: i,
      type: 'prompt.submit' as const,
    }));
    await expect(
      invoke('diagnostics:v1:reportEvent', baseReportInput({ timeline })),
    ).rejects.toThrow(/100 entries/);
  });

  it('reportEvent rejects error.message longer than 8KB', async () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);
    await expect(
      invoke(
        'diagnostics:v1:reportEvent',
        baseReportInput({ error: baseError({ message: 'm'.repeat(8001) }) }),
      ),
    ).rejects.toThrow(/error\.message exceeds 8000/);
  });

  it('reportEvent rejects error.stack longer than 16KB', async () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);
    await expect(
      invoke(
        'diagnostics:v1:reportEvent',
        baseReportInput({ error: baseError({ stack: 's'.repeat(16001) }) }),
      ),
    ).rejects.toThrow(/error\.stack exceeds 16000/);
  });

  it('reportEvent rejects error.context larger than 4KB when serialized', async () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);
    await expect(
      invoke(
        'diagnostics:v1:reportEvent',
        baseReportInput({ error: baseError({ context: { huge: 'x'.repeat(4100) } }) }),
      ),
    ).rejects.toThrow(/error\.context serialized length exceeds 4000/);
  });

  it('recordReported ignores renderer-supplied fingerprint and recomputes', async () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);

    await invoke(
      'diagnostics:v1:reportEvent',
      baseReportInput({
        error: baseError({
          localId: 'local-fp',
          code: 'FP_CODE',
          // Renderer claims these fingerprints (lie / stale / bug):
          fingerprint: 'ffffffff',
          persistedFingerprint: 'eeeeeeee',
          message: 'fp check',
          stack: 'Error: fp\n    at foo (a.ts:1:1)',
        }),
      }),
    );

    const recomputed = (await import('@open-codesign/shared/fingerprint')).computeFingerprint({
      errorCode: 'FP_CODE',
      stack: 'Error: fp\n    at foo (a.ts:1:1)',
      message: 'fp check',
    });
    const { readReported } = await import('./reported-fingerprints');
    const store = readReported('/tmp/reported-fingerprints.json');
    const fps = store.entries.map((e) => e.fingerprint);
    expect(fps).toContain(recomputed);
    expect(fps).not.toContain('ffffffff');
    expect(fps).not.toContain('eeeeeeee');
  });

  it('trims logs when total URL would exceed 7KB', () => {
    // Drive the helper directly so we can force an oversized tail without
    // fighting the 50-line cap in readLogTail.
    const error = {
      localId: 'huge',
      ts: 0,
      code: 'HUGE',
      scope: 'renderer:app',
      fingerprint: 'fp-huge',
      message: 'A'.repeat(2000),
    };
    // Lines contain `\n`-heavy payload so URL encoding of %0A inflates the
    // encoded logs field past the 7KB URL cap and forces the trim path.
    const logTail = Array.from(
      { length: 300 },
      (_, i) => `line ${i}:\n\n\n${'X'.repeat(20)}\n\n\n`,
    );
    const url = buildIssueUrlWithTemplate({
      error,
      bundlePath: '/tmp/open-codesign-diagnostics-test.zip',
      appVersion: '9.9.9-test',
      platform: 'darwin',
      platformVersion: '24.0.0',
      logTail,
    });
    expect(url.length).toBeLessThanOrEqual(7100);
    const logs = new URL(url).searchParams.get('logs') ?? '';
    expect(logs).toMatch(/truncated; see attached bundle/);
  });

  it('issueUrl uses bug_report.yml template with pre-filled error_code + version + platform', async () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);

    const result = (await invoke(
      'diagnostics:v1:reportEvent',
      baseReportInput({
        error: {
          localId: 'local-prov',
          code: 'PROVIDER_HTTP_4XX',
          scope: 'provider',
          fingerprint: 'fp-prov',
          message: 'upstream 400',
          ts: Date.now(),
          context: { upstream_provider: 'anthropic', upstream_status: 400 },
        },
      }),
    )) as {
      issueUrl: string;
    };
    const url = new URL(result.issueUrl);
    expect(url.searchParams.get('template')).toBe('bug_report.yml');
    expect(url.searchParams.get('error_code')).toBe('PROVIDER_HTTP_4XX');
    expect(url.searchParams.get('version')).toBe('0.0.0-test');
    expect(url.searchParams.get('provider')).toBe('Anthropic');
    const actual = url.searchParams.get('actual') ?? '';
    expect(actual).toContain('upstream_status=400');
  });

  it('issueUrl encodes special characters correctly', async () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);

    const result = (await invoke(
      'diagnostics:v1:reportEvent',
      baseReportInput({
        error: {
          localId: 'local-weird',
          code: 'WEIRD_CODE',
          scope: 'renderer:app',
          fingerprint: 'fp-weird',
          message: 'boom & spaces + "quotes" / slashes',
          ts: Date.now(),
        },
      }),
    )) as {
      issueUrl: string;
    };
    // URL parsing must succeed and round-trip the message.
    const url = new URL(result.issueUrl);
    expect(url.searchParams.get('actual')).toContain('boom & spaces + "quotes" / slashes');
  });
});

describe('diagnostics bundle main.log scrubbing', () => {
  async function writeTestLog(content: string): Promise<void> {
    const { writeFile } = await import('node:fs/promises');
    await writeFile('/tmp/__codesign-test-main.log', content, 'utf8');
  }

  async function recordAndReport(overrides: Record<string, unknown>): Promise<{ mainLog: string }> {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);
    await invoke('diagnostics:v1:reportEvent', {
      schemaVersion: 1,
      error: {
        localId: 'local-bundle',
        code: 'BUNDLE_TEST',
        scope: 'renderer:app',
        fingerprint: 'fp-bundle',
        message: 'bundle check',
        ts: Date.now(),
      },
      includePromptText: false,
      includePaths: false,
      includeUrls: false,
      includeTimeline: true,
      notes: '',
      timeline: [],
      ...overrides,
    });
    const mainLog = capturedFiles.get('main.log');
    if (mainLog === undefined) throw new Error('main.log not captured');
    return { mainLog };
  }

  it('bundle main.log is scrubbed for paths when includePaths=false', async () => {
    await writeTestLog(
      [
        '[00:00] open /Users/alice/secret/file.ts',
        '[00:01] tmp path /var/folders/xy/abc/T/cache',
        '[00:02] hit https://example.com/api',
      ].join('\n'),
    );
    const { mainLog } = await recordAndReport({ includePaths: false, includeUrls: false });
    expect(mainLog).not.toContain('/Users/alice');
    expect(mainLog).not.toContain('/var/folders');
    expect(mainLog).not.toContain('https://example.com');
    expect(mainLog).toContain('[path omitted]');
    expect(mainLog).toContain('[url omitted]');
  });

  it('bundle main.log preserves prompt JSON when includePromptText=true', async () => {
    await writeTestLog('[00:00] generate.request data={"prompt":"build me a rocket"}');
    const { mainLog } = await recordAndReport({
      includePromptText: true,
      includePaths: true,
      includeUrls: true,
    });
    expect(mainLog).toContain('"prompt":"build me a rocket"');
    expect(mainLog).not.toContain('[prompt omitted]');
  });

  it('bundle main.log scrubs prompt JSON when includePromptText=false', async () => {
    await writeTestLog('[00:00] generate.request data={"prompt":"build me a rocket"}');
    const { mainLog } = await recordAndReport({
      includePromptText: false,
      includePaths: true,
      includeUrls: true,
    });
    expect(mainLog).not.toContain('build me a rocket');
    expect(mainLog).toContain('[prompt omitted]');
  });
});

describe('redactSensitiveTomlFields', () => {
  it('masks google api_key=AIzaSy...', () => {
    // Obviously-fake shape (all Z/0/9 placeholders) — still matches the regex,
    // doesn't trip GitHub secret scanning.
    const input = 'api_key = "AIzaSy000000000000000000000000000000000000"';
    expect(redactSensitiveTomlFields(input)).toBe('api_key = "***REDACTED***"');
  });

  it('masks api_key with unusual format', () => {
    const input = 'apiKey = "custom-prefix_weird.format/ABC==xyz"';
    expect(redactSensitiveTomlFields(input)).toBe('apiKey = "***REDACTED***"');
  });

  it('masks token / bearer / secret / access_token / refresh_token / password', () => {
    const input = [
      'token = "t1"',
      'bearer = "b1"',
      'secret = "s1"',
      'access_token = "a1"',
      'refresh_token = "r1"',
      'password = "p1"',
    ].join('\n');
    const out = redactSensitiveTomlFields(input);
    for (const raw of ['"t1"', '"b1"', '"s1"', '"a1"', '"r1"', '"p1"']) {
      expect(out).not.toContain(raw);
    }
    expect(out.match(/"\*\*\*REDACTED\*\*\*"/g)?.length).toBe(6);
  });

  it('keeps non-sensitive string fields intact', () => {
    const input = 'base_url = "https://api.example.com"\nname = "alice"';
    expect(redactSensitiveTomlFields(input)).toBe(input);
  });

  it('is case-insensitive for keys', () => {
    const input = 'API_KEY = "upper"';
    expect(redactSensitiveTomlFields(input)).toBe('API_KEY = "***REDACTED***"');
  });

  it('masks the ciphertext field used by this codebase to persist secrets', () => {
    // Reproduces the real bundle leak a user reported on 2026-04-22: the
    // `[secrets.*] ciphertext = "..."` field was slipping through because
    // it wasn't on the field allowlist. "plain:<value>" is the dev-mode
    // pass-through encoding (see keychain.ts), so the raw token is right
    // there in the exported zip.
    const input = [
      '[secrets.claude-code-imported]',
      'ciphertext = "plain:another-your-anthropic-auth-token"',
      'mask = "anot***oken"',
    ].join('\n');
    const out = redactSensitiveTomlFields(input);
    expect(out).toContain('ciphertext = "***REDACTED***"');
    expect(out).not.toContain('another-your-anthropic-auth-token');
    // mask is already the user-visible obscured form — stays intact.
    expect(out).toContain('mask = "anot***oken"');
  });

  it('masks auth_token and credential field aliases', () => {
    expect(redactSensitiveTomlFields('auth_token = "x"')).toBe('auth_token = "***REDACTED***"');
    expect(redactSensitiveTomlFields('credential = "y"')).toBe('credential = "***REDACTED***"');
  });
});

describe('buildIssueUrlWithTemplate privacy pipeline', () => {
  function makeEvent(
    overrides: Partial<{ message: string; code: string; fingerprint: string }> = {},
  ) {
    return {
      localId: 'local-test',
      ts: 0,
      code: overrides.code ?? 'TEST_CODE',
      scope: 'renderer:app',
      fingerprint: overrides.fingerprint ?? 'fp-test',
      message: overrides.message ?? 'boom',
    };
  }

  it('redacts paths from the actual field when includePaths=false', () => {
    const url = buildIssueUrlWithTemplate({
      error: makeEvent({ message: 'failed to read /Users/alice/secret/file.ts' }),
      bundlePath: '/tmp/bundle.zip',
      appVersion: '1.0.0',
      platform: 'darwin',
      logTail: [],
      includePromptText: false,
      includePaths: false,
      includeUrls: false,
    });
    const actual = new URL(url).searchParams.get('actual') ?? '';
    expect(actual).not.toContain('/Users/alice');
    expect(actual).toContain('[path omitted]');
  });

  it('redacts prompt JSON from the logs field when includePromptText=false', () => {
    const url = buildIssueUrlWithTemplate({
      error: makeEvent(),
      bundlePath: '/tmp/bundle.zip',
      appVersion: '1.0.0',
      platform: 'darwin',
      logTail: ['[00:00] generate data={"prompt":"build me a rocket"}'],
      includePromptText: false,
      includePaths: true,
      includeUrls: true,
    });
    const logs = new URL(url).searchParams.get('logs') ?? '';
    expect(logs).not.toContain('build me a rocket');
    expect(logs).toContain('[prompt omitted]');
  });

  it('aliases bundlePath under $HOME to ~/Downloads in the diagnostics field', async () => {
    const os = await import('node:os');
    const home = os.homedir();
    const url = buildIssueUrlWithTemplate({
      error: makeEvent(),
      bundlePath: `${home}/Downloads/open-codesign-diagnostics-abc.zip`,
      appVersion: '1.0.0',
      platform: 'darwin',
      logTail: [],
    });
    const diagnostics = new URL(url).searchParams.get('diagnostics') ?? '';
    expect(diagnostics).toContain('~/Downloads/open-codesign-diagnostics-abc.zip');
    expect(diagnostics).not.toContain(home);
  });

  it('includes user notes in the actual field when provided', () => {
    const url = buildIssueUrlWithTemplate({
      error: makeEvent({ message: 'boom' }),
      bundlePath: '/tmp/bundle.zip',
      appVersion: '1.0.0',
      platform: 'darwin',
      logTail: [],
      notes: 'happened when I clicked the blue button',
    });
    const actual = new URL(url).searchParams.get('actual') ?? '';
    expect(actual).toContain('user notes: happened when I clicked the blue button');
  });
});

describe('aliasHome', () => {
  it('aliases a path under $HOME to ~', async () => {
    const os = await import('node:os');
    expect(aliasHome(`${os.homedir()}/Downloads/foo.zip`)).toBe('~/Downloads/foo.zip');
  });
  it('leaves paths outside $HOME untouched', () => {
    expect(aliasHome('/etc/hosts')).toBe('/etc/hosts');
  });
});

describe('prettyPlatformVersion', () => {
  it('maps Windows 11 build to marketing name', () => {
    expect(prettyPlatformVersion('win32', '10.0.22631')).toBe('Windows 11 (10.0.22631)');
  });
  it('maps Windows 10 build to marketing name', () => {
    expect(prettyPlatformVersion('win32', '10.0.19045')).toBe('Windows 10 (10.0.19045)');
  });
  it('leaves Darwin kernel string alone', () => {
    expect(prettyPlatformVersion('darwin', '24.0.0')).toBe('24.0.0');
  });
  it('leaves Linux kernel string alone', () => {
    expect(prettyPlatformVersion('linux', '6.1.0')).toBe('6.1.0');
  });
});

describe('API_KEY_RE broadened coverage', () => {
  it('catches Google Gemini AIzaSy keys', () => {
    // Obviously-fake AIzaSy placeholder — matches the regex shape, avoids
    // GitHub push-protection alerts on realistic-looking secrets.
    const input = 'key=AIzaSy000000000000000000000000000000000000';
    expect(input.replace(API_KEY_RE, '***')).not.toContain('AIzaSy');
  });
  it('catches AWS access key IDs', () => {
    const input = 'aws AKIA0000000000000000 leaked';
    expect(input.replace(API_KEY_RE, '***')).not.toContain('AKIA0000');
  });
  it('catches 43-char base64 ending in = (Azure-shape)', () => {
    const input = `azure ${'A'.repeat(43)}=`;
    expect(input.replace(API_KEY_RE, '***')).not.toContain('A'.repeat(43));
  });
});

describe('readConfigRedacted honors include toggles', () => {
  async function writeConfig(content: string): Promise<void> {
    const { writeFile } = await import('node:fs/promises');
    await writeFile('/tmp/__codesign-test-config.toml', content, 'utf8');
  }

  it('scrubs baseUrl / rootPath when includePaths=false and includeUrls=false', async () => {
    await writeConfig(
      [
        '[provider.anthropic]',
        'baseUrl = "http://13.70.85.156:8536"',
        '[designSystem]',
        'rootPath = "/Users/alice/project"',
      ].join('\n'),
    );
    const out = await readConfigRedacted({ includePaths: false, includeUrls: false });
    expect(out).not.toContain('13.70.85.156');
    expect(out).not.toContain('/Users/alice/project');
    expect(out).toContain('[url omitted]');
    expect(out).toContain('[path omitted]');
  });

  it('keeps baseUrl when includeUrls=true', async () => {
    await writeConfig('baseUrl = "https://api.example.com"');
    const out = await readConfigRedacted({ includePaths: true, includeUrls: true });
    expect(out).toContain('https://api.example.com');
  });

  it('omits credentials-in-URL when includeUrls=false', async () => {
    await writeConfig('baseUrl = "https://admin:hunter2@host.example.com/api"');
    const out = await readConfigRedacted({ includePaths: true, includeUrls: false });
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('admin:');
  });
});

describe('diagnostics:v1:showItemInFolder allowlist', () => {
  it('rejects paths outside configDir / logsDir / downloads', () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);
    expect(() => invoke('diagnostics:v1:showItemInFolder', '/etc/passwd')).toThrow(
      /path outside allowlist/,
    );
  });

  it('allows paths under configDir (mocked to /tmp)', () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);
    expect(() =>
      invoke('diagnostics:v1:showItemInFolder', '/tmp/open-codesign-diagnostics-2025-01-01.zip'),
    ).not.toThrow();
  });

  it('rejects path with prefix that falsely matches configDir', () => {
    const db = initInMemoryDb();
    registerDiagnosticsIpc(db);
    // "/tmpXYZ/evil" starts with "/tmp" textually but is not *under* /tmp.
    expect(() => invoke('diagnostics:v1:showItemInFolder', '/tmpXYZ/evil')).toThrow(
      /path outside allowlist/,
    );
  });
});
