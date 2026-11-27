import { useT } from '@open-codesign/i18n';
import type { SourceEditSelection } from '@open-codesign/runtime';
import type { SourceEditOperation, SourceEditTarget } from '@open-codesign/shared';
import { ChevronUp, Lock, MousePointerClick, Sparkles } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { type SourceEditAncestor, sourceEditFieldState } from '../../preview/helpers';
import { sourceEditReasonMessage } from '../../preview/source-edit-messages';
import {
  BoxField,
  ColorField,
  FieldRow,
  InspectorSection,
  LengthField,
  lengthScrub,
  TextField,
} from './controls';
import {
  elementKind,
  groupInspectorFields,
  type InspectorField,
  inspectorFields,
  lockedReasons,
  operationWithValue,
  type PreviewDraft,
  previewDraftFor,
} from './element-model';
import type { PaletteColor } from './palette';

export interface ElementInspectorProps {
  /** Tag of the clicked element, known even when it has no editable source target. */
  pickedTag: string | null;
  target: SourceEditTarget | null;
  fieldStates?: SourceEditSelection['fieldStates'];
  ancestors: SourceEditAncestor[];
  busy: boolean;
  message: string | null;
  palette: readonly PaletteColor[];
  onApply: (operations: SourceEditOperation[]) => Promise<void>;
  onPreview: (draft: PreviewDraft) => void;
  onSelectAncestor: (selector: string) => void;
  onAskAi?: (() => void) | undefined;
}

