import { useT } from '@open-codesign/i18n';
import { IconButton } from '@open-codesign/ui';
import { ArrowUp, FolderOpen, Link2, Paperclip, Square, X } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useEffect, useRef } from 'react';
import { useCodesignStore } from '../store';

export interface SidebarProps {
  prompt: string;
  setPrompt: (value: string) => void;
  onSubmit: () => void;
}

const MAX_TEXTAREA_ROWS = 6;

export function getTextareaLineHeight(el: HTMLTextAreaElement): number {
  const styles = getComputedStyle(el);
  const lineHeight = Number.parseFloat(styles.lineHeight);
  if (Number.isFinite(lineHeight) && lineHeight > 0) return lineHeight;

  const fontSize = Number.parseFloat(styles.fontSize);
  const leading = Number.parseFloat(styles.getPropertyValue('--leading-body'));
  if (!Number.isFinite(fontSize) || fontSize <= 0 || !Number.isFinite(leading) || leading <= 0) {
    throw new Error('Textarea sizing tokens (--leading-body / fontSize) are missing or invalid');
  }
  return fontSize * leading;
}

function resizeTextarea(el: HTMLTextAreaElement): void {
  const rowHeight = getTextareaLineHeight(el);
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, rowHeight * MAX_TEXTAREA_ROWS)}px`;
}

export function Sidebar({ prompt, setPrompt, onSubmit }: SidebarProps) {
  const t = useT();
  const config = useCodesignStore((s) => s.config);
  const messages = useCodesignStore((s) => s.messages);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const cancelGeneration = useCodesignStore((s) => s.cancelGeneration);
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
      <div className="px-5 py-5 border-b border-[var(--color-border-muted)] space-y-3">
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-muted)] font-medium">
            {t('sidebar.localContext')}
          </div>
          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              onClick={() => void pickInputFiles()}
              className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              <Paperclip className="w-4 h-4 text-[var(--color-text-secondary)]" />
              {t('sidebar.attachLocalFiles')}
            </button>
            <button
              type="button"
              onClick={() => void pickDesignSystemDirectory()}
              className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              <FolderOpen className="w-4 h-4 text-[var(--color-text-secondary)]" />
              {designSystem
                ? t('sidebar.refreshDesignSystemRepo')
                : t('sidebar.linkDesignSystemRepo')}
            </button>
          </div>
        </div>

        <label className="block space-y-2">
          <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-muted)] font-medium">
            <Link2 className="w-3.5 h-3.5" />
            {t('sidebar.referenceUrl')}
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
              {t('sidebar.attachedFiles')}
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
                    aria-label={t('sidebar.removeFile', { name: file.name })}
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
                  {t('sidebar.activeDesignSystem')}
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
                {t('sidebar.clear')}
              </button>
            </div>
            <p className="text-[12px] text-[var(--color-text-secondary)] leading-[1.5]">
              {designSystem.summary}
            </p>
          </div>
        ) : (
          <p className="text-[12px] text-[var(--color-text-muted)] leading-[1.5]">
            {t('sidebar.designSystemHint')}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-3">
        {messages.length === 0 ? (
          <p className="text-[var(--text-sm)] text-[var(--color-text-muted)] leading-[var(--leading-body)]">
            {t('sidebar.startHint')}
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={`${m.role}-${i}-${m.content.slice(0, 8)}`}
              className={`px-[var(--space-4)] py-[var(--space-3)] rounded-[var(--radius-lg)] text-[var(--text-sm)] leading-[var(--leading-body)] whitespace-pre-wrap break-words ${
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
            placeholder="Describe a design… try 'Pitch deck for a fintech startup'"
            disabled={isGenerating}
            rows={1}
            className="block w-full resize-none bg-transparent px-[var(--space-3)] pt-[var(--space-3)] pb-[calc(var(--space-6)+var(--space-4))] text-[var(--text-sm)] leading-[var(--leading-body)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none min-h-[var(--space-6)] overflow-y-auto"
          />

          <div className="absolute bottom-[var(--space-2)] right-[var(--space-2)]">
            {isGenerating ? (
              <IconButton
                size="sm"
                label={t('chat.stop')}
                onClick={cancelGeneration}
                className="bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] hover:text-[var(--color-on-accent)] hover:scale-[1.04] active:scale-[0.96] transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)]"
              >
                <Square className="w-4 h-4" strokeWidth={0} fill="currentColor" />
              </IconButton>
            ) : (
              <IconButton
                size="sm"
                type="submit"
                label={t('chat.send')}
                disabled={!canSend}
                className="bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-[var(--shadow-soft)] hover:bg-[var(--color-accent-hover)] hover:text-[var(--color-on-accent)] hover:scale-[1.04] active:scale-[0.96] disabled:opacity-30 disabled:hover:scale-100 transition-[transform,background-color,opacity,color] duration-150 ease-[var(--ease-out)]"
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
