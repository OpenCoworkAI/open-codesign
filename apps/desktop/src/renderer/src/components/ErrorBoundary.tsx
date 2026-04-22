/**
 * Generic React error boundary.
 *
 * Strategy (PRINCIPLES §10): never silently swallow render exceptions.
 * If a child throws we render an actionable card with:
 *   - the error message (loud, not hidden in console)
 *   - "Reload" — re-mounts the children by bumping a key
 *   - "Copy stack" — puts message+stack into the clipboard for bug reports
 *   - "Report on GitHub" — opens a pre-filled GitHub issue in the browser
 *
 * Used both at the app shell (whole renderer) and per-pane (sidebar /
 * preview / topbar) so a single crash never blanks the entire window.
 */

import { useT } from '@open-codesign/i18n';
import { Button } from '@open-codesign/ui';
import { Component, type ErrorInfo, type ReactNode, useState } from 'react';
import { useCodesignStore } from '../store';

// Source: apps/desktop/package.json → repository.url
// Kept as a constant here so the ErrorBoundary has no runtime dependency on
// the main process — it must render even when IPC is broken.
const GITHUB_REPO_URL = 'https://github.com/OpenCoworkAI/open-codesign';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Human-readable label used in the fallback heading: "Sidebar crashed". */
  scope?: string;
  /**
   * Optional custom fallback. Receives the error and a `reset` callback
   * that re-mounts the boundary's children.
   */
  fallback?: (args: { error: Error; reset: () => void }) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  resetKey: number;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Loud surface: also log so devtools shows the boundary that caught it.
    // Tier-1 — no remote reporting, BYOK / local-first.
    console.error(`[ErrorBoundary:${this.props.scope ?? 'root'}]`, error, info.componentStack);
  }

  reset = (): void => {
    this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }));
  };

  copyStack = async (): Promise<void> => {
    const err = this.state.error;
    if (!err) return;
    const text = `${err.name}: ${err.message}\n\n${err.stack ?? '(no stack)'}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard may be blocked in the sandbox; surface a textarea fallback
      // so the user can still grab the text instead of failing silently.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        ta.remove();
      }
    }
  };

  reportOnGitHub = (): void => {
    const err = this.state.error;
    if (!err) return;

    const version = typeof __APP_VERSION__ !== 'undefined' ? String(__APP_VERSION__) : 'unknown';
    const platform = navigator.platform;
    const timestamp = new Date().toISOString();
    const stackSnippet = (err.stack ?? '(no stack)').slice(0, 3000);

    const title = `[Renderer] ${err.name}: ${err.message.slice(0, 60)}`;
    const body = [
      `**Version:** ${version}`,
      `**Platform:** ${platform}`,
      `**Timestamp:** ${timestamp}`,
      '',
      '**Error message:**',
      '```',
      err.message,
      '```',
      '',
      '**Stack trace:**',
      '```',
      stackSnippet,
      '```',
    ].join('\n');

    const url = `${GITHUB_REPO_URL}/issues/new?template=bug_report.yml&title=${encodeURIComponent(title)}&description=${encodeURIComponent(body)}`;

    // setWindowOpenHandler in main/index.ts routes window.open to shell.openExternal,
    // so this safely opens the system browser without a new Electron window.
    window.open(url, '_blank');
  };

  override render(): ReactNode {
    const { error, resetKey } = this.state;
    if (!error) {
      // Use resetKey to force remount of children after reset.
      return <ErrorBoundaryChildren key={resetKey}>{this.props.children}</ErrorBoundaryChildren>;
    }
    if (this.props.fallback) {
      return this.props.fallback({ error, reset: this.reset });
    }
    return (
      <ErrorBoundaryFallback
        error={error}
        scope={this.props.scope}
        onReset={this.reset}
        onCopyStack={() => void this.copyStack()}
        onReportOnGitHub={this.reportOnGitHub}
      />
    );
  }
}

interface ErrorBoundaryFallbackProps {
  error: Error;
  scope?: string | undefined;
  onReset: () => void;
  onCopyStack: () => void;
  onReportOnGitHub: () => void;
}

function ErrorBoundaryFallback({
  error,
  scope,
  onReset,
  onCopyStack,
  onReportOnGitHub,
}: ErrorBoundaryFallbackProps): ReactNode {
  const t = useT();
  const openReportDialog = useCodesignStore((s) => s.openReportDialog);
  const createReportableError = useCodesignStore((s) => s.createReportableError);
  // Construct the ReportableError once per mount — the localId is stable across
  // re-renders so repeat clicks open the same dialog.
  const [localId] = useState<string>(() =>
    createReportableError({
      code: error.name || 'RENDERER_ERROR',
      scope: scope ?? 'renderer',
      message: error.message,
      ...(error.stack !== undefined ? { stack: error.stack } : {}),
    }),
  );
  const scopeLabel = scope ?? t('errorBoundary.scopeFallback');
  return (
    <div className="h-full w-full flex items-center justify-center p-6 bg-[var(--color-background)]">
      <div className="max-w-md w-full rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-6">
        <div className="text-xs uppercase tracking-wide text-[var(--color-error)] font-semibold mb-2">
          {t('errorBoundary.crashedSuffix', { scope: scopeLabel })}
        </div>
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
          {error.name}: {error.message}
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">{t('errorBoundary.body')}</p>
        <pre className="text-[11px] leading-snug font-mono text-[var(--color-text-muted)] bg-[var(--color-surface-active)] border border-[var(--color-border-muted)] rounded-[var(--radius-md)] p-3 max-h-40 overflow-auto whitespace-pre-wrap">
          {error.stack ?? t('errorBoundary.noStack')}
        </pre>
        <div className="mt-4 flex flex-wrap gap-2 justify-end">
          <Button type="button" variant="secondary" size="md" onClick={onCopyStack}>
            {t('errorBoundary.copyStack')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => openReportDialog(localId)}
          >
            {t('errorBoundary.reportViaDiagnostics')}
          </Button>
          <Button type="button" variant="secondary" size="md" onClick={onReportOnGitHub}>
            {t('errorBoundary.reportOnGitHub')}
          </Button>
          <Button type="button" size="md" onClick={onReset}>
            {t('errorBoundary.reload')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ErrorBoundaryChildren({ children }: { children: ReactNode }): ReactNode {
  return children;
}
