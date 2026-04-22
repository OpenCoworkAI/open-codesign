import { describe, expect, it, vi } from 'vitest';
import {
  formatRelativeTime,
  formatRunIdPreview,
  handleExportBundle,
  handleOpenLogFolder,
  loadDiagnosticEvents,
  reportableToRow,
  truncateMessage,
} from './DiagnosticsPanel';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    schemaVersion: 1 as const,
    ts: Date.now(),
    level: 'error' as const,
    code: 'PROVIDER_ERROR',
    scope: 'generate',
    runId: 'abcdefgh1234',
    fingerprint: 'fp',
    message: 'boom',
    stack: undefined,
    transient: false,
    count: 1,
    context: undefined,
    ...overrides,
  };
}

describe('loadDiagnosticEvents', () => {
  it('returns events when listEvents resolves with rows', async () => {
    const listEvents = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      events: [row({ id: 1 }), row({ id: 2 })],
      dbAvailable: true,
    });
    const api = { listEvents } as unknown as Parameters<typeof loadDiagnosticEvents>[0];

    const result = await loadDiagnosticEvents(api, false);

    expect(result.events).toHaveLength(2);
    expect(result.dbAvailable).toBe(true);
    expect(listEvents).toHaveBeenCalledWith({
      schemaVersion: 1,
      limit: 100,
      includeTransient: false,
    });
  });

  it('returns empty list when api/listEvents is missing (optimistic dbAvailable=true)', async () => {
    expect(await loadDiagnosticEvents(undefined, false)).toEqual({
      events: [],
      dbAvailable: true,
    });
    expect(
      await loadDiagnosticEvents({} as Parameters<typeof loadDiagnosticEvents>[0], false),
    ).toEqual({ events: [], dbAvailable: true });
  });

  it('surfaces dbAvailable=false when main reports the DB is down', async () => {
    const listEvents = vi
      .fn()
      .mockResolvedValue({ schemaVersion: 1, events: [], dbAvailable: false });
    const api = { listEvents } as unknown as Parameters<typeof loadDiagnosticEvents>[0];

    const result = await loadDiagnosticEvents(api, false);

    expect(result.events).toEqual([]);
    expect(result.dbAvailable).toBe(false);
  });

  it('forwards includeTransient=true to listEvents when the filter is toggled on', async () => {
    const listEvents = vi
      .fn()
      .mockResolvedValue({ schemaVersion: 1, events: [], dbAvailable: true });
    const api = { listEvents } as unknown as Parameters<typeof loadDiagnosticEvents>[0];

    await loadDiagnosticEvents(api, true);

    expect(listEvents).toHaveBeenCalledWith(expect.objectContaining({ includeTransient: true }));
  });
});

describe('handleOpenLogFolder', () => {
  it('invokes window.codesign.diagnostics.openLogFolder when available', async () => {
    const openLogFolder = vi.fn().mockResolvedValue(undefined);
    await handleOpenLogFolder({ openLogFolder } as unknown as Parameters<
      typeof handleOpenLogFolder
    >[0]);
    expect(openLogFolder).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the api or method is missing', async () => {
    await expect(handleOpenLogFolder(undefined)).resolves.toBeUndefined();
  });
});

describe('handleExportBundle', () => {
  it('exports and reveals the resulting path in the file manager', async () => {
    const exportDiagnostics = vi.fn().mockResolvedValue('/tmp/bundle.zip');
    const showItemInFolder = vi.fn();
    const result = await handleExportBundle({
      exportDiagnostics,
      showItemInFolder,
    } as unknown as Parameters<typeof handleExportBundle>[0]);
    expect(result).toBe('/tmp/bundle.zip');
    expect(showItemInFolder).toHaveBeenCalledWith('/tmp/bundle.zip');
  });
});

describe('formatting helpers', () => {
  it('truncates long messages with an ellipsis', () => {
    expect(truncateMessage('short')).toBe('short');
    expect(truncateMessage('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`);
  });

  it('shows the first 8 runId characters, with a dash fallback', () => {
    expect(formatRunIdPreview('abcdefgh1234')).toBe('abcdefgh');
    expect(formatRunIdPreview(undefined)).toBe('—');
  });

  it('formats relative time via Intl.RelativeTimeFormat (en)', () => {
    const now = 1_000_000_000_000;
    expect(formatRelativeTime(now - 5_000, now, 'en')).toBe('5 seconds ago');
    expect(formatRelativeTime(now - 120_000, now, 'en')).toBe('2 minutes ago');
    expect(formatRelativeTime(now - 3 * 3_600_000, now, 'en')).toBe('3 hours ago');
    expect(formatRelativeTime(now - 2 * 86_400_000, now, 'en')).toBe('2 days ago');
  });

  it('localizes relative time into zh-CN', () => {
    const now = 1_000_000_000_000;
    const out = formatRelativeTime(now - 3 * 60_000, now, 'zh-CN');
    // ICU may emit "3 分钟前" or "3分钟前" depending on CLDR version — both
    // are valid localizations; just assert we're no longer in Latin shorthand.
    expect(out).toContain('3');
    expect(out).toContain('分');
    expect(out).not.toBe('3m');
  });
});

describe('reportableToRow', () => {
  it('projects a ReportableError into the DB-row shape used by the table', () => {
    const row = reportableToRow({
      localId: 'local-7',
      code: 'CONNECTION_TEST_FAILED',
      scope: 'settings',
      message: 'HTTP 401',
      fingerprint: 'fp-client',
      ts: 1_700_000_000_000,
      runId: 'abc',
      context: { provider: 'openai' },
    });
    expect(row).toMatchObject({
      level: 'error',
      code: 'CONNECTION_TEST_FAILED',
      scope: 'settings',
      message: 'HTTP 401',
      fingerprint: 'fp-client',
      ts: 1_700_000_000_000,
      runId: 'abc',
      context: { provider: 'openai' },
      transient: false,
    });
    // Missing persistedEventId collapses to -1 so the React key is still unique.
    expect(row.id).toBe(-1);
  });

  it('prefers the main-side persisted fingerprint when present', () => {
    const row = reportableToRow({
      localId: 'local-8',
      code: 'X',
      scope: 'y',
      message: 'm',
      fingerprint: 'client-fp',
      persistedFingerprint: 'main-fp',
      persistedEventId: 42,
      ts: 1,
    });
    expect(row.fingerprint).toBe('main-fp');
    expect(row.id).toBe(42);
  });
});
