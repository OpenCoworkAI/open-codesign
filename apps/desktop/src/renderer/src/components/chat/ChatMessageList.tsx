import { useT } from '@open-codesign/i18n';
import type { ChatMessageRow, ChatToolCallPayload } from '@open-codesign/shared';
import { Check, ChevronDown, ChevronRight, FileText, Loader } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useCodesignStore } from '../../store';
import { AssistantText } from './AssistantText';
import { UserMessage } from './UserMessage';
import { WorkingCard } from './WorkingCard';

interface ChatMessageListProps {
  messages: ChatMessageRow[];
  loading: boolean;
  isGenerating?: boolean;
  empty?: ReactNode;
  streamingText?: string | null;
  pendingToolCalls?: ChatToolCallPayload[];
  onEditMessage?: (text: string) => void;
}

interface RenderItem {
  key: string;
  node: ReactNode;
}

/**
 * Walks the chat message stream once and groups every run of consecutive
 * `tool_call` rows — regardless of verbGroup — into a single WorkingCard.
 * The bucket flushes on any non-tool_call row (assistant_text, user, error,
 * artifact_delivered) which gives us a clean per-turn "Working" card followed
 * by a plain assistant prose bubble. SQLite-replayed history obeys the same
 * grouping because rows are read back in `seq` order.
 *
 * `set_todos` is not rendered here: the sticky todo header (Sidebar) shows the
 * live checklist; chat history would duplicate it.
 */
export function ChatMessageList({
  messages,
  loading,
  isGenerating,
  empty,
  streamingText,
  pendingToolCalls,
  onEditMessage,
}: ChatMessageListProps) {
  const t = useT();
  const currentOperation = useCodesignStore((s) => s.currentOperation);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current?.parentElement;
    if (!el) return;
    function onScroll(): void {
      if (!el) return;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distanceFromBottom < 48;
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-scrolls on new messages or streaming text
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, streamingText]);

  if (loading && messages.length === 0 && !streamingText) {
    return (
      <div className="text-[var(--text-sm)] text-[var(--color-text-muted)]">
        {t('common.loading')}
      </div>
    );
  }

  if (messages.length === 0 && !streamingText) {
    return <>{empty}</>;
  }

  const items: RenderItem[] = [];
  let bucket: { calls: ChatToolCallPayload[]; firstSeq: number } | null = null;

  const flush = () => {
    if (!bucket || bucket.calls.length === 0) {
      bucket = null;
      return;
    }
    const cur = bucket;
    items.push({
      key: `tc-${cur.firstSeq}`,
      node: <WorkingCard calls={cur.calls} />,
    });
    bucket = null;
  };

  for (const msg of messages) {
    if (msg.kind === 'tool_call') {
      const call = (msg.payload as ChatToolCallPayload) ?? null;
      if (!call) continue;
      if (call.toolName === 'set_todos') {
        flush();
        continue;
      }
      if (!bucket) bucket = { calls: [], firstSeq: msg.seq };
      bucket.calls.push(call);
      continue;
    }

    flush();

    if (msg.kind === 'user') {
      const p = msg.payload as { text?: string; attachedSkills?: string[] };
      items.push({
        key: `u-${msg.seq}`,
        node: (
          <UserMessage
            text={p?.text ?? ''}
            {...(p?.attachedSkills ? { attachedSkills: p.attachedSkills } : {})}
            {...(onEditMessage ? { onEdit: onEditMessage } : {})}
          />
        ),
      });
    } else if (msg.kind === 'assistant_text') {
      const p = msg.payload as { text?: string };
      const isLast = msg === messages[messages.length - 1];
      const streaming = Boolean(isGenerating) && isLast;
      items.push({
        key: `a-${msg.seq}`,
        node: <AssistantText text={p?.text ?? ''} streaming={streaming} />,
      });
    } else if (msg.kind === 'artifact_delivered') {
      const p = msg.payload as { filename?: string; createdAt?: string };
      const label = p?.filename ?? t('sidebar.chat.artifactDefaultLabel');
      items.push({
        key: `art-${msg.seq}`,
        node: (
          <div className="flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface)] px-[var(--space-3)] py-[var(--space-2)]">
            <FileText
              className="w-[14px] h-[14px] text-[var(--color-text-secondary)] shrink-0"
              aria-hidden
            />
            <span className="text-[12.5px] font-[ui-monospace,Menlo,monospace] text-[var(--color-text-primary)] truncate">
              {label}
            </span>
            <span className="ml-auto text-[11px] text-[var(--color-text-muted)]">
              {t('sidebar.chat.artifactDelivered')}
            </span>
          </div>
        ),
      });
    } else if (msg.kind === 'error') {
      const p = msg.payload as { message?: string };
      items.push({
        key: `err-${msg.seq}`,
        node: (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-error)] bg-[var(--color-surface)] px-[var(--space-3)] py-[var(--space-2)] text-[12.5px] font-[var(--font-mono),ui-monospace,Menlo,monospace] text-[var(--color-text-primary)] break-all whitespace-pre-wrap">
            {p?.message ?? t('errors.unknown')}
          </div>
        ),
      });
    }
  }

  flush();

  return (
    <div ref={scrollRef} className="space-y-[var(--space-5)]">
      {items.map((item) => (
        <div key={item.key}>{item.node}</div>
      ))}
      <LiveThinkingBlock
        isGenerating={Boolean(isGenerating)}
        pendingToolCalls={pendingToolCalls ?? []}
        streamingText={streamingText ?? null}
        messages={messages}
        currentOperation={currentOperation}
        t={t}
      />
      <div ref={bottomRef} />
    </div>
  );
}

