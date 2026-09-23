import { useT } from '@open-codesign/i18n';
import type { SourceEditOperation, SourceEditTarget } from '@open-codesign/shared';
import { Save, X } from 'lucide-react';
import { type FormEvent, useId } from 'react';

export interface SourceEditPanelProps {
  path: string;
  target: SourceEditTarget | null;
  busy: boolean;
  message: string | null;
  onApply: (operation: SourceEditOperation) => Promise<void>;
  onClose: () => void;
  sourceMode?: boolean;
  canSelectSource?: boolean;
  onSourceMode?: () => void;
  sourceTargets?: SourceEditTarget[];
  source?: string;
  onSelectSource?: (id: string) => void;
}

export function sourceEditFieldLabel(
  operation: SourceEditOperation,
  t: (key: string) => string,
): string {
  if (operation.kind === 'set-text') return t('canvas.sourceEdit.text');
  if (operation.kind === 'set-attribute') return operation.name;
  return operation.property;
}

function SourceEditField({
  operation,
  disabled,
  onApply,
}: {
  operation: SourceEditOperation;
  disabled: boolean;
  onApply: SourceEditPanelProps['onApply'];
}) {
  const t = useT();
  const id = useId();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('value');
    if (!disabled && typeof value === 'string') void onApply({ ...operation, value });
  }
  return (
    <form onSubmit={submit} className="grid gap-[var(--space-1)]">
      <label htmlFor={id} className="text-[var(--text-sm)] text-[var(--color-text-secondary)]">
        {sourceEditFieldLabel(operation, t)}
      </label>
      <div className="flex items-start gap-[var(--space-1)]">
        <textarea
          id={id}
          name="value"
          defaultValue={operation.value}
          disabled={disabled}
          rows={operation.kind === 'set-text' ? 3 : 1}
          maxLength={operation.kind === 'set-style' ? 1000 : 100000}
          className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-background)] p-[var(--space-2)] text-[var(--text-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled}
          title={t('canvas.sourceEdit.apply')}
          aria-label={`${t('canvas.sourceEdit.apply')}: ${sourceEditFieldLabel(operation, t)}`}
          className="inline-flex size-[var(--size-control-md)] shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
        >
          <Save className="size-[var(--space-4)]" aria-hidden />
        </button>
      </div>
    </form>
  );
}

export function SourceEditPanel({
  path,
  target,
  busy,
  message,
  onApply,
  onClose,
  sourceMode = false,
  canSelectSource = false,
  onSourceMode,
  sourceTargets = [],
  source = '',
  onSelectSource,
}: SourceEditPanelProps) {
  const t = useT();
  const heading = useId();
  const sourceSelect = useId();
  return (
    <aside
      aria-labelledby={heading}
      aria-busy={busy}
      className="flex min-h-0 flex-1 flex-col gap-[var(--space-3)] overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-4)] shadow-[var(--shadow-soft)]"
    >
      <div className="flex items-center justify-between gap-[var(--space-2)]">
        <h3
          id={heading}
          className="m-0 text-[var(--text-sm)] font-medium text-[var(--color-text-primary)]"
        >
          {t('canvas.sourceEdit.title')}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('canvas.sourceEdit.close')}
          className="rounded-[var(--radius-sm)] p-[var(--space-1)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
        >
          <X className="size-[var(--space-4)]" aria-hidden />
        </button>
      </div>
      <p className="m-0 break-all text-[var(--text-sm)] text-[var(--color-text-secondary)]">
        {path}
        {target ? ` · <${target.tagName}>` : ''}
      </p>
      <p className="m-0 text-[var(--text-sm)] text-[var(--color-text-muted)]">
        {t('canvas.sourceEdit.scope')}
      </p>
      <p className="m-0 text-[var(--text-sm)] text-[var(--color-text-muted)]">
        {t('canvas.sourceEdit.reloadWarning')}
      </p>
      {message ? (
        <p role="status" className="m-0 text-[var(--text-sm)] text-[var(--color-text-secondary)]">
          {message}
        </p>
      ) : null}
      {busy ? (
        <p role="status" className="m-0 text-[var(--text-sm)] text-[var(--color-text-muted)]">
          {t('common.loading')}
        </p>
      ) : null}
      {canSelectSource && !busy ? (
        <button
          type="button"
          onClick={onSourceMode}
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[var(--space-2)] text-[var(--text-sm)]"
        >
          {t('canvas.sourceEdit.chooseSource')}
        </button>
      ) : null}
      {sourceMode ? (
        <div className="grid gap-[var(--space-2)] text-[var(--text-sm)]">
          <p>{t('canvas.sourceEdit.sourceHint')}</p>
          <label htmlFor={sourceSelect}>{t('canvas.sourceEdit.sourceField')}</label>
          <select
            id={sourceSelect}
            value={target?.id ?? ''}
            disabled={busy}
            onChange={(event) => onSelectSource?.(event.target.value)}
            className="min-w-0 w-full border border-[var(--color-border)] bg-[var(--color-background)] p-[var(--space-2)]"
          >
            <option value="">{t('canvas.sourceEdit.chooseSource')}</option>
            {sourceTargets.map((item) => (
              <option key={item.id} value={item.id}>
                {source.slice(0, item.start).split('\n').length}: &lt;{item.tagName}&gt;{' '}
                {item.editableFields
                  .map((field) => field.value)
                  .join(' · ')
                  .replace(/\s+/g, ' ')
                  .slice(0, 100)}
              </option>
            ))}
          </select>
          {!busy && sourceTargets.length === 0 ? (
            <p>{t('canvas.sourceEdit.noSourceFields')}</p>
          ) : null}
          {target ? (
            <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-all">
              {source.slice(target.start, Math.min(target.end, target.start + 1000))}
            </pre>
          ) : null}
        </div>
      ) : null}
      {!sourceMode && !canSelectSource && !target && !busy ? (
        <p className="m-0 text-[var(--text-sm)] text-[var(--color-text-muted)]">
          {t('canvas.sourceEdit.selectHint')}
        </p>
      ) : null}
      {target?.editableFields.map((operation) => (
        <SourceEditField
          key={`${target.id}:${operation.kind}:${operation.kind === 'set-style' ? operation.property : operation.kind === 'set-attribute' ? operation.name : 'text'}`}
          operation={operation}
          disabled={busy}
          onApply={onApply}
        />
      ))}
      {target?.unsupported.map((item) => (
        <p
          key={`${item.field}:${item.reason}`}
          className="m-0 text-[var(--text-sm)] text-[var(--color-text-muted)]"
        >
          {item.message} ({item.reason})
        </p>
      ))}
    </aside>
  );
}
