import { useT } from '@open-codesign/i18n';
import type { ChatMessageRow, ChatToolCallPayload, ChatUserPayload } from '@open-codesign/shared';
import { FileText } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { AssistantText } from './AssistantText';
import { UserMessage } from './UserMessage';
import { PreparingActivity, WorkingCard } from './WorkingCard';

interface ChatMessageListProps {
  messages: ChatMessageRow[];
  loading: boolean;
  isGenerating?: boolean;
  empty?: React.ReactNode;
  streamingText?: string | null;
  pendingToolCalls?: ChatToolCallPayload[];
}

interface RenderItem {
  key: string;
  node: React.ReactNode;
}

/**
 * Walks the chat message stream once and groups every run of consecutive
 * `tool_call` rows — regardless of verbGroup — into a single WorkingCard.
 * The bucket flushes on any non-tool_call row (assistant_text, user, error,
 * artifact_delivered) which gives us a clean per-turn "Working" card followed
 * by a plain assistant prose bubble. Session-replayed history obeys the same
 * grouping because rows are read back in `seq` order.
 */
export function ChatMessageList({
  messages,
  loading,
  isGenerating,
  empty,
  streamingText,
  pendingToolCalls,
}: ChatMessageListProps) {
  const t = useT();
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
      key: `tc-${cur.firstSeq}-${items.length}`,
      node: <WorkingCard calls={cur.calls} />,
    });
    bucket = null;
  };

  for (const msg of messages) {
    if (msg.kind === 'tool_call') {
      const call = (msg.payload as ChatToolCallPayload) ?? null;
      if (!call) continue;
      if (!bucket) bucket = { calls: [], firstSeq: msg.seq };
      bucket.calls.push(call);
      continue;
    }

    flush();

    if (msg.kind === 'user') {
      const p = msg.payload as Partial<ChatUserPayload> | undefined;
      items.push({
        key: `u-${msg.seq}-${items.length}`,
        node: (
          <UserMessage
            text={p?.text ?? ''}
            {...(p?.attachments ? { attachments: p.attachments } : {})}
            {...(p?.attachedSkills ? { attachedSkills: p.attachedSkills } : {})}
          />
        ),
      });
    } else if (msg.kind === 'assistant_text') {
      const p = msg.payload as { text?: string };
      items.push({
        key: `a-${msg.seq}-${items.length}`,
        node: <AssistantText text={p?.text ?? ''} />,
      });
    } else if (msg.kind === 'artifact_delivered') {
      const p = msg.payload as { filename?: string; createdAt?: string };
      const label = p?.filename ?? t('sidebar.chat.artifactDefaultLabel');
      items.push({
        key: `art-${msg.seq}-${items.length}`,
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
        key: `err-${msg.seq}-${items.length}`,
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
      {pendingToolCalls && pendingToolCalls.length > 0 && (
        <div key="pending-tools" className="space-y-[var(--space-1)]">
          <WorkingCard calls={pendingToolCalls} />
        </div>
      )}
      {(() => {
        if (!streamingText || streamingText.length === 0) return null;
        // Defensive dedupe: if the most recent persisted assistant_text is
        // already a prefix-equal/superset of the streaming buffer (the IPC
        // turn_end persisted before the streaming reset landed), skip the
        // ephemeral bubble to avoid showing the same prose twice.
        const lastAssistant = [...messages].reverse().find((m) => m.kind === 'assistant_text');
        const lastText =
          (lastAssistant?.payload as { text?: string } | undefined)?.text?.trim() ?? '';
        const streamingTrim = streamingText.trim();
        if (lastText && (lastText === streamingTrim || lastText.startsWith(streamingTrim))) {
          return null;
        }
        return (
          <div key="streaming-assistant">
            <AssistantText text={streamingText} streaming />
          </div>
        );
      })()}
      {(() => {
        // Lightweight run placeholder: use the same activity ledger visual
        // language as real tool calls so status never looks like chat prose.
        if (!isGenerating) return null;
        if (streamingText && streamingText.length > 0) return null;
        if (pendingToolCalls && pendingToolCalls.length > 0) return null;
        const last = messages[messages.length - 1];
        if (last?.kind !== 'user' && last?.kind !== 'assistant_text') return null;
        return <PreparingActivity key="preparing-placeholder" />;
      })()}
      <div ref={bottomRef} />
    </div>
  );
}
