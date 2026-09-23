import { useT } from '@open-codesign/i18n';
import type { ActiveRunMessageV1 } from '@open-codesign/shared';
import { Tooltip } from '@open-codesign/ui';
import { ArrowUp, CircleHelp, Square } from 'lucide-react';
import {
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  forwardRef,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type {
  WorkspaceImportBlobInput,
  WorkspaceImportFileInput,
  WorkspaceImportSource,
} from '../../../../preload';
import {
  clipboardFilesToWorkspaceBlobs,
  dataTransferFilesToWorkspaceFiles,
} from '../../lib/file-ingest';
import { useCodesignStore } from '../../store';
import './PromptInput.css';

const MAX_TEXTAREA_ROWS = 10;

export interface PromptKeyInput {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  isComposing?: boolean;
  nativeIsComposing?: boolean;
  keyCode?: number;
  nativeKeyCode?: number;
}

export function shouldSubmitPromptKey(input: PromptKeyInput, compositionActive = false): boolean {
  if (input.key !== 'Enter') return false;
  if (
    compositionActive ||
    input.isComposing === true ||
    input.nativeIsComposing === true ||
    input.keyCode === 229 ||
    input.nativeKeyCode === 229
  ) {
    return false;
  }
  if (input.shiftKey === true) return false;
  return true;
}

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

export function getTextareaVerticalPadding(el: HTMLTextAreaElement): number {
  const styles = getComputedStyle(el);
  const top = Number.parseFloat(styles.paddingTop);
  const bottom = Number.parseFloat(styles.paddingBottom);
  return (Number.isFinite(top) ? top : 0) + (Number.isFinite(bottom) ? bottom : 0);
}

export function elapsedSecondsSince(
  startedAt: number | null | undefined,
  now = Date.now(),
): number {
  if (startedAt === null || startedAt === undefined) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

export function formatElapsedSeconds(elapsedSec: number): string {
  return elapsedSec < 60
    ? `${elapsedSec}s`
    : `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, '0')}`;
}

export function getPromptHeightLimit(
  rowHeight: number,
  verticalPadding: number,
  sidebarHeight: number,
  otherComposerHeight: number,
): number {
  return Math.max(
    rowHeight + verticalPadding,
    Math.min(
      rowHeight * MAX_TEXTAREA_ROWS + verticalPadding,
      sidebarHeight * 0.65 - otherComposerHeight,
    ),
  );
}

function resizeTextarea(el: HTMLTextAreaElement): void {
  const rowHeight = getTextareaLineHeight(el);
  const verticalPadding = getTextareaVerticalPadding(el);
  const sidebar = el.closest('aside');
  const footer = el.closest('.codesign-sidebar-composer');
  const maxHeight =
    sidebar && footer
      ? getPromptHeightLimit(
          rowHeight,
          verticalPadding,
          sidebar.clientHeight,
          footer.getBoundingClientRect().height - el.getBoundingClientRect().height,
        )
      : rowHeight * MAX_TEXTAREA_ROWS + verticalPadding;
  const scrollTop = el.scrollTop;
  const followEnd =
    document.activeElement === el &&
    el.selectionEnd === el.value.length &&
    el.scrollHeight - el.clientHeight - scrollTop <= rowHeight;
  el.style.height = 'auto';
  const contentHeight =
    el.value.length === 0 ? rowHeight * el.rows + verticalPadding : el.scrollHeight;
  el.style.height = `${Math.min(contentHeight, maxHeight)}px`;
  el.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
  el.scrollTop = followEnd ? el.scrollHeight : scrollTop;
}

export interface PromptInputProps {
  onSubmit: (prompt: string) => void;
  onActiveSubmit?: (prompt: string, mode: ActiveRunMessageV1['mode']) => Promise<void>;
  onCancel: () => void;
  isGenerating: boolean;
  /** Optional content rendered above the textarea, inside the composer card. */
  contextSummary?: ReactNode;
  /** Optional action rendered below the text, alongside send/stop. */
  leadingAction?: ReactNode;
  onImportFiles?: (input: {
    source: WorkspaceImportSource;
    files?: WorkspaceImportFileInput[];
    blobs?: WorkspaceImportBlobInput[];
  }) => Promise<void>;
}

export interface PromptInputHandle {
  focus: () => void;
  setPrompt: (value: string) => void;
}

/**
 * Prompt textarea + send/stop button. Extracted from Sidebar.tsx so the
 * chat pane can be rewritten without disturbing the send-path keybindings.
 *
 * Keybindings:
 *   Enter           — submit (unless Shift held or composing)
 *   Meta/Ctrl+Enter — submit (power-user muscle memory)
 *   Shift+Enter     — newline
 */
export const PromptInput = forwardRef<PromptInputHandle, PromptInputProps>(function PromptInput(
  {
    onSubmit,
    onActiveSubmit,
    onCancel,
    isGenerating,
    contextSummary,
    leadingAction,
    onImportFiles,
  },
  ref,
) {
  const t = useT();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const compositionActiveRef = useRef(false);
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const prompt = useCodesignStore((s) => s.composerDrafts[s.currentDesignId ?? ''] ?? '');
  const setComposerDraft = useCodesignStore((s) => s.setComposerDraft);
  const setPrompt = (value: string) => setComposerDraft(value, currentDesignId);
  const sending = useCodesignStore(
    (s) => s.activeMessageSendingByDesign[s.currentDesignId ?? ''] ?? false,
  );
  const generationStage = useCodesignStore((s) => s.generationStage);
  const generationStartedAt = useCodesignStore((s) => {
    const currentDesignId = s.currentDesignId;
    return currentDesignId === null
      ? null
      : (s.generationByDesign[currentDesignId]?.startedAt ?? null);
  });

  const runningLabel = isGenerating
    ? (() => {
        switch (generationStage) {
          case 'sending':
            return t('loading.stage.sending');
          case 'thinking':
            return t('loading.stage.thinking');
          case 'streaming':
            return t('loading.stage.streaming');
          case 'parsing':
            return t('loading.stage.parsing');
          case 'rendering':
            return t('loading.stage.rendering');
          default:
            return t('loading.stage.thinking');
        }
      })()
    : null;

  // Elapsed timer — reassures users that long agent runs are still alive.
  // Only ticks while isGenerating; resets to 0 on each new run.
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (!isGenerating) {
      setElapsedSec(0);
      return;
    }
    const start = generationStartedAt ?? Date.now();
    setElapsedSec(elapsedSecondsSince(start));
    const id = setInterval(() => {
      setElapsedSec(elapsedSecondsSince(start));
    }, 500);
    return () => clearInterval(id);
  }, [generationStartedAt, isGenerating]);

  const elapsedText = formatElapsedSeconds(elapsedSec);

  // biome-ignore lint/correctness/useExhaustiveDependencies: These rendered contents change the textarea's available space, unlike elapsed timer ticks.
  useLayoutEffect(() => {
    if (taRef.current) resizeTextarea(taRef.current);
  }, [prompt, contextSummary, isGenerating]);

  useEffect(() => {
    const textarea = taRef.current;
    if (!textarea) return;
    const resize = () => resizeTextarea(textarea);
    const observer = new ResizeObserver(resize);
    const sidebar = textarea.closest('aside');
    if (sidebar) observer.observe(sidebar);
    window.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    focus: () => {
      taRef.current?.focus();
    },
    setPrompt: (value) => {
      setPrompt(value);
      requestAnimationFrame(() => {
        if (taRef.current) resizeTextarea(taRef.current);
      });
    },
  }));

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    if (!prompt.trim() || sending) return;
    if (isGenerating) {
      submitActive('follow-up');
      return;
    }
    onSubmit(prompt.trim());
    setPrompt('');
  }

  function submitActive(mode: ActiveRunMessageV1['mode']): void {
    if (!prompt.trim() || sending || !onActiveSubmit) return;
    const focused = taRef.current?.ownerDocument.activeElement;
    // Move focus before disabling/removing the clicked action; a late ACK must never move it.
    if (focused?.matches('.codesign-active-message-button')) taRef.current?.focus();
    // The store reports rejection through the existing toast path and retains the draft.
    void onActiveSubmit(prompt, mode).catch(() => {});
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    const native = e.nativeEvent as KeyboardEvent['nativeEvent'] & {
      isComposing?: boolean;
      keyCode?: number;
    };
    const isSendCombo = shouldSubmitPromptKey(
      {
        key: e.key,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        nativeIsComposing: native.isComposing,
        keyCode: e.keyCode,
        nativeKeyCode: native.keyCode,
      },
      compositionActiveRef.current,
    );
    if (isSendCombo) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  async function handleDrop(e: DragEvent<HTMLFormElement>): Promise<void> {
    const files = dataTransferFilesToWorkspaceFiles(e.dataTransfer);
    if (files.length === 0 || !onImportFiles || isGenerating) return;
    e.preventDefault();
    await onImportFiles({ source: 'composer', files });
  }

  async function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>): Promise<void> {
    if (!onImportFiles || isGenerating || e.clipboardData.files.length === 0) return;
    e.preventDefault();
    const payload = await clipboardFilesToWorkspaceBlobs(e.clipboardData);
    await onImportFiles({ source: 'clipboard', ...payload });
  }

  const canSend = prompt.trim().length > 0 && !sending && (!isGenerating || !!onActiveSubmit);
  const sendDisabledReason = isGenerating
    ? t('disabledReason.generatingInProgress')
    : t('disabledReason.typePromptToSend');
  const composerFrameClass = [
    'relative rounded-[12px] border bg-[var(--color-surface)] shadow-[var(--shadow-soft)] transition-[border-color,box-shadow,background-color] duration-150 ease-out',
    isGenerating
      ? 'border-[var(--color-border-muted)] bg-[color-mix(in_srgb,var(--color-surface)_94%,var(--color-background-secondary))]'
      : 'border-[var(--color-border-muted)] focus-within:border-[var(--color-border-strong)] focus-within:shadow-[0_0_0_2px_var(--color-accent-soft),var(--shadow-soft)]',
  ].join(' ');

  return (
    <form
      onSubmit={handleSubmit}
      onDrop={(e) => void handleDrop(e)}
      onDragOver={(e) => e.preventDefault()}
    >
      <div className={composerFrameClass}>
        {contextSummary ? (
          <div className="codesign-prompt-context border-b border-[var(--color-border-subtle)] px-[var(--space-3)] py-[var(--space-2)]">
            {contextSummary}
          </div>
        ) : null}
        <div className="px-[var(--space-3)] pt-[var(--space-2)]">
          <textarea
            ref={taRef}
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              compositionActiveRef.current = true;
            }}
            onCompositionEnd={() => {
              compositionActiveRef.current = false;
            }}
            onPaste={(e) => void handlePaste(e)}
            placeholder={t('chat.placeholderRich')}
            aria-label={t('chat.placeholderRich')}
            rows={2}
            className="codesign-prompt-textarea block w-full min-w-0 resize-none appearance-none border-0 bg-transparent py-[var(--space-1)] text-[length:var(--text-base)] leading-[var(--leading-body)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] shadow-none outline-none focus:outline-none focus:ring-0"
            style={{ fontFamily: 'var(--font-sans)' }}
          />
        </div>
        {isGenerating && onActiveSubmit && prompt.trim().length > 0 ? (
          <div className="codesign-active-message-actions">
            <button
              type="submit"
              disabled={!canSend}
              aria-label={t('activeMessages.queue')}
              title={t('activeMessages.queue')}
              className="codesign-active-message-button codesign-active-message-primary"
            >
              {t('activeMessages.queueShort')}
            </button>
            <button
              type="button"
              disabled={!canSend}
              aria-label={t('activeMessages.steer')}
              title={t('activeMessages.steer')}
              onClick={() => submitActive('steer')}
              className="codesign-active-message-button"
            >
              {t('activeMessages.steerShort')}
            </button>
            <details
              className="codesign-active-message-help"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  event.currentTarget.open = false;
                }
              }}
              onKeyDown={(event) => {
                if (
                  event.key === 'Escape' &&
                  !event.nativeEvent.isComposing &&
                  event.keyCode !== 229 &&
                  event.currentTarget.open
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector('summary')?.focus();
                }
              }}
            >
              <summary aria-label={t('activeMessages.help')} title={t('activeMessages.help')}>
                <CircleHelp size={16} aria-hidden="true" />
              </summary>
              <div
                className="codesign-active-message-help-panel"
                role="region"
                aria-label={t('activeMessages.help')}
                // biome-ignore lint/a11y/noNoninteractiveTabindex: The bounded help region must support keyboard scrolling.
                tabIndex={0}
              >
                <p>{t('activeMessages.boundary')}</p>
                <p>{t('activeMessages.textOnly')}</p>
              </div>
            </details>
          </div>
        ) : null}
        <div className="codesign-prompt-actions flex items-center justify-between gap-[var(--space-2)] p-[var(--space-2)]">
          <div className="min-w-0">{leadingAction}</div>
          {runningLabel ? (
            <div
              aria-live="polite"
              className="flex min-w-0 flex-1 items-center gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
            >
              <span className="truncate">{runningLabel}</span>
              <span
                className="shrink-0 tabular-nums"
                style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}
              >
                {elapsedText}
              </span>
            </div>
          ) : null}
          <div className="shrink-0">
            {isGenerating ? (
              <button
                type="button"
                onClick={onCancel}
                aria-label={t('chat.stop')}
                className="inline-flex h-[var(--size-control-md)] w-[var(--size-control-md)] items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-hover)] text-[var(--color-error)] shadow-[var(--shadow-soft)] transition-[background-color,border-color,color,transform] duration-150 hover:border-[var(--color-error)]/40 hover:bg-[var(--color-surface-active)] active:scale-[0.94]"
              >
                <Square className="w-[9px] h-[9px]" strokeWidth={0} fill="currentColor" />
              </button>
            ) : (
              <Tooltip label={!canSend ? sendDisabledReason : undefined} side="top">
                <button
                  type="submit"
                  disabled={!canSend}
                  aria-label={t('chat.send')}
                  className="inline-flex h-[var(--size-control-md)] w-[var(--size-control-md)] items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent)] text-white shadow-[var(--shadow-soft)] transition-[background-color,box-shadow,transform] duration-150 hover:bg-[var(--color-accent-hover)] hover:shadow-[var(--shadow-card)] active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-25 disabled:shadow-none"
                >
                  <ArrowUp className="w-[15px] h-[15px]" strokeWidth={2.5} />
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </form>
  );
});
