import { Button } from '@open-codesign/ui';
import { Send } from 'lucide-react';
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <aside className="flex flex-col border-r border-[var(--color-border)] bg-[var(--color-background-secondary)]">
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {messages.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)] px-1">
            Start a conversation. Try a starter from the preview pane, or type your own brief.
          </p>
        ) : (
          messages.map((m, i) => (
            <div
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
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-[var(--color-border)] p-3 flex gap-2"
      >
        <input
          ref={inputRef}
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what to design…"
          disabled={isGenerating}
          className="flex-1 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
        />
        <Button type="submit" size="md" disabled={isGenerating || !prompt.trim()}>
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </aside>
  );
}
