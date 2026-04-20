import { useT } from '@open-codesign/i18n';

interface AssistantTextProps {
  text: string;
  /** When true, append three animated dots after the text to signal streaming. */
  streaming?: boolean;
}

/**
 * Claude.ai-style assistant prose: full-width plain text, no role label —
 * user messages get a tinted bubble + right alignment, so role is
 * inferable from layout alone. Streaming indicator is three pulsing dots
 * rendered after the partial text.
 */
export function AssistantText({ text, streaming }: AssistantTextProps) {
  const t = useT();
  return (
    <div className="text-[14px] leading-relaxed text-[var(--color-text-primary)] whitespace-pre-wrap break-words [&>p+p]:mt-[var(--space-2)]">
      {text}
      {streaming ? (
        <span
          className="inline-flex ml-[var(--space-1)] align-baseline"
          aria-label={t('sidebar.chat.streamingLabel')}
        >
          <span className="codesign-stream-dot">.</span>
          <span className="codesign-stream-dot" style={{ animationDelay: '150ms' }}>
            .
          </span>
          <span className="codesign-stream-dot" style={{ animationDelay: '300ms' }}>
            .
          </span>
        </span>
      ) : null}
    </div>
  );
}
