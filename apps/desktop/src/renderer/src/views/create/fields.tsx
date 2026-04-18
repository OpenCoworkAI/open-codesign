import { useT } from '@open-codesign/i18n';
import type { ReactNode } from 'react';

export interface NameFieldProps {
  value: string;
  onChange: (next: string) => void;
  inputId: string;
}

export function NameField({ value, onChange, inputId }: NameFieldProps) {
  const t = useT();
  return (
    <label htmlFor={inputId} className="block space-y-[var(--space-1)]">
      <span className="block text-[var(--text-xs)] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] font-medium">
        {t('create.fields.name')}
      </span>
      <input
        id={inputId}
        type="text"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('create.fields.namePlaceholder')}
        required
        className="w-full h-[var(--size-input-height)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-3)] text-[var(--text-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-focus-ring)] transition-[box-shadow,border-color] duration-[var(--duration-faster)]"
      />
    </label>
  );
}

export interface FieldHelpProps {
  children: ReactNode;
}

export function FieldHelp({ children }: FieldHelpProps) {
  return (
    <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] leading-[var(--leading-snug)] m-0">
      {children}
    </p>
  );
}
