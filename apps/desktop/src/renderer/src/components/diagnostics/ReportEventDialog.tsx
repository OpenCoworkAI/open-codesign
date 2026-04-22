import { getCurrentLocale, useT } from '@open-codesign/i18n';
import type { ReportEventInput, ReportableError } from '@open-codesign/shared';
import { useEffect, useRef, useState } from 'react';
import { type RedactOpts, applyRedaction } from '../../lib/redact';
import { useCodesignStore } from '../../store';
import { formatRelativeTime } from '../settings/DiagnosticsPanel';

export interface ReportEventDialogProps {
  localId: string | null;
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
  issueNumber: string | null;
}

/**
 * Extract the GitHub issue number from a URL like
 * `https://github.com/owner/repo/issues/123`. Returns null when the URL
 * doesn't match — callers fall back to the no-number warning variant.
 */
export function parseIssueNumber(issueUrl: string): string | null {
  const match = issueUrl.match(/\/issues\/(\d+)/);
  return match?.[1] ?? null;
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
  locale = 'en',
): RecentReportWarning | null {
  if (!result || !result.reported) return null;
  if (typeof result.ts !== 'number' || typeof result.issueUrl !== 'string') return null;
  return {
    relative: formatRelativeTime(result.ts, now, locale),
    issueUrl: result.issueUrl,
    issueNumber: parseIssueNumber(result.issueUrl),
  };
}

const MAX_NOTES = 2000;
const CONFIRM_SECONDS = 60;

export function validateNotes(notes: string): boolean {
  return notes.length <= MAX_NOTES;
}

