import { useT } from '@open-codesign/i18n';
import type { ProjectDraft } from '@open-codesign/shared';
import { FieldHelp, NameField } from './fields';

export interface SlideDeckFormProps {
  name: string;
  setName: (next: string) => void;
  speakerNotes: boolean;
  setSpeakerNotes: (next: boolean) => void;
}

export function SlideDeckForm({
  name,
  setName,
  speakerNotes,
  setSpeakerNotes,
}: SlideDeckFormProps) {
  const t = useT();
  return (
    <div className="space-y-[var(--space-4)]">
      <NameField inputId="cd-create-name-slide" value={name} onChange={setName} />
      <label className="flex items-start gap-[var(--space-3)] cursor-pointer">
        <input
          type="checkbox"
          checked={speakerNotes}
          onChange={(e) => setSpeakerNotes(e.target.checked)}
          className="mt-[var(--space-1)] w-[var(--size-icon-md)] h-[var(--size-icon-md)] accent-[var(--color-accent)]"
        />
        <span className="space-y-[var(--space-0_5)]">
          <span className="block text-[var(--text-sm)] text-[var(--color-text-primary)]">
            {t('create.fields.speakerNotes')}
          </span>
          <FieldHelp>{t('create.fields.speakerNotesHint')}</FieldHelp>
        </span>
      </label>
      <FieldHelp>{t('create.help.share')}</FieldHelp>
    </div>
  );
}

export function buildSlideDeckDraft(name: string, speakerNotes: boolean): ProjectDraft {
  return { name: name.trim(), type: 'slideDeck', speakerNotes };
}
