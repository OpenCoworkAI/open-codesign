import { useT } from '@open-codesign/i18n';
import { type DiagnoseContext, type DiagnosticHypothesis, diagnose } from '@open-codesign/shared';
import type { ErrorCode } from '@open-codesign/shared';
import { AlertCircle, ExternalLink, FileText, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import { useCodesignStore } from '../store';

/** A baseUrlTransform suggestion (e.g. append "/v1") only makes sense when
 * the user already has a real absolute URL — otherwise we'd write "/v1" by itself. */
export function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+/i.test(value.trim());
}

export interface ConnectionDiagnosticPanelProps {
  /** The error code returned by connection.test or generate */
  errorCode: ErrorCode;
  /** HTTP status string such as "HTTP 404", if available */
  httpStatus?: string;
  /** The URL that was attempted */
  attemptedUrl?: string;
  /** Current baseUrl value so transform can produce a suggestion */
  baseUrl: string;
  /** Provider ID for context */
  provider: string;
  /** Called when the user clicks "Apply this fix" with a baseUrl transform */
  onApplyFix: (newBaseUrl: string) => void;
  /** Called when the user clicks "Test again" */
  onTestAgain: () => void;
  /** Called when the user dismisses the panel */
  onDismiss?: () => void;
  /** Path to the log file — passed to shell.openPath via IPC */
  logsPath?: string;
}

export function ConnectionDiagnosticPanel({
  errorCode,
  httpStatus,
  attemptedUrl,
  baseUrl,
  provider,
  onApplyFix,
  onTestAgain,
  onDismiss,
  logsPath,
}: ConnectionDiagnosticPanelProps) {
  const t = useT();
  const reportableErrorToast = useCodesignStore((s) => s.reportableErrorToast);
  const [fixApplied, setFixApplied] = useState(false);

  const ctx: DiagnoseContext = { provider, baseUrl };
  const hypotheses: DiagnosticHypothesis[] = diagnose(errorCode, ctx);
  const primary = hypotheses[0];
  const fix = primary?.suggestedFix;

  const canTransformBaseUrl = isAbsoluteHttpUrl(baseUrl);
  const suggestedUrl =
    fix?.baseUrlTransform !== undefined && canTransformBaseUrl
      ? fix.baseUrlTransform(baseUrl)
      : undefined;
  const canApplyFix = suggestedUrl !== undefined || fix?.externalUrl !== undefined;

  function handleApplyFix() {
    if (suggestedUrl !== undefined) {
      onApplyFix(suggestedUrl);
      setFixApplied(true);
    } else if (fix?.externalUrl !== undefined) {
      window.open(fix.externalUrl, '_blank', 'noopener,noreferrer');
    }
  }

  async function handleShowLog() {
    if (!logsPath || !window.codesign) return;
    try {
      await window.codesign.settings.openFolder(logsPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open logs folder';
      reportableErrorToast({
        code: 'OPEN_LOG_FOLDER_FAILED',
        scope: 'settings',
        title: t('diagnostics.showLogFailed'),
        description: message,
        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
      });
    }
  }

  const displayStatus = httpStatus ?? errorCode;

  return (
    <div
      role="alert"
      className="rounded-[var(--radius-lg)] border border-[var(--color-error)] bg-[var(--color-error-soft,var(--color-surface))] p-4 space-y-3 text-[var(--text-sm)]"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-[var(--color-error)] font-semibold">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{t('diagnostics.title')}</span>
        </div>
        {onDismiss !== undefined && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t('diagnostics.dismiss')}
            className="p-1 rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Divider */}
      <hr className="border-[var(--color-error)]" />

      {/* Details */}
      <div className="space-y-1.5 text-[var(--color-text-secondary)]">
        <p>
          <span className="font-medium text-[var(--color-text-primary)]">
            {t('diagnostics.status', { status: displayStatus })}
          </span>
        </p>
        {attemptedUrl !== undefined && (
          <p className="font-mono text-[var(--text-xs)] text-[var(--color-text-muted)] break-all">
            {t('diagnostics.attempted', { url: attemptedUrl })}
          </p>
        )}
        {primary !== undefined && (
          <p className="mt-2">
            <span className="font-medium text-[var(--color-text-primary)]">
              {t('diagnostics.mostLikelyCause')}{' '}
            </span>
            {t(primary.cause)}
          </p>
        )}
        {suggestedUrl !== undefined && (
          <p className="font-mono text-[var(--text-xs)] text-[var(--color-accent)] break-all">
            {t('diagnostics.fix.addV1')}: {suggestedUrl}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {fix !== undefined && !fixApplied && (
          <button
            type="button"
            onClick={handleApplyFix}
            disabled={!canApplyFix}
            title={canApplyFix ? undefined : t('diagnostics.setBaseUrlFirst')}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[var(--text-xs)] font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:opacity-50"
          >
            {fix.externalUrl !== undefined && <ExternalLink className="w-3 h-3" />}
            {t(fix.label)}
          </button>
        )}
        {fixApplied && (
          <span className="text-[var(--text-xs)] text-[var(--color-success)] font-medium">
            {t('common.applied')}
          </span>
        )}
        <button
          type="button"
          onClick={onTestAgain}
          className="inline-flex items-center gap-1.5 h-7 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--text-xs)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          {t('diagnostics.testAgain')}
        </button>
        {logsPath !== undefined && (
          <button
            type="button"
            onClick={() => void handleShowLog()}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--text-xs)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <FileText className="w-3 h-3" />
            {t('diagnostics.showLog')}
          </button>
        )}
      </div>
    </div>
  );
}
