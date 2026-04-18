import { useT } from '@open-codesign/i18n';
import type { ProjectDraft } from '@open-codesign/shared';
import type { DemoTemplate } from '@open-codesign/templates';
import { FieldHelp, NameField } from './fields';

export interface FromTemplateFormProps {
  name: string;
  setName: (next: string) => void;
  templateId: string;
  setTemplateId: (next: string) => void;
  templates: DemoTemplate[];
}

export function FromTemplateForm({
  name,
  setName,
  templateId,
  setTemplateId,
  templates,
}: FromTemplateFormProps) {
  const t = useT();
  return (
    <div className="space-y-[var(--space-4)]">
      <NameField inputId="cd-create-name-template" value={name} onChange={setName} />
      <fieldset className="space-y-[var(--space-2)] m-0 p-0 border-0">
        <legend className="block text-[var(--text-xs)] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] font-medium mb-[var(--space-1)]">
          {t('create.fields.template')}
        </legend>
        <div className="grid grid-cols-1 gap-[var(--space-2)]">
          {templates.map((tmpl) => {
            const checked = templateId === tmpl.id;
            return (
              <label
                key={tmpl.id}
                className={`flex items-start gap-[var(--space-3)] rounded-[var(--radius-md)] border px-[var(--space-3)] py-[var(--space-3)] cursor-pointer transition-colors ${
                  checked
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <input
                  type="radio"
                  name="cd-create-template"
                  value={tmpl.id}
                  checked={checked}
                  onChange={() => setTemplateId(tmpl.id)}
                  className="mt-[var(--space-1)] accent-[var(--color-accent)]"
                />
                <span className="space-y-[var(--space-0_5)] min-w-0">
                  <span className="block text-[var(--text-sm)] font-medium text-[var(--color-text-primary)] truncate">
                    {tmpl.title}
                  </span>
                  <span className="block text-[var(--text-xs)] text-[var(--color-text-muted)] leading-[var(--leading-snug)]">
                    {tmpl.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        <FieldHelp>{t('create.fields.templateHint')}</FieldHelp>
      </fieldset>
      <FieldHelp>{t('create.help.templates')}</FieldHelp>
    </div>
  );
}

export function buildFromTemplateDraft(name: string, templateId: string): ProjectDraft {
  return { name: name.trim(), type: 'template', templateId };
}
