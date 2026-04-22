import { useT } from '@open-codesign/i18n';
import type { DiagnosticEventRow, ReportEventInput } from '@open-codesign/shared';
import { useEffect, useRef, useState } from 'react';
import { type RedactOpts, applyRedaction } from '../../lib/redact';
import { useCodesignStore } from '../../store';
import { formatRelativeTime } from '../settings/DiagnosticsPanel';

export interface ReportEventDialogProps {
  eventId: number | null;
  onClose: () => void;
}

interface IncludeFlags {
  prompt: boolean;
  paths: boolean;
  urls: boolean;
  timeline: boolean;
}

export interface RecentReportWarning {
  relative: string;
  issueUrl: string;
}

/**
 * Pure helper: turns the `isFingerprintRecentlyReported` IPC result into the
 * view model used to render the inline warning, or `null` when the fingerprint
 * hasn't been reported in the last 24h. Kept pure so it's trivially testable
 * without mounting the dialog.
 */
export function pickRecentReport(
  result: { reported: boolean; ts?: number; issueUrl?: string } | null | undefined,
  now: number = Date.now(),
): RecentReportWarning | null {
  if (!result || !result.reported) return null;
  if (typeof result.ts !== 'number' || typeof result.issueUrl !== 'string') return null;
  return { relative: formatRelativeTime(result.ts, now), issueUrl: result.issueUrl };
}

const MAX_NOTES = 2000;

export function validateNotes(notes: string): boolean {
  return notes.length <= MAX_NOTES;
}

export function buildReportInput(
  eventId: number,
  notes: string,
  include: IncludeFlags,
): Omit<ReportEventInput, 'schemaVersion' | 'timeline'> {
  return {
    eventId,
    notes,
    includePromptText: include.prompt,
    includePaths: include.paths,
    includeUrls: include.urls,
    includeTimeline: include.timeline,
  };
}

const DEFAULT_INCLUDE: IncludeFlags = {
  prompt: false,
  paths: false,
  urls: false,
  timeline: true,
};

const BODY_HEAD_MAX = 400;

export interface PreviewLabels {
  code: string;
  scope: string;
  runId: string;
  fingerprint: string;
  message: string;
  upstream: string;
}

/**
 * Pure helper: renders the dialog preview as a string. Applies the same
 * redactions the main process will apply when composing summary.md, and
 * mirrors the Upstream-context block that `renderUpstream` emits for
 * provider-scope events. Exported so the shape can be unit-tested without
 * mounting the dialog — the dialog just wraps this output in <pre>.
 */
export function formatPreview(
  event: DiagnosticEventRow,
  opts: RedactOpts,
  labels: PreviewLabels,
): string {
  const message = applyRedaction(event.message, opts);
  const lines: string[] = [
    `${labels.code}: ${event.code}`,
    `${labels.scope}: ${event.scope}`,
    `${labels.runId}: ${event.runId ?? '—'}`,
    `${labels.fingerprint}: ${event.fingerprint}`,
    `${labels.message}: ${message}`,
  ];

  if (event.scope === 'provider' && event.context) {
    const ctx = event.context;
    const upstreamRows: string[] = [];
    const provider = ctx['upstream_provider'];
    const status = ctx['upstream_status'];
    const requestId = ctx['upstream_request_id'];
    const retry = ctx['retry_count'];
    const bodyHead = ctx['redacted_body_head'];
    if (provider !== undefined) upstreamRows.push(`Provider: ${String(provider)}`);
    if (status !== undefined) upstreamRows.push(`Status: ${String(status)}`);
    if (requestId !== undefined) upstreamRows.push(`Request-Id: ${String(requestId)}`);
    if (retry !== undefined) upstreamRows.push(`Retry: ${String(retry)}`);
    if (bodyHead !== undefined) {
      const redactedBody = applyRedaction(String(bodyHead), opts).slice(0, BODY_HEAD_MAX);
      upstreamRows.push(`Body head: ${redactedBody}`);
    }
    if (upstreamRows.length > 0) {
      lines.push(`--- ${labels.upstream} ---`);
      lines.push(...upstreamRows);
    }
  }

  return lines.join('\n');
}

/**
 * Pure helper: returns the focusable elements inside a dialog panel, filtered
 * to the standard tab-stop shape. Exported so the Tab-trap behavior can be
 * unit-tested without mounting the full dialog.
 */
export function pickFocusTargets(dialog: HTMLElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !el.hasAttribute('aria-hidden'));
}

