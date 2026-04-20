import { useT } from '@open-codesign/i18n';

interface UserMessageProps {
  text: string;
  attachedSkills?: string[];
}

/**
 * Claude-style user message: right-aligned bubble with subtle accent tint
 * background. No "You" label — bubble alignment carries the role signal.
 */
export function UserMessage({ text, attachedSkills }: UserMessageProps) {
  const t = useT();
  return (
    <div className="flex flex-col items-end gap-[var(--space-1)] pl-[var(--space-6)]">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 px-[var(--space-3)] py-[var(--space-2)] text-[14px] leading-relaxed text-[var(--color-text-primary)] whitespace-pre-wrap break-words">
        {text}
      </div>
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