/* ── Live thinking block ─────────────────────────────────────────────── */

/* ── Planning view (set_todos inline) ─────────────────────────────────── */

function PlanningView({
  items,
}: {
  items: { text: string; status: 'pending' | 'in_progress' | 'completed' }[];
}) {
  return (
    <div className="space-y-[3px]">
      {items.map((item, i) => (
        <div
          key={`plan-${i}-${item.text.slice(0, 8)}`}
          className="flex items-start gap-[6px] text-[12px] leading-[1.4]"
        >
          {item.status === 'completed' ? (
            <span className="mt-[2px] inline-flex items-center justify-center w-[13px] h-[13px] rounded-[3px] bg-[var(--color-accent)] shrink-0">
              <Check className="w-[9px] h-[9px] text-white" strokeWidth={3} />
            </span>
          ) : item.status === 'in_progress' ? (
            <Loader className="mt-[2px] w-[13px] h-[13px] shrink-0 text-[var(--color-accent)] animate-spin" />
          ) : (
            <span className="mt-[2px] inline-block w-[13px] h-[13px] rounded-[3px] border border-[var(--color-border)] shrink-0" />
          )}
          <span
            className={
              item.status === 'completed'
                ? 'line-through text-[var(--color-text-muted)]'
                : item.status === 'in_progress'
                  ? 'text-[var(--color-text-primary)] font-medium'
                  : 'text-[var(--color-text-secondary)]'
            }
          >
            {item.text}
          </span>
        </div>
      ))}
    </div>
  );
}