export function ElementInspector({
  pickedTag,
  target,
  fieldStates,
  ancestors,
  busy,
  message,
  palette,
  onApply,
  onPreview,
  onSelectAncestor,
  onAskAi,
}: ElementInspectorProps) {
  const t = useT();
  const baseId = useId();
  const fields = useMemo(() => (target ? inspectorFields(target) : []), [target]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const tag = target?.tagName ?? pickedTag;
  const locked = lockedReasons(target);

  const editable = (field: InspectorField) =>
    target !== null &&
    sourceEditFieldState(target, field.operation, fieldStates).status === 'ready';
  const pending = fields.filter(
    (field) =>
      draft[field.key] !== undefined &&
      draft[field.key] !== field.operation.value &&
      editable(field),
  );
  const pendingOperations = pending.map((field) =>
    operationWithValue(field.operation, draft[field.key] ?? field.operation.value),
  );
  const previewKey = JSON.stringify(previewDraftFor(pendingOperations));

  useEffect(() => {
    onPreview(JSON.parse(previewKey) as PreviewDraft);
  }, [previewKey, onPreview]);
  useEffect(() => () => onPreview({ styles: {}, attributes: {} }), [onPreview]);

  function apply() {
    if (busy || pendingOperations.length === 0) return;
    void onApply(pendingOperations);
  }

  if (!tag) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-[var(--space-2)] px-[var(--space-6)] text-center">
        <MousePointerClick
          className="size-[var(--space-6)] text-[var(--color-text-muted)]"
          aria-hidden
        />
        <p className="m-0 text-[var(--text-sm)] text-[var(--color-text-secondary)]">
          {t('inspector.element.pickHint')}
        </p>
        {message ? (
          <p role="status" className="m-0 text-[12px] text-[var(--color-text-muted)]">
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  const parent = ancestors[0];
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          apply();
        }
      }}
    >
      <header className="flex items-start justify-between gap-[var(--space-2)] px-[var(--space-4)] pt-[var(--space-3)] pb-[var(--space-2)]">
        <div className="min-w-0">
          <h3 className="m-0 truncate text-[14px] font-semibold text-[var(--color-text-primary)]">
            {t(`inspector.kinds.${elementKind(tag)}`)}
            <span
              className="ml-[var(--space-1_5)] text-[11px] font-normal text-[var(--color-text-muted)]"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {tag.toLowerCase()}
            </span>
          </h3>
        </div>
        {parent ? (
          <div className="flex shrink-0 items-center gap-[var(--space-1)]">
            <button
              type="button"
              disabled={busy}
              title={t('inspector.element.selectParent')}
              onClick={() => onSelectAncestor(parent.selector)}
              className="inline-flex items-center gap-[3px] rounded-full border border-[var(--color-border)] px-[var(--space-2)] py-[2px] text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
            >
              <ChevronUp className="size-[12px]" aria-hidden />
              {t('inspector.element.parent', {
                name: t(`inspector.kinds.${elementKind(parent.tagName)}`),
              })}
            </button>
            {ancestors.length > 1 ? (
              <details className="relative">
                <summary
                  aria-label={t('inspector.element.ancestors')}
                  className="cursor-pointer list-none rounded-full border border-[var(--color-border)] px-[6px] py-[2px] text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                >
                  ···
                </summary>
                <nav
                  aria-label={t('inspector.element.ancestors')}
                  className="absolute right-0 z-10 mt-[var(--space-1)] flex min-w-[140px] flex-col rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-1)] shadow-[var(--shadow-elevated)]"
                >
                  {ancestors.map((ancestor, index) => (
                    <button
                      key={ancestor.selector}
                      type="button"
                      disabled={busy}
                      onClick={() => onSelectAncestor(ancestor.selector)}
                      className="rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] text-left text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
                      style={{ paddingLeft: `calc(var(--space-2) + ${index * 6}px)` }}
                    >
                      {t(`inspector.kinds.${elementKind(ancestor.tagName)}`)}
                    </button>
                  ))}
                </nav>
              </details>
            ) : null}
          </div>
        ) : null}
      </header>

      {message ? (
        <p
          role="status"
          className="mx-[var(--space-4)] mb-[var(--space-2)] rounded-[var(--radius-sm)] bg-[var(--color-surface-hover)] px-[var(--space-2)] py-[var(--space-1_5)] text-[12px] text-[var(--color-text-secondary)]"
        >
          {message}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {groupInspectorFields(fields).map(({ group, fields: members }) => (
          <InspectorSection key={group} title={t(`inspector.groups.${group}`)}>
            {members.map((field) => {
              const id = `${baseId}-${field.key}`;
              const value = draft[field.key] ?? field.operation.value;
              const state = target
                ? sourceEditFieldState(target, field.operation, fieldStates).status
                : 'unmapped';
              const disabled = busy || state !== 'ready';
              const set = (next: string) => setDraft((prev) => ({ ...prev, [field.key]: next }));
              const label =
                field.textIndex !== undefined
                  ? t('inspector.fields.textN', { n: field.textIndex })
                  : t(`inspector.fields.${field.labelKey}`);
              const hint =
                state !== 'ready'
                  ? t(`canvas.sourceEdit.fieldState.${state}`)
                  : field.shared
                    ? t('inspector.element.shared')
                    : undefined;
              return (
                <FieldRow
                  key={field.key}
                  label={label}
                  htmlFor={id}
                  hint={hint}
                  onScrub={
                    !disabled && field.control === 'length' ? lengthScrub(value, set) : undefined
                  }
                >
                  {field.control === 'color' ? (
                    <ColorField
                      id={id}
                      label={label}
                      value={value}
                      onChange={set}
                      disabled={disabled}
                      palette={palette}
                    />
                  ) : field.control === 'length' ? (
                    <LengthField id={id} value={value} onChange={set} disabled={disabled} />
                  ) : field.control === 'box' ? (
                    <BoxField id={id} value={value} onChange={set} disabled={disabled} />
                  ) : (
                    <TextField
                      id={id}
                      value={value}
                      onChange={set}
                      disabled={disabled}
                      multiline={field.control === 'text'}
                    />
                  )}
                </FieldRow>
              );
            })}
          </InspectorSection>
        ))}

        {!target || locked.length > 0 ? (
          <div className="border-t border-[var(--color-border-subtle)] px-[var(--space-4)] py-[var(--space-3)]">
            {locked.length > 0 ? (
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-[var(--space-1_5)] text-[12px] text-[var(--color-text-secondary)]">
                  <Lock className="size-[12px]" aria-hidden />
                  {t('inspector.element.locked', { count: locked.length })}
                </summary>
                <ul className="m-0 mt-[var(--space-2)] flex list-none flex-col gap-[var(--space-1_5)] p-0">
                  {locked.map((reason) => (
                    <li
                      key={reason}
                      className="text-[11px] leading-[var(--leading-snug)] text-[var(--color-text-muted)]"
                    >
                      {sourceEditReasonMessage(reason, t)}
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <p className="m-0 text-[12px] text-[var(--color-text-secondary)]">
                {t('inspector.element.noDirectEdits')}
              </p>
            )}
            {onAskAi ? (
              <button
                type="button"
                onClick={onAskAi}
                disabled={busy}
                className="mt-[var(--space-2)] inline-flex items-center gap-[var(--space-1)] text-[12px] font-medium text-[var(--color-accent)] hover:underline disabled:opacity-50"
              >
                <Sparkles className="size-[12px]" aria-hidden />
                {t('inspector.element.askAi')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {fields.length > 0 ? (
        <footer className="flex items-center justify-between gap-[var(--space-2)] border-t border-[var(--color-border-subtle)] px-[var(--space-4)] py-[var(--space-2_5)]">
          <span
            className="min-w-0 truncate text-[11px] text-[var(--color-text-muted)]"
            aria-live="polite"
          >
            {busy
              ? t('inspector.element.applying')
              : pending.length > 0
                ? t('inspector.element.pending', { count: pending.length })
                : t('inspector.element.noPending')}
          </span>
          <div className="flex shrink-0 items-center gap-[var(--space-1)]">
            <button
              type="button"
              disabled={busy || pending.length === 0}
              onClick={() => setDraft({})}
              className="rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40"
            >
              {t('inspector.element.discard')}
            </button>
            <button
              type="button"
              disabled={busy || pending.length === 0}
              onClick={apply}
              className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[var(--space-3)] py-[var(--space-1)] text-[12px] font-medium text-[var(--color-on-accent)] hover:opacity-90 disabled:opacity-40"
            >
              {t('inspector.element.apply')}
            </button>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
