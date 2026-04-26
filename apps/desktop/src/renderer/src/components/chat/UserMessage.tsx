import { useT } from '@open-codesign/i18n';
import { Pencil } from 'lucide-react';

interface UserMessageProps {
  text: string;
  attachedSkills?: string[];
  onEdit?: (text: string) => void;
}

/**
 * Claude-style user message: right-aligned bubble with subtle accent tint
 * background. No "You" label — bubble alignment carries the role signal.
 */
export function UserMessage({ text, attachedSkills, onEdit }: UserMessageProps) {
  const t = useT();
  return (
    <div className="group flex flex-col items-end gap-[var(--space-1)] pl-[var(--space-6)]">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 px-[var(--space-3)] py-[var(--space-2)] text-[14px] leading-relaxed text-[var(--color-text-primary)] whitespace-pre-wrap break-words">
        {text}
      </div>
      {onEdit ? (
        <div className="flex items-center gap-[var(--space-1)] opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <button
            type="button"
            onClick={() => onEdit(text)}
            aria-label={t('settings.providers.edit')}
            title={t('settings.providers.edit')}
            className="inline-flex items-center gap-[4px] h-[22px] px-[6px] rounded-[var(--radius-sm)] text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors duration-100"
          >
            <Pencil className="w-[12px] h-[12px]" aria-hidden />
            {t('settings.providers.edit')}
          </button>
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
