import { ArrowUp, Square } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useCodesignStore } from '../store';

export interface SidebarProps {
  prompt: string;
  setPrompt: (value: string) => void;
  onSubmit: () => void;
}

const MAX_TEXTAREA_HEIGHT = 144; // 6 lines × ~24px

function resizeTextarea(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
}

export function Sidebar({ prompt, setPrompt, onSubmit }: SidebarProps) {
  const messages = useCodesignStore((s) => s.messages);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const cancelGeneration = useCodesignStore((s) => s.cancelGeneration);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // sync height on mount to match any pre-filled value
    if (taRef.current) resizeTextarea(taRef.current);
  }, []);

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!prompt.trim() || isGenerating) return;
    onSubmit();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
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
        <div className="relative rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] focus-within:border-[var(--color-accent)] focus-within:shadow-[0_0_0_3px_var(--color-focus-ring)] transition-[box-shadow,border-color] duration-150 ease-[var(--ease-out)]">
          <textarea
            ref={taRef}
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              resizeTextarea(e.currentTarget);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Describe what to design… (Enter to send, Shift+Enter for newline)"
            disabled={isGenerating}
            rows={1}
            className="block w-full resize-none bg-transparent px-3 pt-3 pb-10 text-[var(--text-sm)] leading-[1.5] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none min-h-[24px] max-h-[144px] overflow-y-auto"
          />

          {/* action button pinned to bottom-right inside the textarea container */}
          <div className="absolute bottom-2 right-2">
            {isGenerating ? (
              <button
                type="button"
                onClick={cancelGeneration}
                aria-label="Stop generation"
                className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] hover:scale-[1.04] active:scale-[0.96] transition-[transform,background-color] duration-150 ease-[var(--ease-out)]"
              >
                <Square className="w-3.5 h-3.5" strokeWidth={0} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                aria-label="Send prompt"
                className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-white shadow-[var(--shadow-soft)] hover:bg-[var(--color-accent-hover)] hover:scale-[1.04] active:scale-[0.96] disabled:opacity-30 disabled:hover:scale-100 disabled:pointer-events-none transition-[transform,background-color,opacity] duration-150 ease-[var(--ease-out)]"
              >
                <ArrowUp className="w-3.5 h-3.5" strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </form>
    </aside>
  );
}
