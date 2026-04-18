import { IconButton } from '@open-codesign/ui';
import { ArrowUp, Square } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useEffect, useRef } from 'react';
import { useCodesignStore } from '../store';

export interface SidebarProps {
  prompt: string;
  setPrompt: (value: string) => void;
  onSubmit: () => void;
}

const MAX_TEXTAREA_ROWS = 6;
const FALLBACK_FONT_SIZE = 13;
const FALLBACK_LINE_HEIGHT_MULTIPLIER = 1.6;

export function getTextareaLineHeight(el: HTMLTextAreaElement): number {
  const styles = getComputedStyle(el);
  const lineHeight = Number.parseFloat(styles.lineHeight);
  if (Number.isFinite(lineHeight) && lineHeight > 0) return lineHeight;

  const fontSize = Number.parseFloat(styles.fontSize);
  const leading = Number.parseFloat(styles.getPropertyValue('--leading-body'));
  const resolvedFontSize =
    Number.isFinite(fontSize) && fontSize > 0 ? fontSize : FALLBACK_FONT_SIZE;
  const resolvedLeading =
    Number.isFinite(leading) && leading > 0 ? leading : FALLBACK_LINE_HEIGHT_MULTIPLIER;

  return resolvedFontSize * resolvedLeading;
}

function resizeTextarea(el: HTMLTextAreaElement): void {
  const rowHeight = getTextareaLineHeight(el);
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, rowHeight * MAX_TEXTAREA_ROWS)}px`;
}

export function Sidebar({ prompt, setPrompt, onSubmit }: SidebarProps) {
  const messages = useCodesignStore((s) => s.messages);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const cancelGeneration = useCodesignStore((s) => s.cancelGeneration);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (taRef.current) resizeTextarea(taRef.current);
  }, []);

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    if (!prompt.trim() || isGenerating) return;
    onSubmit();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  const canSend = prompt.trim().length > 0 && !isGenerating;

  return (
    <aside className="flex flex-col min-h-0 border-r border-[var(--color-border)] bg-[var(--color-background-secondary)]">
      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-3">
        {messages.length === 0 ? (
          <p className="text-[var(--text-sm)] text-[var(--color-text-muted)] leading-[var(--leading-body)]">
            Start a conversation. Pick a starter from the preview pane, or type your brief.
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={`${m.role}-${i}-${m.content.slice(0, 8)}`}
              className={`px-[var(--space-4)] py-[var(--space-3)] rounded-[var(--radius-lg)] text-[var(--text-sm)] leading-[var(--leading-body)] ${
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
            placeholder="Describe what to design... (Enter to send, Shift+Enter for newline)"
            disabled={isGenerating}
            rows={1}
            className="block w-full resize-none bg-transparent px-[var(--space-3)] pt-[var(--space-3)] pb-[calc(var(--space-6)+var(--space-4))] text-[var(--text-sm)] leading-[var(--leading-body)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none min-h-[var(--space-6)] overflow-y-auto"
          />

          <div className="absolute bottom-[var(--space-2)] right-[var(--space-2)]">
            {isGenerating ? (
              <IconButton
                size="sm"
                label="Stop generation"
                onClick={cancelGeneration}
                className="bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] hover:text-white hover:scale-[1.04] active:scale-[0.96] transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)]"
              >
                <Square className="w-4 h-4" strokeWidth={0} fill="currentColor" />
              </IconButton>
            ) : (
              <IconButton
                size="sm"
                type="submit"
                label="Send prompt"
                disabled={!canSend}
                className="bg-[var(--color-accent)] text-white shadow-[var(--shadow-soft)] hover:bg-[var(--color-accent-hover)] hover:text-white hover:scale-[1.04] active:scale-[0.96] disabled:opacity-30 disabled:hover:scale-100 transition-[transform,background-color,opacity,color] duration-150 ease-[var(--ease-out)]"
              >
                <ArrowUp className="w-4 h-4" strokeWidth={2.4} />
              </IconButton>
            )}
          </div>
        </div>
      </form>
    </aside>
  );
}
