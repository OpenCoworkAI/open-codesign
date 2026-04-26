import { useT } from '@open-codesign/i18n';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface AssistantTextProps {
  text: string;
  /** When true, append three animated dots after the text to signal streaming. */
  streaming?: boolean;
}

export function AssistantText({ text, streaming }: AssistantTextProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  function handleCopy(): void {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div className="group space-y-[var(--space-1_5)]">
      <div className="max-w-[90%] rounded-2xl rounded-bl-md bg-[var(--color-surface)] shadow-[0_1px_3px_rgba(0,0,0,0.06)] border border-[var(--color-border-muted)] px-[var(--space-3)] py-[var(--space-2)] text-[14px] leading-relaxed text-[var(--color-text-primary)] break-words codesign-prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
      {streaming ? (
        <div
          className="flex items-center gap-[5px] pl-[var(--space-2)] h-[16px]"
          aria-label={t('sidebar.chat.streamingLabel')}
        >
          <span className="codesign-stream-dot" />
          <span className="codesign-stream-dot" style={{ animationDelay: '150ms' }} />
          <span className="codesign-stream-dot" style={{ animationDelay: '300ms' }} />
        </div>
      ) : (
        <div className="flex items-center gap-[var(--space-1)] pl-[var(--space-1)] opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? t('settings.common.copied') : t('settings.common.copy')}
            title={copied ? t('settings.common.copied') : t('settings.common.copy')}
            className="inline-flex items-center gap-[4px] h-[22px] px-[6px] rounded-[var(--radius-sm)] text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors duration-100"
          >
            {copied ? (
              <Check className="w-[12px] h-[12px]" aria-hidden />
            ) : (
              <Copy className="w-[12px] h-[12px]" aria-hidden />
            )}
            {copied ? t('settings.common.copied') : t('settings.common.copy')}
          </button>
        </div>
      )}
    </div>
  );
}
