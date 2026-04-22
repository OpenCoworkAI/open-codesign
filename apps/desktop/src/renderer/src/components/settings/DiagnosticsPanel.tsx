import { getCurrentLocale, useT } from '@open-codesign/i18n';
import type { DiagnosticEventRow, ReportableError } from '@open-codesign/shared';
import { AlertCircle, Download, FolderOpen } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useCodesignStore } from '../../store';

type DiagnosticsApi = NonNullable<NonNullable<Window['codesign']>['diagnostics']>;

export async function loadDiagnosticEvents(
  api: DiagnosticsApi | undefined,
  includeTransient: boolean,
): Promise<{ events: DiagnosticEventRow[]; dbAvailable: boolean }> {
  if (!api?.listEvents) return { events: [], dbAvailable: true };
  const result = await api.listEvents({ schemaVersion: 1, limit: 100, includeTransient });
  // `dbAvailable` is optional on the wire for backwards compat with older main
  // processes that pre-date FIX-9; default to true (optimistic) when missing.
  const dbAvailable = (result as { dbAvailable?: boolean }).dbAvailable !== false;
  return { events: result.events, dbAvailable };
}

export async function handleOpenLogFolder(api: DiagnosticsApi | undefined): Promise<void> {
  if (!api?.openLogFolder) return;
  await api.openLogFolder();
}

export async function handleExportBundle(api: DiagnosticsApi | undefined): Promise<string | null> {
  if (!api?.exportDiagnostics) return null;
  const zipPath = await api.exportDiagnostics();
  if (api.showItemInFolder) {
    void api.showItemInFolder(zipPath);
  }
  return zipPath;
}

export function truncateMessage(message: string, limit = 80): string {
  if (message.length <= limit) return message;
  return `${message.slice(0, Math.max(0, limit - 1))}…`;
}

export function formatRunIdPreview(runId: string | undefined): string {
  if (!runId) return '—';
  return runId.slice(0, 8);
}

/**
 * Localized relative-time formatter. Previously emitted raw "5s / 3m / 4h"
 * Latin shorthand regardless of locale, which looked broken to zh-CN users.
 * Uses Intl.RelativeTimeFormat so the output matches the active UI locale
 * ("5 seconds ago" / "5 秒前"). Callers should pass the current locale;
 * tests pin it explicitly so expected strings stay deterministic.
 */
export function formatRelativeTime(ts: number, now: number = Date.now(), locale = 'en'): string {
  const delta = ts - now; // negative for past timestamps
  const absSec = Math.abs(delta) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (absSec < 60) return rtf.format(Math.round(delta / 1000), 'second');
  if (absSec < 3600) return rtf.format(Math.round(delta / 60_000), 'minute');
  if (absSec < 86400) return rtf.format(Math.round(delta / 3_600_000), 'hour');
  return rtf.format(Math.round(delta / 86_400_000), 'day');
}

/**
 * Map a persisted DiagnosticEventRow into the in-memory ReportableError shape
 * so the Report dialog can open a DB row with the same code path it uses for
 * live toasts. Sans a `localId` the dialog can't index its store entry, so we
 * mint one deterministically from the row id.
 */
export function rowToReportable(row: DiagnosticEventRow): ReportableError {
  const out: ReportableError = {
    localId: `db-${row.id}`,
    code: row.code,
    scope: row.scope,
    message: row.message,
    fingerprint: row.fingerprint,
    ts: row.ts,
    persistedEventId: row.id,
    persistedFingerprint: row.fingerprint,
  };
  if (row.stack !== undefined) out.stack = row.stack;
  if (row.runId !== undefined) out.runId = row.runId;
  if (row.context !== undefined) out.context = row.context;
  return out;
}

/**
 * Project an in-memory ReportableError into the row shape the table renders.
 * Used as the fallback when the main-process DB is unavailable so the user
 * still has a way to locate dismissed error toasts from this session.
 */
export function reportableToRow(err: ReportableError): DiagnosticEventRow {
  return {
    id: err.persistedEventId ?? -1,
    schemaVersion: 1,
    ts: err.ts,
    level: 'error',
    code: err.code,
    scope: err.scope,
    runId: err.runId,
    fingerprint: err.persistedFingerprint ?? err.fingerprint,
    message: err.message,
    stack: err.stack,
    transient: false,
    count: 1,
    context: err.context,
  };
}

