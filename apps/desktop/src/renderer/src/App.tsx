import { buildSrcdoc, isIframeErrorMessage } from '@open-codesign/runtime';
import { BUILTIN_DEMOS } from '@open-codesign/templates';
import { Button } from '@open-codesign/ui';
import { Send, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CanvasErrorBar } from './components/CanvasErrorBar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useCodesignStore } from './store';

export function App() {
  return (
    <ErrorBoundary scope="App shell">
      <div className="h-full grid grid-cols-[380px_1fr] bg-[var(--color-background)]">
        <ErrorBoundary scope="Sidebar">
          <Sidebar />
        </ErrorBoundary>
        <ErrorBoundary scope="Preview">
          <PreviewPane />
        </ErrorBoundary>
      </div>
    </ErrorBoundary>
  );
}

function Sidebar() {
  const messages = useCodesignStore((s) => s.messages);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const sendPrompt = useCodesignStore((s) => s.sendPrompt);
  const cancelGeneration = useCodesignStore((s) => s.cancelGeneration);
  const statusLines = useCodesignStore((s) => s.statusLines);
  const rateLimitedUntil = useCodesignStore((s) => s.rateLimitedUntil);
  const clearRateLimit = useCodesignStore((s) => s.clearRateLimit);
  const [prompt, setPrompt] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || isGenerating) return;
    void sendPrompt(prompt);
    setPrompt('');
  }

  return (
    <aside className="flex flex-col border-r border-[var(--color-border)] bg-[var(--color-background-secondary)]">
      <ErrorBoundary scope="TopBar">
        <TopBar />
      </ErrorBoundary>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.length === 0 ? (
          <div>
            <p className="text-sm text-[var(--color-text-secondary)] mb-3">Try a starter prompt:</p>
            <ul className="space-y-2">
              {BUILTIN_DEMOS.map((demo) => (
                <li key={demo.id}>
                  <button
                    type="button"
                    onClick={() => setPrompt(demo.prompt)}
                    className="w-full text-left px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors"
                  >
                    <div className="text-sm font-medium text-[var(--color-text-primary)]">
                      {demo.title}
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                      {demo.description}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: tier-1 chat list with no reordering
              key={`${m.role}-${i}`}
              className={`px-3 py-2 rounded-[var(--radius-md)] text-sm ${
                m.role === 'user'
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                  : 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)]'
              }`}
            >
              {m.content}
            </div>
          ))
        )}

        {statusLines.length > 0 && (
          <ul className="space-y-1 pt-2 border-t border-[var(--color-border-subtle)]">
            {statusLines.slice(-5).map((line) => (
              <li
                key={line.id}
                className={`text-xs ${
                  line.kind === 'error'
                    ? 'text-[var(--color-error)]'
                    : line.kind === 'warn'
                      ? 'text-[var(--color-warning)]'
                      : 'text-[var(--color-text-muted)]'
                }`}
              >
                {line.text}
              </li>
            ))}
          </ul>
        )}

        {rateLimitedUntil !== null && rateLimitedUntil > Date.now() && (
          <RateLimitToast until={rateLimitedUntil} onDismiss={clearRateLimit} />
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-[var(--color-border)] p-3 flex gap-2"
      >
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what to design…"
          disabled={isGenerating}
          className="flex-1 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
        />
        {isGenerating ? (
          <Button type="button" variant="secondary" size="md" onClick={cancelGeneration}>
            Cancel
          </Button>
        ) : (
          <Button type="submit" size="md" disabled={!prompt.trim()}>
            <Send className="w-4 h-4" />
          </Button>
        )}
      </form>
    </aside>
  );
}

function TopBar() {
  return (
    <header className="px-5 py-4 border-b border-[var(--color-border)]">
      <div className="flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-[var(--color-accent)]" />
        <span className="font-semibold text-[var(--color-text-primary)]">open-codesign</span>
        <span className="ml-auto text-xs text-[var(--color-text-muted)]">pre-alpha</span>
      </div>
    </header>
  );
}

function PreviewPane() {
  const previewHtml = useCodesignStore((s) => s.previewHtml);
  const appendIframeError = useCodesignStore((s) => s.appendIframeError);

  useEffect(() => {
    function handler(ev: MessageEvent) {
      if (isIframeErrorMessage(ev.data)) {
        const loc =
          ev.data.source && ev.data.lineno !== undefined
            ? ` (${ev.data.source}:${ev.data.lineno}${
                ev.data.colno !== undefined ? `:${ev.data.colno}` : ''
              })`
            : '';
        appendIframeError(`${ev.data.message}${loc}`);
      }
    }
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [appendIframeError]);

  return (
    <main className="flex flex-col">
      <header className="h-12 px-5 border-b border-[var(--color-border)] flex items-center justify-between">
        <span className="text-sm text-[var(--color-text-secondary)]">
          {previewHtml ? 'Preview' : 'No design yet'}
        </span>
        <span className="text-xs text-[var(--color-text-muted)]">
          BYOK · local-first · multi-model
        </span>
      </header>
      <CanvasErrorBar />
      <div className="flex-1 p-6 overflow-auto">
        {previewHtml ? (
          <iframe
            key={previewHtml.length}
            title="design-preview"
            sandbox="allow-scripts"
            srcDoc={buildSrcdoc(previewHtml)}
            className="w-full h-full bg-white rounded-[var(--radius-2xl)] shadow-[var(--shadow-card)] border border-[var(--color-border)]"
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-md">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center">
                <Sparkles className="w-7 h-7 text-[var(--color-accent)]" />
              </div>
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
                Design with AI
              </h2>
              <p className="text-sm text-[var(--color-text-secondary)]">
                Pick a starter on the left, or describe what you want to design. The result renders
                here in a sandboxed preview.
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function RateLimitToast({ until, onDismiss }: { until: number; onDismiss: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const remainingMs = Math.max(0, until - now);
  const seconds = Math.ceil(remainingMs / 1000);
  const target = new Date(until);
  const hh = String(target.getHours()).padStart(2, '0');
  const mm = String(target.getMinutes()).padStart(2, '0');
  const ss = String(target.getSeconds()).padStart(2, '0');

  return (
    <div
      role="alert"
      className="rounded-[var(--radius-md)] border border-[var(--color-error)] bg-[color-mix(in_srgb,var(--color-error)_8%,var(--color-surface))] p-3 flex items-start gap-3"
    >
      <div className="flex-1">
        <div className="text-xs uppercase tracking-wide font-semibold text-[var(--color-error)] mb-1">
          Rate limited
        </div>
        <div className="text-sm text-[var(--color-text-primary)]">
          Provider asked us to slow down. Retrying after {hh}:{mm}:{ss} ({seconds}s).
        </div>
        <div className="mt-2 flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              // Tier-1: switching models is a Settings concern (wt/preview-ux owns
              // the picker). For now we just dismiss and trust the user to reopen
              // settings; the toast tells them what to do next.
              onDismiss();
            }}
          >
            Switch model
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
