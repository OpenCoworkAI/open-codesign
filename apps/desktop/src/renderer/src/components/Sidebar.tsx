import { ArrowUp } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useCodesignStore } from '../store';

export interface SidebarProps {
  prompt: string;
  setPrompt: (value: string) => void;
  onSubmit: () => void;
}

export function Sidebar({ prompt, setPrompt, onSubmit }: SidebarProps) {
  const messages = useCodesignStore((s) => s.messages);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || isGenerating) return;
    onSubmit();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  const canSend = prompt.trim().length > 0 && !isGenerating;

  return (
    <aside className="flex flex-col border-r border-[var(--color-border)] bg-[var(--color-background-secondary)] min-h-0">
      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-3">
        {messages.length === 0 ? (
          <p className="text-[var(--text-sm)] text-[var(--color-text-muted)] leading-[var(--leading-body)]">
            Start a conversation. Pick a starter from the preview pane, or type your brief.
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={`${m.role}-${i}-${m.content.slice(0, 8)}`}
              className={`px-4 py-3 rounded-[var(--radius-lg)] text-[var(--text-sm)] leading-[1.55] ${
                m.role === 'user'
                  ? 'bg-[var(--color-accent-soft)] text-[var(--color-text-primary)] border border-[var(--color-accent-muted)]'
                  : 'bg-[var(--color-surface)] border border-[var(--color-border-muted)] text-[var(--color-text-primary)]'
              }`}
            >
              {m.content}
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-[var(--color-border-muted)] p-4">
        <div className="relative flex items-end gap-2 p-2 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] focus-within:border-[var(--color-accent)] focus-within:shadow-[0_0_0_3px_var(--color-focus-ring)] transition-[box-shadow,border-color] duration-150 ease-[var(--ease-out)]">
          <textarea
            ref={taRef}
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              e.currentTarget.style.height = 'auto';
              e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 160)}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder="Describe what to design…"
            disabled={isGenerating}
            rows={1}
            className="flex-1 resize-none bg-transparent px-2 py-1 text-[var(--text-sm)] leading-[1.5] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none min-h-[24px] max-h-[160px]"
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send prompt"
            className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-white shadow-[var(--shadow-soft)] hover:bg-[var(--color-accent-hover)] hover:scale-[1.04] active:scale-[0.96] disabled:opacity-30 disabled:hover:scale-100 disabled:pointer-events-none transition-[transform,background-color,opacity] duration-150 ease-[var(--ease-out)]"
          >
            <ArrowUp className="w-4 h-4" strokeWidth={2.4} />
          </button>
        </div>
        <div className="mt-2 px-1 text-[11px] text-[var(--color-text-muted)] flex items-center justify-between">
          <span>
            <kbd
              className="px-[5px] py-[1px] rounded-[4px] bg-[var(--color-surface-active)] text-[10px] text-[var(--color-text-secondary)]"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              Enter
            </kbd>{' '}
            send ·{' '}
            <kbd
              className="px-[5px] py-[1px] rounded-[4px] bg-[var(--color-surface-active)] text-[10px] text-[var(--color-text-secondary)]"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              ⌘↵
            </kbd>{' '}
            anywhere
          </span>
          {isGenerating ? (
            <span className="inline-flex items-center gap-1.5 text-[var(--color-accent)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
              Generating
            </span>
          ) : null}
        </div>
      </form>
    </aside>
  );
}