interface LiveThinkingBlockProps {
  isGenerating: boolean;
  pendingToolCalls: ChatToolCallPayload[];
  streamingText: string | null;
  messages: ChatMessageRow[];
  currentOperation: string | null;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

function LiveThinkingBlock({
  isGenerating,
  pendingToolCalls,
  streamingText,
  messages,
  currentOperation,
  t,
}: LiveThinkingBlockProps) {
  const [expanded, setExpanded] = useState(true);

  // Collapse automatically once streaming text arrives (LLM is now replying)
  const prevGenerating = useRef(isGenerating);
  useEffect(() => {
    if (!isGenerating && prevGenerating.current) {
      // generation finished — keep expanded so user can review steps
    }
    prevGenerating.current = isGenerating;
  }, [isGenerating]);

  // Show streaming text bubble
  const showStreaming = streamingText && streamingText.length > 0;
  if (showStreaming) {
    const lastAssistant = [...messages].reverse().find((m) => m.kind === 'assistant_text');
    const lastText = (lastAssistant?.payload as { text?: string } | undefined)?.text?.trim() ?? '';
    const streamingTrim = streamingText.trim();
    const isDupe = Boolean(lastText && (lastText === streamingTrim || lastText.startsWith(streamingTrim)));
    if (!isDupe) {
      return (
        <div key="streaming-assistant">
          <AssistantText text={streamingText} streaming />
        </div>
      );
    }
    return null;
  }

  // Show thinking block when generating
  const hasPendingTools = pendingToolCalls.length > 0;
  const isEarlyThinking = isGenerating && !hasPendingTools;
  if (!isGenerating && !hasPendingTools) return null;

  // Build pending tool clusters. set_todos → shown as PlanningView (not WorkingCard).
  const pendingGroups: import('react').ReactNode[] = [];
  let bucket: ChatToolCallPayload[] = [];
  let latestSetTodosCall: ChatToolCallPayload | null = null;
  const flushBucket = (idx: number): void => {
    if (bucket.length === 0) return;
    pendingGroups.push(<WorkingCard key={`p-${idx}`} calls={bucket} />);
    bucket = [];
  };
  for (let i = 0; i < pendingToolCalls.length; i += 1) {
    const c = pendingToolCalls[i];
    if (!c) continue;
    if (c.toolName === 'set_todos') { flushBucket(i); latestSetTodosCall = c; continue; }
    bucket.push(c);
  }
  flushBucket(pendingToolCalls.length);

  // Extract plan items from the latest set_todos call for inline display
  const planItems: { text: string; status: 'pending' | 'in_progress' | 'completed' }[] = [];
  if (latestSetTodosCall) {
    const raw = (latestSetTodosCall.args?.['todos'] ?? latestSetTodosCall.args?.['items']) as unknown;
    if (Array.isArray(raw)) {
      for (const it of raw) {
        if (typeof it !== 'object' || it === null) continue;
        const o = it as Record<string, unknown>;
        const text = typeof o['content'] === 'string' ? o['content'] : typeof o['text'] === 'string' ? o['text'] : null;
        if (!text) continue;
        const rs = o['status'];
        const status: 'pending' | 'in_progress' | 'completed' =
          rs === 'completed' || rs === 'in_progress' || rs === 'pending' ? rs : o['checked'] === true ? 'completed' : 'pending';
        planItems.push({ text, status });
      }
    }
  }

  const stepCount = pendingToolCalls.filter((c) => c.toolName !== 'set_todos').length;

  return (
    <div
      className="rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface)] overflow-hidden"
      aria-live="polite"
    >
      {/* Header row — always visible */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors duration-100"
      >
        {expanded ? (
          <ChevronDown className="w-[13px] h-[13px] shrink-0 text-[var(--color-text-muted)]" aria-hidden />
        ) : (
          <ChevronRight className="w-[13px] h-[13px] shrink-0 text-[var(--color-text-muted)]" aria-hidden />
        )}
        <span className="flex items-center gap-[var(--space-1_5)]">
          {isGenerating ? (
            <>
              <span className="codesign-stream-dot shrink-0" style={{ width: 6, height: 6 }} />
              <span className="codesign-stream-dot shrink-0" style={{ width: 6, height: 6, animationDelay: '150ms' }} />
              <span className="codesign-stream-dot shrink-0" style={{ width: 6, height: 6, animationDelay: '300ms' }} />
            </>
          ) : null}
          <span className="font-medium text-[var(--color-text-primary)]">
            {isEarlyThinking ? t('sidebar.chat.thinking') : t('sidebar.chat.working.title')}
          </span>
          {stepCount > 0 ? (
            <span className="text-[11px] text-[var(--color-text-muted)]">
              {stepCount} {stepCount === 1 ? 'step' : 'steps'}
            </span>
          ) : null}
        </span>
        {isGenerating && currentOperation ? (
          <span className="ml-auto truncate max-w-[50%] text-[11px] font-[ui-monospace,Menlo,monospace] text-[var(--color-text-muted)]">
            {currentOperation}
          </span>
        ) : null}
      </button>

      {/* Expandable steps */}
      {expanded && (isEarlyThinking || pendingGroups.length > 0 || planItems.length > 0) ? (
        <div className="border-t border-[var(--color-border-subtle)] px-[var(--space-3)] py-[var(--space-2)] space-y-[var(--space-2)]">
          {pendingGroups.length > 0 ? (
            pendingGroups
          ) : planItems.length > 0 ? (
            <PlanningView items={planItems} />
          ) : (
            <p className="text-[11.5px] text-[var(--color-text-muted)] italic">
              {currentOperation ?? t('sidebar.chat.thinking')}…
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
