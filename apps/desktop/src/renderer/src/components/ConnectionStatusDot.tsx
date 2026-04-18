import { useT } from '@open-codesign/i18n';
import { useEffect, useRef } from 'react';
import { useCodesignStore } from '../store';

const STALE_MS = 5 * 60 * 1000;

function formatRelativeTime(ts: number): string {
  const diffSec = Math.round((Date.now() - ts) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.round(diffMin / 60)}h ago`;
}

const DOT_COLORS: Record<string, string> = {
  connected: 'var(--color-success)',
  untested: 'var(--color-warning)',
  error: 'var(--color-error)',
  no_provider: 'var(--color-text-muted)',
};

export function ConnectionStatusDot() {
  const t = useT();
  const connectionStatus = useCodesignStore((s) => s.connectionStatus);
  const testConnection = useCodesignStore((s) => s.testConnection);
  const config = useCodesignStore((s) => s.config);
  const configLoaded = useCodesignStore((s) => s.configLoaded);

  // Keep a stable ref so the effect doesn't re-run when testConnection identity changes.
  const testConnectionRef = useRef(testConnection);
  testConnectionRef.current = testConnection;

  const configRef = useRef(config);
  configRef.current = config;

  const connectionStatusRef = useRef(connectionStatus);
  connectionStatusRef.current = connectionStatus;

  // Auto-test once after config loads if provider is configured and status is stale.
  useEffect(() => {
    if (!configLoaded) return;
    const cfg = configRef.current;
    if (!cfg?.hasKey || cfg.provider === null) return;
    const { state, lastTestedAt } = connectionStatusRef.current;
    const isStale = lastTestedAt === null || Date.now() - lastTestedAt > STALE_MS;
    if (state === 'untested' || state === 'no_provider' || isStale) {
      void testConnectionRef.current();
    }
  }, [configLoaded]);

  const { state, lastTestedAt, lastError } = connectionStatus;
  const dotColor = DOT_COLORS[state] ?? 'var(--color-text-muted)';

  function buildTooltip(): string {
    const parts: string[] = [];
    const stateLabel = t(`topbar.status.${state === 'no_provider' ? 'noProvider' : state}`);
    parts.push(stateLabel);
    if (lastTestedAt !== null) {
      parts.push(t('topbar.status.lastTested', { time: formatRelativeTime(lastTestedAt) }));
    }
    if (state === 'error' && lastError) {
      parts.push(lastError);
    }
    if (state !== 'no_provider') {
      parts.push(t('topbar.status.tooltip.click'));
    }
    return parts.join(' · ');
  }

  if (state === 'no_provider' && !config?.hasKey) {
    return null;
  }

  return (
    <span className="relative inline-flex items-center group">
      <button
        type="button"
        aria-label={buildTooltip()}
        onClick={() => void testConnection()}
        className="flex items-center justify-center w-5 h-5 rounded-full hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        <span style={{ backgroundColor: dotColor }} className="block w-2.5 h-2.5 rounded-full" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 z-50 whitespace-nowrap max-w-xs rounded-[var(--radius-sm)] bg-[var(--color-text-primary)] px-2 py-1 text-[11px] font-medium text-[var(--color-background)] opacity-0 transition-opacity duration-150 delay-[400ms] group-hover:opacity-100 shadow-[var(--shadow-card)]"
      >
        {buildTooltip()}
      </span>
    </span>
  );
}
