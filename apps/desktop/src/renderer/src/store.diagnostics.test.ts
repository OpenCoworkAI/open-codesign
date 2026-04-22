import type {
  DiagnosticEventRow,
  ListEventsResult,
  ReportEventInput,
  ReportEventResult,
} from '@open-codesign/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordAction, resetTimeline } from './lib/action-timeline';
import { useCodesignStore } from './store';

const initialState = useCodesignStore.getState();

function makeEvent(partial: Partial<DiagnosticEventRow>): DiagnosticEventRow {
  return {
    id: 1,
    schemaVersion: 1,
    ts: Date.now(),
    level: 'info',
    code: 'E_TEST',
    scope: 'test',
    runId: undefined,
    fingerprint: 'fp',
    message: 'msg',
    stack: undefined,
    transient: false,
    count: 1,
    context: undefined,
    ...partial,
  };
}

function stubWindow(
  listEvents: ReturnType<typeof vi.fn>,
  reportEvent: ReturnType<typeof vi.fn>,
  preferences?: {
    get?: ReturnType<typeof vi.fn>;
    update?: ReturnType<typeof vi.fn>;
  },
): void {
  (globalThis as unknown as { window: { codesign: unknown } }).window = {
    codesign: {
      diagnostics: {
        listEvents,
        reportEvent,
      },
      ...(preferences ? { preferences } : {}),
    },
  };
}

beforeEach(() => {
  useCodesignStore.setState({
    ...initialState,
    recentEvents: [],
    unreadErrorCount: 0,
    lastReadTs: 0,
    diagnosticsPrefsHydrated: false,
  });
  resetTimeline();
});

afterEach(() => {
  vi.unstubAllGlobals();
  (globalThis as unknown as { window?: unknown }).window = undefined;
});

describe('diagnostics slice', () => {
  it('refreshDiagnosticEvents populates recentEvents and unreadErrorCount', async () => {
    const now = Date.now();
    const events: DiagnosticEventRow[] = [
      makeEvent({ id: 1, ts: now - 10, level: 'error' }),
      makeEvent({ id: 2, ts: now - 5, level: 'warn' }),
      makeEvent({ id: 3, ts: now, level: 'error' }),
    ];
    const listEvents = vi
      .fn<(...args: unknown[]) => Promise<ListEventsResult>>()
      .mockResolvedValue({ schemaVersion: 1, events, dbAvailable: true });
    const reportEvent = vi.fn<(...args: unknown[]) => Promise<ReportEventResult>>();
    stubWindow(listEvents, reportEvent);

    await useCodesignStore.getState().refreshDiagnosticEvents();

    expect(listEvents).toHaveBeenCalledWith({
      schemaVersion: 1,
      limit: 100,
      includeTransient: false,
    });
    const state = useCodesignStore.getState();
    expect(state.recentEvents).toHaveLength(3);
    expect(state.unreadErrorCount).toBe(2);
  });

  it('markDiagnosticsRead zeroes unreadErrorCount', async () => {
    const events: DiagnosticEventRow[] = [
      makeEvent({ id: 1, level: 'error' }),
      makeEvent({ id: 2, level: 'error' }),
    ];
    const listEvents = vi
      .fn<(...args: unknown[]) => Promise<ListEventsResult>>()
      .mockResolvedValue({ schemaVersion: 1, events, dbAvailable: true });
    const reportEvent = vi.fn<(...args: unknown[]) => Promise<ReportEventResult>>();
    stubWindow(listEvents, reportEvent);

    await useCodesignStore.getState().refreshDiagnosticEvents();
    expect(useCodesignStore.getState().unreadErrorCount).toBe(2);

    useCodesignStore.getState().markDiagnosticsRead();
    expect(useCodesignStore.getState().unreadErrorCount).toBe(0);
    expect(useCodesignStore.getState().lastReadTs).toBeGreaterThan(0);
  });

  it('reportDiagnosticEvent passes timeline snapshot to IPC', async () => {
    const listEvents = vi.fn<(...args: unknown[]) => Promise<ListEventsResult>>();
    const reportEvent = vi
      .fn<(...args: unknown[]) => Promise<ReportEventResult>>()
      .mockResolvedValue({
        schemaVersion: 1,
        issueUrl: 'https://example.com/issue',
        bundlePath: '/tmp/bundle.zip',
        summaryMarkdown: '# report',
      });
    stubWindow(listEvents, reportEvent);

    recordAction({ type: 'prompt.submit' });

    const result = await useCodesignStore.getState().reportDiagnosticEvent({
      error: {
        localId: 'local-42',
        code: 'TEST',
        scope: 'renderer',
        message: 'boom',
        fingerprint: 'fp-42',
        ts: Date.now(),
      },
      includePromptText: false,
      includePaths: false,
      includeUrls: false,
      includeTimeline: true,
      notes: 'hello',
    });

    expect(reportEvent).toHaveBeenCalledTimes(1);
    const payload = reportEvent.mock.calls[0]?.[0] as ReportEventInput;
    expect(payload.schemaVersion).toBe(1);
    expect(payload.error.localId).toBe('local-42');
    expect(payload.timeline).toHaveLength(1);
    expect(payload.timeline[0]?.type).toBe('prompt.submit');
    expect(result.issueUrl).toBe('https://example.com/issue');
  });

  it('hydrates lastReadTs from preferences on first refresh', async () => {
    const persistedTs = Date.now() - 60_000;
    const events: DiagnosticEventRow[] = [
      makeEvent({ id: 1, ts: persistedTs - 10_000, level: 'error' }),
      makeEvent({ id: 2, ts: persistedTs + 10_000, level: 'error' }),
    ];
    const listEvents = vi
      .fn<(...args: unknown[]) => Promise<ListEventsResult>>()
      .mockResolvedValue({ schemaVersion: 1, events, dbAvailable: true });
    const reportEvent = vi.fn<(...args: unknown[]) => Promise<ReportEventResult>>();
    const prefsGet = vi.fn().mockResolvedValue({ diagnosticsLastReadTs: persistedTs });
    const prefsUpdate = vi.fn();
    stubWindow(listEvents, reportEvent, { get: prefsGet, update: prefsUpdate });

    await useCodesignStore.getState().refreshDiagnosticEvents();

    expect(prefsGet).toHaveBeenCalledTimes(1);
    const state = useCodesignStore.getState();
    expect(state.lastReadTs).toBe(persistedTs);
    // Only the event after persistedTs counts as unread.
    expect(state.unreadErrorCount).toBe(1);
    expect(state.diagnosticsPrefsHydrated).toBe(true);

    // Second refresh must not re-read preferences.
    await useCodesignStore.getState().refreshDiagnosticEvents();
    expect(prefsGet).toHaveBeenCalledTimes(1);
  });

  it('markDiagnosticsRead writes new value to persisted preferences', async () => {
    const prefsUpdate = vi.fn().mockResolvedValue({});
    stubWindow(vi.fn(), vi.fn(), { get: vi.fn().mockResolvedValue({}), update: prefsUpdate });

    useCodesignStore.getState().markDiagnosticsRead();

    expect(prefsUpdate).toHaveBeenCalledTimes(1);
    const arg = prefsUpdate.mock.calls[0]?.[0] as { diagnosticsLastReadTs: number };
    expect(typeof arg.diagnosticsLastReadTs).toBe('number');
    expect(arg.diagnosticsLastReadTs).toBeGreaterThan(0);
  });
});
