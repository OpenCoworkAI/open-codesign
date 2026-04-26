import { useT } from '@open-codesign/i18n';
import { Tooltip } from '@open-codesign/ui';
import { ArrowUp, Square } from 'lucide-react';
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

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

export interface PromptInputProps {
  prompt: string;
  setPrompt: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isGenerating: boolean;
  /** Optional content rendered above the textarea, inside the composer card. */
  contextSummary?: ReactNode;
  /** Optional element rendered inside the textarea container, bottom-left. */
  leadingAction?: ReactNode;
}

export interface PromptInputHandle {
  focus: () => void;
}

/**
 * Prompt textarea + send/stop button. Extracted from Sidebar.tsx so the
 * chat pane can be rewritten without disturbing the send-path keybindings.
 *
 * Keybindings:
 *   Enter           — submit (unless Shift/Meta/Ctrl held)
 *   Meta/Ctrl+Enter — submit (power-user muscle memory)
 *   Shift+Enter     — newline
 */
export const PromptInput = forwardRef<PromptInputHandle, PromptInputProps>(function PromptInput(
  { prompt, setPrompt, onSubmit, onCancel, isGenerating, contextSummary, leadingAction },
  ref,
) {
  const t = useT();
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (taRef.current) resizeTextarea(taRef.current);
  }, []);

  useImperativeHandle(ref, () => ({
    focus: () => {
      taRef.current?.focus();
    },
  }));

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    if (!prompt.trim() || isGenerating) return;
    onSubmit();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    const isSendCombo =
      (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) ||
      (e.key === 'Enter' && (e.metaKey || e.ctrlKey));
    if (isSendCombo) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  const canSend = prompt.trim().length > 0 && !isGenerating;
  const sendDisabledReason = isGenerating
    ? t('disabledReason.generatingInProgress')
    : t('disabledReason.typePromptToSend');

  return (
    <form onSubmit={handleSubmit}>
      <div className="relative rounded-[16px] bg-[var(--color-surface)] border-[1.5px] border-[var(--color-border-muted)] focus-within:border-[var(--color-accent)] transition-colors duration-150 ease-out">
        {contextSummary ? (
          <div className="border-b border-[var(--color-border-subtle)] px-[12px] py-[10px]">
            {contextSummary}
          </div>
        ) : null}
        <textarea
          ref={taRef}
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            resizeTextarea(e.currentTarget);
          }}
          onKeyDown={handleKeyDown}
          placeholder={t('chat.placeholderRich')}
          rows={1}
          className="codesign-prompt-textarea block w-full resize-none appearance-none border-0 bg-transparent px-[14px] pt-[12px] pb-[44px] text-[14px] leading-[1.55] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] shadow-none outline-none focus:outline-none focus:ring-0 min-h-[24px] overflow-y-auto"
          style={{ fontFamily: 'var(--font-sans)' }}
        />

        {leadingAction ? (
          <div className="absolute bottom-[8px] left-[8px]">{leadingAction}</div>
        ) : null}

        {/* Send / Stop button — bottom right, modern circular */}
        <div className="absolute bottom-[8px] right-[8px]">
          {isGenerating ? (
            <button
              type="button"
              onClick={onCancel}
              aria-label={t('chat.stop')}
              className="relative inline-flex items-center justify-center w-[32px] h-[32px] rounded-full bg-[var(--color-accent)] text-white shadow-[0_2px_6px_color-mix(in_srgb,var(--color-accent)_35%,transparent)] hover:bg-[var(--color-accent-hover)] active:scale-[0.92] transition-all duration-150"
            >
              <span
                aria-hidden
                className="absolute inset-0 rounded-full bg-[var(--color-accent)] opacity-40 animate-ping"
              />
              <Square className="relative w-[10px] h-[10px]" strokeWidth={0} fill="currentColor" />
            </button>
          ) : (
            <Tooltip label={!canSend ? sendDisabledReason : undefined} side="top">
              <button
                type="submit"
                disabled={!canSend}
                aria-label={t('chat.send')}
                className="inline-flex items-center justify-center w-[32px] h-[32px] rounded-full bg-[var(--color-accent)] text-white shadow-[0_2px_6px_color-mix(in_srgb,var(--color-accent)_30%,transparent)] hover:bg-[var(--color-accent-hover)] hover:shadow-[0_3px_10px_color-mix(in_srgb,var(--color-accent)_40%,transparent)] active:scale-[0.92] disabled:opacity-25 disabled:shadow-none disabled:cursor-not-allowed transition-all duration-150"
              >
                <ArrowUp className="w-[16px] h-[16px]" strokeWidth={2.5} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </form>
  );
});
