import { useEffect, useState } from 'react';

/**
 * Three-button bash permission dialog. Renders when the main process
 * pushes a `permission:request` event over IPC. Decision flows back via
 * `window.api.permission.resolve(requestId, scope)` where scope is one
 * of 'deny' | 'once' | 'always'.
 *
 * v0.2 / T2.1. Allowlist persistence (always-allow → workspace
 * .codesign/settings.json) lives in the main-process bridge — this
 * component only collects the user's choice.
 */

interface Pending {
  requestId: string;
  sessionId: string;
  command: string;
}

declare global {
  interface Window {
    api?: {
      permission?: {
        onRequest?: (cb: (req: Pending) => void) => () => void;
        resolve?: (requestId: string, scope: 'deny' | 'once' | 'always') => Promise<void>;
      };
    };
  }
}

export function PermissionDialog() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    const off = window.api?.permission?.onRequest?.((req) => setPending(req));
    return () => off?.();
  }, []);

  if (!pending) return null;

  function decide(scope: 'deny' | 'once' | 'always') {
    if (!pending) return;
    void window.api?.permission?.resolve?.(pending.requestId, scope);
    setPending(null);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="permission-title"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[var(--color-overlay-scrim)]"
    >
      <div className="w-[min(28rem,calc(100vw-2rem))] rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] p-[var(--space-6)] shadow-[var(--shadow-overlay)]">
        <header className="mb-[var(--space-4)] flex items-center gap-[var(--space-2)]">
          <span aria-hidden className="text-[var(--text-lg)]">
            ⚠️
          </span>
          <h2
            id="permission-title"
            className="text-[var(--text-base)] font-[var(--font-weight-semibold)] text-[var(--color-text-primary)]"
          >
            Agent wants to run a shell command
          </h2>
        </header>
        <pre className="mb-[var(--space-5)] max-h-[6rem] overflow-auto rounded-[var(--radius-md)] bg-[var(--color-surface-raised)] p-[var(--space-3)] font-[var(--font-mono)] text-[var(--text-sm)] text-[var(--color-text-primary)]">
          {pending.command}
        </pre>
        <div className="flex justify-end gap-[var(--space-2)]">
          <button
            type="button"
            onClick={() => decide('deny')}
            className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] px-[var(--space-4)] py-[var(--space-2)] text-[var(--text-sm)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={() => decide('once')}
            className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-[var(--space-4)] py-[var(--space-2)] text-[var(--text-sm)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-overlay)]"
          >
            Allow once
          </button>
          <button
            type="button"
            onClick={() => decide('always')}
            className="rounded-[var(--radius-md)] bg-[var(--color-accent)] px-[var(--space-4)] py-[var(--space-2)] text-[var(--text-sm)] font-[var(--font-weight-semibold)] text-[var(--color-text-on-accent)] hover:opacity-90"
          >
            Always allow
          </button>
        </div>
      </div>
    </div>
  );
}
