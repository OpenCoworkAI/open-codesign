import { useT } from '@open-codesign/i18n';
import type { ProjectDraft } from '@open-codesign/shared';
import { FieldHelp, NameField } from './fields';

export interface PrototypeFormProps {
  name: string;
  setName: (next: string) => void;
}

export function PrototypeForm({ name, setName }: PrototypeFormProps) {
  const t = useT();
  return (
    <div className="space-y-[var(--space-4)]">
      <NameField inputId="cd-create-name-prototype" value={name} onChange={setName} />
      <div className="space-y-[var(--space-2)]">
        <span className="block text-[var(--text-xs)] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] font-medium">
          {t('create.fields.fidelity')}
        </span>
        <FieldHelp>{t('create.fields.fidelityComingSoon')}</FieldHelp>
      </div>
      <FieldHelp>{t('create.help.share')}</FieldHelp>
    </div>
  );
}

export function buildPrototypeDraft(name: string): ProjectDraft {
  return { name: name.trim(), type: 'prototype' };
}
