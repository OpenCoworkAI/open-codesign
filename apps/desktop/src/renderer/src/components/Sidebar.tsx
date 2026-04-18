import { ArrowUp, FolderOpen, Link2, Paperclip, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useCodesignStore } from '../store';

export interface SidebarProps {
  prompt: string;
  setPrompt: (value: string) => void;
  onSubmit: () => void;
}

export function Sidebar({ prompt, setPrompt, onSubmit }: SidebarProps) {
  const config = useCodesignStore((s) => s.config);
  const messages = useCodesignStore((s) => s.messages);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const inputFiles = useCodesignStore((s) => s.inputFiles);
  const referenceUrl = useCodesignStore((s) => s.referenceUrl);
  const setReferenceUrl = useCodesignStore((s) => s.setReferenceUrl);
  const pickInputFiles = useCodesignStore((s) => s.pickInputFiles);
  const removeInputFile = useCodesignStore((s) => s.removeInputFile);
  const pickDesignSystemDirectory = useCodesignStore((s) => s.pickDesignSystemDirectory);
  const clearDesignSystem = useCodesignStore((s) => s.clearDesignSystem);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const designSystem = config?.designSystem ?? null;

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
      <div className="px-5 py-5 border-b border-[var(--color-border-muted)] space-y-3">
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-muted)] font-medium">
            Local Context
          </div>
          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              onClick={() => void pickInputFiles()}
              className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              <Paperclip className="w-4 h-4 text-[var(--color-text-secondary)]" />
              Attach local files
            </button>
            <button
              type="button"
              onClick={() => void pickDesignSystemDirectory()}
              className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              <FolderOpen className="w-4 h-4 text-[var(--color-text-secondary)]" />
              {designSystem ? 'Refresh design system repo' : 'Link design system repo'}
            </button>
          </div>
        </div>

        <label className="block space-y-2">
          <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-muted)] font-medium">
            <Link2 className="w-3.5 h-3.5" />
            Reference URL
          </span>
          <input
            type="url"
            value={referenceUrl}
            onChange={(e) => setReferenceUrl(e.target.value)}
            placeholder="https://example.com/reference"
            className="w-full h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-focus-ring)] transition-[box-shadow,border-color] duration-150"
          />
        </label>

        {inputFiles.length > 0 ? (
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-muted)] font-medium">
              Attached Files
            </div>
            <div className="flex flex-wrap gap-2">
              {inputFiles.map((file) => (
                <span
                  key={file.path}
                  className="inline-flex items-center gap-1.5 max-w-full rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)]"
                >
                  <span className="truncate max-w-[180px]" title={file.path}>
                    {file.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeInputFile(file.path)}
                    className="inline-flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {designSystem ? (
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[12px] font-medium text-[var(--color-text-primary)]">
                  Active design system
                </div>
                <div className="text-[11px] text-[var(--color-text-muted)] break-all">
                  {designSystem.rootPath}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void clearDesignSystem()}
                className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              >
                Clear
              </button>
            </div>
            <p className="text-[12px] text-[var(--color-text-secondary)] leading-[1.5]">
              {designSystem.summary}
            </p>
          </div>
        ) : (
          <p className="text-[12px] text-[var(--color-text-muted)] leading-[1.5]">
            Link a repo to extract colors, typography, spacing, and other styling cues for future
            generations.
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-3">
        {messages.length === 0 ? (
          <p className="text-[var(--text-sm)] text-[var(--color-text-muted)] leading-[var(--leading-body)]">
            Start with a brief, then add files, a URL, or a local repo to ground the result.
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
            placeholder="Describe what to design..."
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
              Cmd/Ctrl+Enter
            </kbd>{' '}
            anywhere
          </span>
          {isGenerating ? (
            <span className="inline-flex items-center gap-1.5 text-[var(--color-accent)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
              Working
            </span>
          ) : null}
        </div>
      </form>
    </aside>
  );
}