export function ReportEventDialog({ eventId, onClose }: ReportEventDialogProps) {
  const t = useT();
  const recentEvents = useCodesignStore((s) => s.recentEvents);
  const refreshDiagnosticEvents = useCodesignStore((s) => s.refreshDiagnosticEvents);
  const reportDiagnosticEvent = useCodesignStore((s) => s.reportDiagnosticEvent);
  const pushToast = useCodesignStore((s) => s.pushToast);

  const [notes, setNotes] = useState('');
  const [include, setInclude] = useState<IncludeFlags>(DEFAULT_INCLUDE);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [triedRefresh, setTriedRefresh] = useState(false);
  const [recentWarning, setRecentWarning] = useState<RecentReportWarning | null>(null);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  // Reset state whenever the dialog opens on a new event.
  useEffect(() => {
    if (eventId !== null) {
      setNotes('');
      setInclude(DEFAULT_INCLUDE);
      setBusy(false);
      setErr(null);
      setCopied(false);
      setTriedRefresh(false);
      setRecentWarning(null);
      setWarningDismissed(false);
    }
  }, [eventId]);

  const event: DiagnosticEventRow | undefined =
    eventId !== null ? recentEvents.find((e) => e.id === eventId) : undefined;

  // Pre-submit dedup check — best-effort. If the IPC fails we proceed silently.
  useEffect(() => {
    if (!event) return;
    const check = window.codesign?.diagnostics?.isFingerprintRecentlyReported;
    if (!check) return;
    let cancelled = false;
    void check(event.fingerprint)
      .then((result) => {
        if (cancelled) return;
        setRecentWarning(pickRecentReport(result));
      })
      .catch(() => {
        // Silent fall-through per spec — dedup is non-critical.
      });
    return () => {
      cancelled = true;
    };
  }, [event]);

  // If the event isn't in the store yet, refresh once and retry.
  useEffect(() => {
    if (eventId === null) return;
    if (event) return;
    if (triedRefresh) return;
    setLoading(true);
    setTriedRefresh(true);
    void refreshDiagnosticEvents().finally(() => setLoading(false));
  }, [eventId, event, triedRefresh, refreshDiagnosticEvents]);

  // Auto-focus the notes textarea when the dialog opens on an event.
  useEffect(() => {
    if (eventId === null) return;
    if (!event) return;
    notesRef.current?.focus();
  }, [eventId, event]);

  // Trap Tab / Shift-Tab inside the dialog so focus can't escape to the
  // underlying panel while the modal is open.
  useEffect(() => {
    if (eventId === null) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      if (!dialog) return;
      const focusable = pickFocusTargets(dialog);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    dialog.addEventListener('keydown', onKeyDown);
    return () => dialog.removeEventListener('keydown', onKeyDown);
  }, [eventId]);

  if (eventId === null) return null;

  async function submit(kind: 'open' | 'copy') {
    if (eventId === null) return;
    if (!validateNotes(notes)) {
      setErr(`notes > ${MAX_NOTES} chars`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const result = await reportDiagnosticEvent(buildReportInput(eventId, notes, include));
      pushToast({
        variant: 'info',
        title: t('diagnostics.report.bundleSavedTitle'),
        description: `${t('diagnostics.report.bundleSavedDescription')} ${result.bundlePath}`,
        action: {
          label: t('diagnostics.report.revealBundle'),
          onClick: () => {
            void window.codesign?.diagnostics?.showItemInFolder?.(result.bundlePath);
          },
        },
      });
      if (kind === 'open') {
        await window.codesign?.openExternal?.(result.issueUrl);
        onClose();
      } else {
        await navigator.clipboard.writeText(result.summaryMarkdown);
        setCopied(true);
        setTimeout(() => onClose(), 800);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('diagnostics.report.title')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] animate-[overlay-in_120ms_ease-out]"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="document"
        className="w-full max-w-lg rounded-[var(--radius-2xl)] bg-[var(--color-background)] border border-[var(--color-border)] shadow-[var(--shadow-elevated)] p-6 space-y-4 animate-[panel-in_160ms_ease-out]"
      >
        <h3 className="text-[var(--text-md)] font-medium text-[var(--color-text-primary)]">
          {t('diagnostics.report.title')}
        </h3>

        {loading && !event ? (
          <p className="text-[var(--text-sm)] text-[var(--color-text-secondary)]">
            {t('diagnostics.report.loading')}
          </p>
        ) : !event ? (
          <div className="space-y-3">
            <p className="text-[var(--text-sm)] text-[var(--color-text-secondary)]">
              {t('diagnostics.report.eventNotFound')}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-3 rounded-[var(--radius-md)] text-[var(--text-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                {t('diagnostics.report.close')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <pre className="text-[var(--text-xs)] font-mono bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-3 whitespace-pre-wrap break-words text-[var(--color-text-primary)]">
              {formatPreview(
                event,
                {
                  includePromptText: include.prompt,
                  includePaths: include.paths,
                  includeUrls: include.urls,
                },
                {
                  code: t('diagnostics.report.preview.code'),
                  scope: t('diagnostics.report.preview.scope'),
                  runId: t('diagnostics.report.preview.runId'),
                  fingerprint: t('diagnostics.report.preview.fingerprint'),
                  message: t('diagnostics.report.preview.message'),
                  upstream: t('diagnostics.report.preview.upstream'),
                },
              )}
            </pre>

            {recentWarning && !warningDismissed ? (
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2">
                <p className="text-[var(--text-sm)] text-[var(--color-text-primary)]">
                  <span aria-hidden="true">⚠️ </span>
                  {t('diagnostics.report.recentlyReported', { relative: recentWarning.relative })}
                </p>
                <div className="flex items-center gap-3 text-[var(--text-sm)]">
                  <a
                    href={recentWarning.issueUrl}
                    onClick={(e) => {
                      e.preventDefault();
                      void window.codesign?.openExternal?.(recentWarning.issueUrl);
                    }}
                    className="text-[var(--color-accent)] hover:underline"
                  >
                    {t('diagnostics.report.viewPrevious')}
                  </a>
                  <button
                    type="button"
                    onClick={() => setWarningDismissed(true)}
                    className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  >
                    {t('diagnostics.report.continueAnyway')}
                  </button>
                </div>
              </div>
            ) : null}

            <label className="block space-y-1">
              <span className="text-[var(--text-sm)] text-[var(--color-text-secondary)]">
                {t('diagnostics.report.notes')}
              </span>
              <textarea
                ref={notesRef}
                rows={3}
                maxLength={MAX_NOTES}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={busy}
                className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-[var(--text-sm)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
            </label>

            <fieldset className="space-y-2.5" disabled={busy}>
              <Toggle
                label={t('diagnostics.report.include.prompt')}
                hint={t('diagnostics.report.include.promptHint')}
                checked={include.prompt}
                onChange={(v) => setInclude((p) => ({ ...p, prompt: v }))}
              />
              <Toggle
                label={t('diagnostics.report.include.paths')}
                hint={t('diagnostics.report.include.pathsHint')}
                checked={include.paths}
                onChange={(v) => setInclude((p) => ({ ...p, paths: v }))}
              />
              <Toggle
                label={t('diagnostics.report.include.urls')}
                hint={t('diagnostics.report.include.urlsHint')}
                checked={include.urls}
                onChange={(v) => setInclude((p) => ({ ...p, urls: v }))}
              />
              <Toggle
                label={t('diagnostics.report.include.timeline')}
                hint={t('diagnostics.report.include.timelineHint')}
                checked={include.timeline}
                onChange={(v) => setInclude((p) => ({ ...p, timeline: v }))}
              />
            </fieldset>

            <p className="text-[var(--text-xs)] text-[var(--color-text-secondary)] leading-[var(--leading-body)]">
              {t('diagnostics.report.disclaimer')}
            </p>

            {err ? <p className="text-[var(--text-sm)] text-[var(--color-error)]">{err}</p> : null}
            {copied ? (
              <p className="text-[var(--text-sm)] text-[var(--color-text-secondary)]">
                {t('diagnostics.report.copied')}
              </p>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="h-9 px-3 rounded-[var(--radius-md)] text-[var(--text-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-50"
              >
                {t('diagnostics.report.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void submit('copy')}
                disabled={busy}
                className="h-9 px-3 rounded-[var(--radius-md)] text-[var(--text-sm)] text-[var(--color-text-primary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-50"
              >
                {t('diagnostics.report.copySummary')}
              </button>
              <button
                type="button"
                onClick={() => void submit('open')}
                disabled={busy}
                className="h-9 px-3 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[var(--text-sm)] font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {t('diagnostics.report.openIssue')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-[var(--text-sm)] text-[var(--color-text-primary)] cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 mt-[3px]"
      />
      <span className="flex flex-col gap-0.5">
        <span>{label}</span>
        {hint ? (
          <span className="text-[var(--text-xs)] text-[var(--color-text-secondary)] leading-[var(--leading-body)]">
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}
