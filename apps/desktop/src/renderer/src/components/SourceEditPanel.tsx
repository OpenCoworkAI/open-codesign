import { useT } from '@open-codesign/i18n';
import type { SourceEditSelection } from '@open-codesign/runtime';
import {
  type SourceEditOperation,
  type SourceEditTarget,
  sourceEditFieldKey,
} from '@open-codesign/shared';
import { Save, X } from 'lucide-react';
import { type FormEvent, useId } from 'react';
import { type SourceEditAncestor, sourceEditFieldState } from '../preview/helpers';
import { sourceEditOriginMessage, sourceEditReasonMessage } from '../preview/source-edit-messages';

export interface SourceEditPanelProps {
  path: string;
  target: SourceEditTarget | null;
  busy: boolean;
  message: string | null;
  onApply: (operation: SourceEditOperation) => Promise<void>;
  onClose: () => void;
  fieldStates?: SourceEditSelection['fieldStates'];
  ancestors?: SourceEditAncestor[];
  onSelectAncestor?: (selector: string) => void;
  source?: string;
}

export function sourceEditFieldLabel(
  operation: SourceEditOperation,
  t: (key: string) => string,
  index?: number,
): string {
  if (operation.kind === 'set-text')
    return `${t('canvas.sourceEdit.text')}${index === undefined ? '' : ` ${index + 1}`}`;
  if (operation.kind === 'set-attribute') return operation.name;
  return operation.property;
}

function SourceEditField({
  operation,
  disabled,
  label,
  reason,
  onApply,
}: {
  operation: SourceEditOperation;
  disabled: boolean;
  label: string;
  reason: string | undefined;
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
        {label}
      </label>
      <div className="flex items-start gap-[var(--space-1)]">
        <textarea
          id={id}
          name="value"
          defaultValue={operation.value}
          disabled={disabled}
          aria-describedby={reason ? `${id}-reason` : undefined}
          rows={operation.kind === 'set-text' ? 3 : 1}
          maxLength={operation.kind === 'set-style' ? 1000 : 100000}
          className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-background)] p-[var(--space-2)] text-[var(--text-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled}
          title={t('canvas.sourceEdit.apply')}
          aria-label={`${t('canvas.sourceEdit.apply')}: ${label}`}
          className="inline-flex size-[var(--size-control-md)] shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
        >
          <Save className="size-[var(--space-4)]" aria-hidden />
        </button>
      </div>
      {reason ? (
        <p id={`${id}-reason`} className="m-0 text-[var(--text-sm)] text-[var(--color-text-muted)]">
          {reason}
        </p>
      ) : null}
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
  fieldStates,
  ancestors = [],
  onSelectAncestor,
  source = '',
}: SourceEditPanelProps) {
  const t = useT();
  const heading = useId();
  let textIndex = 0;
  return (
    <aside
      aria-labelledby={heading}
      aria-busy={busy}
      onKeyDown={(event) => {
        if (
          event.key !== 'Escape' ||
          event.nativeEvent.isComposing ||
          event.nativeEvent.keyCode === 229
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
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
      {ancestors.length ? (
        <nav
          aria-label={t('canvas.sourceEdit.ancestors')}
          className="flex flex-wrap gap-[var(--space-1)]"
        >
          {ancestors.map((ancestor) => (
            <button
              key={ancestor.selector}
              type="button"
              disabled={busy || !onSelectAncestor}
              title={ancestor.selector}
              aria-label={`${t('canvas.sourceEdit.selectAncestor')}: ${ancestor.tagName}`}
              onClick={() => onSelectAncestor?.(ancestor.selector)}
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[var(--space-1)] text-[var(--text-sm)] disabled:opacity-50"
            >
              &lt;{ancestor.tagName}&gt;
            </button>
          ))}
        </nav>
      ) : null}
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
      {!target && !busy ? (
        <p className="m-0 text-[var(--text-sm)] text-[var(--color-text-muted)]">
          {t('canvas.sourceEdit.selectHint')}
        </p>
      ) : null}
      {target?.editableFields.map((operation) => {
        const origin =
          operation.kind === 'set-text'
            ? target.textSources?.find((item) => item.textId === operation.textId)
            : undefined;
        const state = sourceEditFieldState(target, operation, fieldStates);
        const label = sourceEditFieldLabel(
          operation,
          t,
          operation.kind === 'set-text' ? textIndex++ : undefined,
        );
        const reason =
          state.status === 'ready' ? undefined : t(`canvas.sourceEdit.fieldState.${state.status}`);
        return (
          <div
            key={`${target.id}:${sourceEditFieldKey(operation)}`}
            className="grid gap-[var(--space-2)]"
          >
            {origin ? (
              <div className="text-[var(--text-sm)] text-[var(--color-text-muted)]">
                <p>
                  {sourceEditOriginMessage(t)} · {path}:
                  {source.slice(0, origin.start).split('\n').length}
                </p>
                <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all">
                  {source.slice(origin.start, origin.end)}
                </pre>
                <details>
                  <summary>{t('canvas.sourceEdit.diagnostics')}</summary>
                  <code className="break-all">{origin.origin}</code>
                </details>
              </div>
            ) : null}
            <SourceEditField
              operation={operation}
              disabled={busy || state.status !== 'ready'}
              label={label}
              reason={reason}
              onApply={onApply}
            />
          </div>
        );
      })}
      {target?.unsupported.map((item, index) => (
        <div
          key={`${item.field}:${item.reason}:${index}`}
          className="text-[var(--text-sm)] text-[var(--color-text-muted)]"
        >
          <p className="m-0">{sourceEditReasonMessage(item.reason, t)}</p>
          <details>
            <summary>{t('canvas.sourceEdit.diagnostics')}</summary>
            <code className="break-all">{item.reason}</code>
          </details>
        </div>
      ))}
    </aside>
  );
}