export function buildReportInput(
  error: ReportableError,
  notes: string,
  include: IncludeFlags,
): Omit<ReportEventInput, 'schemaVersion' | 'timeline'> {
  return {
    error,
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
  upstreamProvider: string;
  upstreamStatus: string;
  upstreamRequestId: string;
  upstreamRetry: string;
  upstreamBodyHead: string;
}

/**
 * Pure helper: renders the dialog preview as a string. Applies the same
 * redactions the main process will apply when composing summary.md, and
 * mirrors the Upstream-context block that `renderUpstream` emits for
 * provider-scope events. Exported so the shape can be unit-tested without
 * mounting the dialog — the dialog just wraps this output in <pre>.
 */
export function formatPreview(
  error: ReportableError,
  opts: RedactOpts,
  labels: PreviewLabels,
): string {
  const message = applyRedaction(error.message, opts);
  const lines: string[] = [
    `${labels.code}: ${error.code}`,
    `${labels.scope}: ${error.scope}`,
    `${labels.runId}: ${error.runId ?? '—'}`,
    `${labels.fingerprint}: ${error.fingerprint}`,
    `${labels.message}: ${message}`,
  ];

  if (error.scope === 'provider' && error.context) {
    const ctx = error.context;
    const upstreamRows: string[] = [];
    const provider = ctx['upstream_provider'];
    const status = ctx['upstream_status'];
    const requestId = ctx['upstream_request_id'];
    const retry = ctx['retry_count'];
    const bodyHead = ctx['redacted_body_head'];
    // Mirror main-process `asString` semantics: treat both null and undefined
    // as absent so the preview omits exactly when the bundle will.
    if (provider != null) upstreamRows.push(`${labels.upstreamProvider}: ${String(provider)}`);
    if (status != null) upstreamRows.push(`${labels.upstreamStatus}: ${String(status)}`);
    if (requestId != null) upstreamRows.push(`${labels.upstreamRequestId}: ${String(requestId)}`);
    if (retry != null) upstreamRows.push(`${labels.upstreamRetry}: ${String(retry)}`);
    if (bodyHead != null) {
      const redacted = applyRedaction(String(bodyHead), opts);
      // Match main-process truncate(): append an ellipsis when cut.
      const redactedBody =
        redacted.length > BODY_HEAD_MAX ? `${redacted.slice(0, BODY_HEAD_MAX)}…` : redacted;
      upstreamRows.push(`${labels.upstreamBodyHead}: ${redactedBody}`);
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

export function ReportEventDialog({ localId, onClose }: ReportEventDialogProps) {
  const t = useT();
  const error = useCodesignStore((s) =>
    localId !== null ? s.reportableErrors.find((r) => r.localId === localId) : undefined,
  );
  const reportDiagnosticEvent = useCodesignStore((s) => s.reportDiagnosticEvent);
  const pushToast = useCodesignStore((s) => s.pushToast);

  const [notes, setNotes] = useState('');
  const [include, setInclude] = useState<IncludeFlags>(DEFAULT_INCLUDE);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [recentWarning, setRecentWarning] = useState<RecentReportWarning | null>(null);
  const [warningDismissed, setWarningDismissed] = useState(false);
  // Two-step confirmation when the same fingerprint was reported recently.
  // First click on "Open issue" arms `confirmingDuplicate`; the second click
  // within 60s actually submits. Prevents the repeat-submit pattern we saw in
  // the field (6 reported entries for one fingerprint in minutes).
  const [confirmingDuplicate, setConfirmingDuplicate] = useState(false);
  const [confirmSecondsLeft, setConfirmSecondsLeft] = useState(CONFIRM_SECONDS);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  // Reset state whenever the dialog opens on a new error.
  useEffect(() => {
    if (localId !== null) {
      setNotes('');
      setInclude(DEFAULT_INCLUDE);
      setBusy(false);
      setErr(null);
      setCopied(false);
      setRecentWarning(null);
      setWarningDismissed(false);
      setConfirmingDuplicate(false);
      if (confirmTimeoutRef.current !== null) {
        clearTimeout(confirmTimeoutRef.current);
        confirmTimeoutRef.current = null;
      }
      if (confirmIntervalRef.current !== null) {
        clearInterval(confirmIntervalRef.current);
        confirmIntervalRef.current = null;
      }
      setConfirmSecondsLeft(CONFIRM_SECONDS);
    }
  }, [localId]);

  // Pre-submit dedup check — best-effort. If the IPC fails we proceed silently.
  useEffect(() => {
    if (!error) return;
    const check = window.codesign?.diagnostics?.isFingerprintRecentlyReported;
    if (!check) return;
    let cancelled = false;
    void check(error.fingerprint)
      .then((result) => {
        if (cancelled) return;
        setRecentWarning(pickRecentReport(result, Date.now(), getCurrentLocale()));
      })
      .catch(() => {
        // Silent fall-through per spec — dedup is non-critical.
      });
    return () => {
      cancelled = true;
    };
  }, [error]);

  // Auto-focus the notes textarea when the dialog opens.
  useEffect(() => {
    if (localId === null) return;
    if (!error) return;
    notesRef.current?.focus();
  }, [localId, error]);

  // Trap Tab / Shift-Tab inside the dialog so focus can't escape to the
  // underlying panel while the modal is open.
  useEffect(() => {
    if (localId === null) return;
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
  }, [localId]);

  if (localId === null || !error) return null;

  async function submit(kind: 'open' | 'copy') {
    if (!error) return;
    if (!validateNotes(notes)) {
      setErr(t('diagnostics.report.error.notesTooLong'));
      return;
    }
    // Two-step confirm for 'open' when a recent duplicate exists. The first
    // click arms the confirmation and changes the button label; the second
    // click within 60s actually submits.
    if (kind === 'open' && recentWarning && !confirmingDuplicate) {
      setConfirmingDuplicate(true);
      setConfirmSecondsLeft(CONFIRM_SECONDS);
      if (confirmTimeoutRef.current !== null) clearTimeout(confirmTimeoutRef.current);
      if (confirmIntervalRef.current !== null) clearInterval(confirmIntervalRef.current);
      confirmTimeoutRef.current = setTimeout(() => {
        setConfirmingDuplicate(false);
        setConfirmSecondsLeft(CONFIRM_SECONDS);
        confirmTimeoutRef.current = null;
        if (confirmIntervalRef.current !== null) {
          clearInterval(confirmIntervalRef.current);
          confirmIntervalRef.current = null;
        }
      }, CONFIRM_SECONDS * 1000);
      confirmIntervalRef.current = setInterval(() => {
        setConfirmSecondsLeft((s) => (s > 1 ? s - 1 : 1));
      }, 1000);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const result = await reportDiagnosticEvent(buildReportInput(error, notes, include));
      // Bundle is on disk regardless of whether the follow-up (browser open /
      // clipboard write) succeeds. Show the "bundle saved" toast first so the
      // user always has a path to the file, then do the side-effect — if the
      // side-effect fails, append a helper toast with the recovery step.
      const bundleToast = () =>
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
        let openFailed = false;
        try {
          await window.codesign?.openExternal?.(result.issueUrl);
        } catch {
          openFailed = true;
        }
        bundleToast();
        if (openFailed) {
          pushToast({
            variant: 'error',
            title: t('diagnostics.report.openFailedTitle'),
            description: t('diagnostics.report.openFailedCopyHint'),
            action: {
              label: t('diagnostics.report.copyIssueUrl'),
              onClick: () => {
                void navigator.clipboard?.writeText?.(result.issueUrl);
              },
            },
          });
        }
        onClose();
      } else {
        let clipboardFailed = false;
        try {
          await navigator.clipboard.writeText(result.summaryMarkdown);
        } catch {
          clipboardFailed = true;
        }
        bundleToast();
        if (clipboardFailed) {
          pushToast({
            variant: 'error',
            title: t('diagnostics.report.clipboardFailedTitle'),
            description: t('diagnostics.report.clipboardFailedHint'),
          });
        }
        setCopied(true);
        setTimeout(() => onClose(), 800);
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      if (raw.includes('notes') && raw.includes('2000')) {
        setErr(t('diagnostics.report.error.notesTooLong'));
      } else {
        setErr(t('diagnostics.report.error.generic'));
      }
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
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-[var(--radius-2xl)] bg-[var(--color-background)] border border-[var(--color-border)] shadow-[var(--shadow-elevated)] p-6 space-y-4 animate-[panel-in_160ms_ease-out]"
      >
        <h3 className="text-[var(--text-md)] font-medium text-[var(--color-text-primary)]">
          {t('diagnostics.report.title')}
        </h3>

        <pre className="text-[var(--text-xs)] font-mono bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-3 whitespace-pre-wrap break-words text-[var(--color-text-primary)] max-h-48 overflow-auto">
          {formatPreview(
            error,
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
              upstreamProvider: t('diagnostics.report.preview.upstreamProvider'),
              upstreamStatus: t('diagnostics.report.preview.upstreamStatus'),
              upstreamRequestId: t('diagnostics.report.preview.upstreamRequestId'),
              upstreamRetry: t('diagnostics.report.preview.upstreamRetry'),
              upstreamBodyHead: t('diagnostics.report.preview.upstreamBodyHead'),
            },
          )}
        </pre>

        {recentWarning && !warningDismissed ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2">
            <p className="text-[var(--text-sm)] text-[var(--color-text-primary)]">
              <span aria-hidden="true">⚠️ </span>
              {recentWarning.issueNumber
                ? t('diagnostics.report.recentlyReported', {
                    relative: recentWarning.relative,
                    issueNumber: recentWarning.issueNumber,
                  })
                : t('diagnostics.report.recentlyReportedNoNumber', {
                    relative: recentWarning.relative,
                  })}
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
          <div
            className={`text-[var(--text-xs)] text-right mt-1 ${
              notes.length > MAX_NOTES * 0.95
                ? 'text-[var(--color-error)]'
                : 'text-[var(--color-text-muted)]'
            }`}
            aria-live="polite"
          >
            {notes.length}/{MAX_NOTES}
          </div>
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
          {busy ? (
            <span
              role="status"
              aria-live="polite"
              className="text-[var(--text-xs)] text-[var(--color-text-muted)] mr-auto"
            >
              {t('diagnostics.report.generating')}
            </span>
          ) : null}
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
            {confirmingDuplicate
              ? t('diagnostics.report.confirmOpenAnyway', { seconds: confirmSecondsLeft })
              : t('diagnostics.report.openIssue')}
          </button>
        </div>
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