export function DiagnosticsPanel() {
  const t = useT();
  const locale = getCurrentLocale();
  const refreshDiagnosticEvents = useCodesignStore((s) => s.refreshDiagnosticEvents);
  const markDiagnosticsRead = useCodesignStore((s) => s.markDiagnosticsRead);
  const openReportDialog = useCodesignStore((s) => s.openReportDialog);
  const reportableErrors = useCodesignStore((s) => s.reportableErrors);
  const [events, setEvents] = useState<DiagnosticEventRow[]>([]);
  const [dbAvailable, setDbAvailable] = useState(true);
  const [includeTransient, setIncludeTransient] = useState(false);
  const [exporting, setExporting] = useState(false);

  // When the DB is down, project reportableErrors into row shape so the
  // table still has something to show. Newest first to match the usual
  // DB ordering (listEvents returns in descending ts).
  const rows = useMemo(() => {
    if (dbAvailable) return events;
    return [...reportableErrors].sort((a, b) => b.ts - a.ts).map(reportableToRow);
  }, [dbAvailable, events, reportableErrors]);

  // Mount: refresh store (badge/unread) and mark panel as read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect
  useEffect(() => {
    void refreshDiagnosticEvents();
    markDiagnosticsRead();
  }, []);

  // Filter-driven fetch goes through local state — no need to bloat the store.
  useEffect(() => {
    let cancelled = false;
    void loadDiagnosticEvents(window.codesign?.diagnostics, includeTransient).then((result) => {
      if (cancelled) return;
      setEvents(result.events);
      setDbAvailable(result.dbAvailable);
    });
    return () => {
      cancelled = true;
    };
  }, [includeTransient]);

  async function onOpenLogFolder() {
    await handleOpenLogFolder(window.codesign?.diagnostics);
  }

  async function onExport() {
    setExporting(true);
    try {
      await handleExportBundle(window.codesign?.diagnostics);
    } finally {
      setExporting(false);
    }
  }

  function onReport(row: DiagnosticEventRow) {
    // In-memory fallback: reportableErrors already has a live record with
    // the right localId; open the dialog on it directly instead of
    // re-projecting through rowToReportable (which would mint a "db-N"
    // localId that doesn't match any store entry).
    if (!dbAvailable) {
      const match = reportableErrors.find(
        (r) => r.fingerprint === row.fingerprint && r.ts === row.ts,
      );
      if (match) {
        openReportDialog(match.localId);
        return;
      }
    }
    const reportable = rowToReportable(row);
    // Register the row in the in-memory store so the dialog can read it back
    // through the same lookup path toasts use.
    useCodesignStore.setState((s) => {
      if (s.reportableErrors.some((r) => r.localId === reportable.localId)) return s;
      return { reportableErrors: [...s.reportableErrors, reportable] };
    });
    openReportDialog(reportable.localId);
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-text-primary)]">
          {t('settings.diagnostics.title')}
        </h3>
        <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-1 leading-[var(--leading-body)]">
          {t('settings.diagnostics.description')}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void onOpenLogFolder()}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          {t('settings.diagnostics.openLogFolder')}
        </button>
        <button
          type="button"
          disabled={exporting}
          onClick={() => void onExport()}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-3.5 h-3.5" />
          {t('settings.diagnostics.exportBundle')}
        </button>
      </div>

      <label className="flex items-center gap-2 text-[var(--text-sm)] text-[var(--color-text-secondary)]">
        <input
          type="checkbox"
          checked={includeTransient}
          onChange={(e) => setIncludeTransient(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        {t('settings.diagnostics.showTransient')}
      </label>

      {!dbAvailable && rows.length > 0 ? (
        <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] px-2 py-1.5">
          {t('settings.diagnostics.inMemoryFallback')}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-[var(--text-sm)] text-[var(--color-text-muted)]">
          <AlertCircle className="w-5 h-5" />
          {dbAvailable ? t('settings.diagnostics.empty') : t('settings.diagnostics.dbUnavailable')}
        </div>
      ) : (
        <table className="w-full text-[var(--text-sm)] border-t border-[var(--color-border-subtle)]">
          <thead>
            <tr className="text-left text-[var(--text-xs)] text-[var(--color-text-muted)]">
              <th className="py-2 pr-3 font-medium">{t('settings.diagnostics.column.time')}</th>
              <th className="py-2 pr-3 font-medium">{t('settings.diagnostics.column.code')}</th>
              <th className="py-2 pr-3 font-medium">{t('settings.diagnostics.column.scope')}</th>
              <th className="py-2 pr-3 font-medium">{t('settings.diagnostics.column.runId')}</th>
              <th className="py-2 pr-3 font-medium">{t('settings.diagnostics.column.message')}</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((event) => (
              <tr
                key={`${event.id}-${event.fingerprint}-${event.ts}`}
                className="border-t border-[var(--color-border-subtle)] align-top text-[var(--color-text-secondary)]"
              >
                <td
                  className="py-2 pr-3 whitespace-nowrap"
                  title={new Date(event.ts).toISOString()}
                >
                  {formatRelativeTime(event.ts, Date.now(), locale)}
                </td>
                <td className="py-2 pr-3 font-mono text-[var(--text-xs)]">{event.code}</td>
                <td className="py-2 pr-3">{event.scope}</td>
                <td className="py-2 pr-3 font-mono text-[var(--text-xs)]">
                  {formatRunIdPreview(event.runId)}
                </td>
                <td className="py-2 pr-3 text-[var(--color-text-primary)]">
                  {truncateMessage(event.message)}
                </td>
                <td className="py-2">
                  <button
                    type="button"
                    onClick={() => onReport(event)}
                    className="inline-flex items-center h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--text-xs)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                  >
                    {t('settings.diagnostics.report')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
