import { useT } from '@open-codesign/i18n';
import type { ProjectDraft } from '@open-codesign/shared';
import { FieldHelp, NameField } from './fields';

export interface OtherFormProps {
  name: string;
  setName: (next: string) => void;
}

export function OtherForm({ name, setName }: OtherFormProps) {
  const t = useT();
  return (
    <div className="space-y-[var(--space-4)]">
      <NameField inputId="cd-create-name-other" value={name} onChange={setName} />
      <FieldHelp>{t('create.help.share')}</FieldHelp>
    </div>
  );
}

export function buildOtherDraft(name: string): ProjectDraft {
  return { name: name.trim(), type: 'other' };
}
