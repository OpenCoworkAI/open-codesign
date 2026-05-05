import { useT } from '@open-codesign/i18n';
import type { LocalInputFile } from '@open-codesign/shared';
import { Paperclip } from 'lucide-react';

interface UserMessageProps {
  text: string;
  attachments?: LocalInputFile[];
  attachedSkills?: string[];
}

export function formatAttachmentSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/**
 * Claude-style user message: right-aligned bubble with subtle accent tint
 * background. No "You" label — bubble alignment carries the role signal.
 */
export function UserMessage({ text, attachments, attachedSkills }: UserMessageProps) {
  const t = useT();
  return (
    <div className="flex flex-col items-end gap-[var(--space-1)] pl-[var(--space-6)]">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 px-[var(--space-3)] py-[var(--space-2)] text-[14px] leading-relaxed text-[var(--color-text-primary)] whitespace-pre-wrap break-words">
        {text}
      </div>
      {attachments && attachments.length > 0 ? (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-[var(--space-1)]">
          {attachments.map((file) => {
            const size = formatAttachmentSize(file.size);
            return (
              <span
                key={file.path}
                className="inline-flex min-w-0 max-w-full items-center gap-[6px] rounded-full border border-[var(--color-border-muted)] bg-[var(--color-surface)] px-[var(--space-2)] py-[var(--space-1)] text-[11.5px] text-[var(--color-text-secondary)] shadow-[var(--shadow-soft)]"
                title={file.path}
              >
                <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 max-w-[220px] truncate">{file.name}</span>
                {size ? (
                  <span
                    className="shrink-0 text-[10px] text-[var(--color-text-muted)]"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {size}
                  </span>
                ) : null}
              </span>
            );
          })}
        </div>
      ) : null}
      {attachedSkills && attachedSkills.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-[var(--space-1)]">
          {attachedSkills.map((s) => (
            <span
              key={s}
              className="inline-flex items-center rounded-full border border-[var(--color-border-muted)] bg-[var(--color-surface)] px-[var(--space-2)] py-[var(--space-0_5)] text-[var(--text-2xs)] text-[var(--color-text-muted)]"
            >
              {t(`sidebar.chat.skill.${s}`, { defaultValue: s })}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
