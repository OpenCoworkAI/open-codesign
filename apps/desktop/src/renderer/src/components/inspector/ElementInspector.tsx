import { useT } from '@open-codesign/i18n';
import type { SourceEditSelection } from '@open-codesign/runtime';
import type {
  SourceEditElementSnapshot,
  SourceEditOperation,
  SourceEditTarget,
} from '@open-codesign/shared';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ChevronUp,
  Lock,
  MousePointerClick,
  Redo2,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { type ReactNode, useEffect, useId, useMemo, useState } from 'react';
import type { SourceEditAncestor } from '../../preview/helpers';
import { sourceEditReasonMessage } from '../../preview/source-edit-messages';
import {
  BoxField,
  ColorField,
  FieldRow,
  InspectorSection,
  LengthField,
  lengthScrub,
  SegmentedControl,
  SelectField,
  SliderNumberField,
  TextField,
} from './controls';
import {
  buildElementInspectorSections,
  elementKind,
  type InspectorField,
  inspectorFieldIssueStatus,
  isInspectorFieldEditable,
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
  elementSnapshot?: SourceEditElementSnapshot | null;
  busy: boolean;
  message: string | null;
  palette: readonly PaletteColor[];
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => Promise<void> | void;
  onRedo?: () => Promise<void> | void;
  onApply: (operations: SourceEditOperation[]) => Promise<void>;
  onPreview: (draft: PreviewDraft) => void;
  onHighlightBoxModel?: (active: boolean) => void;
  onSelectAncestor: (selector: string) => void;
  onAskAi?: (() => void) | undefined;
}

const ALIGN_ICONS: Record<string, ReactNode> = {
  left: <AlignLeft className="size-[12px]" aria-hidden />,
  center: <AlignCenter className="size-[12px]" aria-hidden />,
  right: <AlignRight className="size-[12px]" aria-hidden />,
  justify: <AlignJustify className="size-[12px]" aria-hidden />,
};

export function ElementInspector({
  pickedTag,
  target,
  fieldStates,
  ancestors,
  elementSnapshot,
  busy,
  message,
  palette,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onApply,
  onPreview,
  onHighlightBoxModel,
  onSelectAncestor,
  onAskAi,
}: ElementInspectorProps) {
  const t = useT();
  const baseId = useId();
  const statusId = `${baseId}-status`;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [draftRemoved, setDraftRemoved] = useState<Record<string, boolean>>({});
  const tag = target?.tagName ?? pickedTag;
  const locked = lockedReasons(target);

  const sections = useMemo(
    () => buildElementInspectorSections(target, elementSnapshot, fieldStates, draft),
    [target, elementSnapshot, fieldStates, draft],
  );
  const fields = useMemo(() => sections.flatMap((section) => section.fields), [sections]);

  const editable = (field: InspectorField) => isInspectorFieldEditable(target, field, fieldStates);

  const pendingOperations: SourceEditOperation[] = [];
  for (const field of fields) {
    if (!editable(field)) continue;
    if (draftRemoved[field.key] && field.authored && field.operation.kind === 'set-style') {
      pendingOperations.push({ kind: 'remove-style', property: field.operation.property });
    } else if (draft[field.key] !== undefined && draft[field.key] !== field.initialValue) {
      pendingOperations.push(
        operationWithValue(field.operation, draft[field.key] ?? field.initialValue),
      );
    }
  }

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
  const children = elementSnapshot?.children ?? [];
  const box = elementSnapshot?.boxModel;
  const instanceCount = elementSnapshot?.instanceCount ?? 1;
  const showSharedBadge = instanceCount > 1 || target?.capabilities?.sharedDefinition === true;
  const itemIndex = elementSnapshot?.itemIndex;
  const showInlineHint = fields.some(
    (field) => field.operation.kind === 'set-text' && editable(field),
  );
  const textOnlyPending =
    pendingOperations.length > 0 &&
    pendingOperations.every((op) => op.kind === 'set-text' || op.kind === 'set-map-item-text');
  const showBottomFallback = !target || fields.length === 0 || locked.length > 0;

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
      <header className="flex flex-col gap-[var(--space-1_5)] px-[var(--space-4)] pt-[var(--space-3)] pb-[var(--space-2)]">
        <div className="flex items-start justify-between gap-[var(--space-2)]">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-[var(--space-1_5)] gap-y-[2px]">
            <h3 className="m-0 truncate text-[14px] font-semibold text-[var(--color-text-primary)]">
              {t(`inspector.kinds.${elementKind(tag)}`)}
              <span
                className="ml-[var(--space-1_5)] text-[11px] font-normal text-[var(--color-text-muted)]"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {tag.toLowerCase()}
              </span>
            </h3>
            {box ? (
              <span
                className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-surface-hover)] px-[5px] py-[1px] text-[10px] text-[var(--color-text-muted)]"
                style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}
              >
                {t('inspector.element.dimensions', {
                  width: Math.round(box.width),
                  height: Math.round(box.height),
                })}
              </span>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-[var(--space-1)]">
            {onUndo || onRedo ? (
              <div className="flex items-center gap-[2px]">
                {onUndo ? (
                  <button
                    type="button"
                    disabled={busy || !canUndo}
                    onClick={() => void onUndo()}
                    aria-label={t('inspector.element.undo')}
                    title={t('inspector.element.undo')}
                    className="inline-flex size-[24px] items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:pointer-events-none disabled:opacity-35"
                  >
                    <Undo2 className="size-[13px]" aria-hidden />
                  </button>
                ) : null}
                {onRedo ? (
                  <button
                    type="button"
                    disabled={busy || !canRedo}
                    onClick={() => void onRedo()}
                    aria-label={t('inspector.element.redo')}
                    title={t('inspector.element.redo')}
                    className="inline-flex size-[24px] items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:pointer-events-none disabled:opacity-35"
                  >
                    <Redo2 className="size-[13px]" aria-hidden />
                  </button>
                ) : null}
              </div>
            ) : null}

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
          </div>
        </div>

        {showSharedBadge ||
        (target?.mapSource && itemIndex !== undefined) ||
        (onAskAi && !showBottomFallback) ? (
          <div className="flex flex-wrap items-center justify-between gap-[var(--space-1)]">
            <div className="flex flex-wrap items-center gap-[var(--space-1)]">
              {showSharedBadge ? (
                <span
                  className="rounded-full bg-[var(--color-accent-tint)] px-[6px] py-[1px] text-[10px] text-[var(--color-accent)]"
                  title={t('inspector.element.shared')}
                >
                  {t('inspector.element.sharedBadge', { count: instanceCount })}
                </span>
              ) : null}
              {target?.mapSource && itemIndex !== undefined ? (
                <span className="rounded-full bg-[var(--color-surface-hover)] px-[6px] py-[1px] text-[10px] text-[var(--color-text-secondary)]">
                  {t('inspector.element.itemBadge', { index: itemIndex + 1 })}
                </span>
              ) : null}
            </div>
            {onAskAi && !showBottomFallback ? (
              <button
                type="button"
                onClick={onAskAi}
                disabled={busy}
                className="inline-flex items-center gap-[4px] rounded-full border border-[var(--color-border)] px-[var(--space-2)] py-[2px] text-[11px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent-tint)] disabled:opacity-50"
              >
                <Sparkles className="size-[11px]" aria-hidden />
                {t('inspector.element.askAi')}
              </button>
            ) : null}
          </div>
        ) : null}

        {children.length > 0 ? (
          <div className="flex flex-wrap items-center gap-[4px] pt-[2px]">
            <span className="text-[10px] uppercase text-[var(--color-text-muted)]">
              {t('inspector.element.children')}
            </span>
            {children.slice(0, 6).map((child) => {
              const kindName = t(`inspector.kinds.${elementKind(child.tagName)}`);
              return (
                <button
                  key={child.selector}
                  type="button"
                  disabled={busy}
                  aria-label={t('inspector.element.selectChild', { name: kindName })}
                  title={
                    child.textPreview ? `${child.tagName}: ${child.textPreview}` : child.tagName
                  }
                  onClick={() => onSelectAncestor(child.selector)}
                  className="max-w-[110px] truncate rounded-[var(--radius-sm)] bg-[var(--color-surface-hover)] px-[6px] py-[2px] text-[10px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  {child.tagName}
                  {child.textPreview ? ` · ${child.textPreview}` : ''}
                </button>
              );
            })}
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
        {sections.map((section) => (
          <InspectorSection
            key={section.group}
            title={t(`inspector.groups.${section.group}`)}
            collapsible
            defaultOpen={section.defaultOpen}
            onHoverChange={section.group === 'spacing' ? onHighlightBoxModel : undefined}
          >
            {section.group === 'spacing' && box ? (
              <div
                className="flex items-center justify-between rounded-[var(--radius-sm)] bg-[var(--color-surface-hover)] px-[var(--space-2)] py-[4px] text-[10px] text-[var(--color-text-muted)]"
                style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}
              >
                <span>
                  {Math.round(box.width)} × {Math.round(box.height)}
                </span>
                <span>
                  {t('inspector.element.boxPadding')}: {box.padding.top}/{box.padding.right}/
                  {box.padding.bottom}/{box.padding.left}
                </span>
              </div>
            ) : null}

            {section.fields.map((field) => {
              const id = `${baseId}-${field.key}`;
              const hintId = `${id}-hint`;
              const value = draft[field.key] ?? field.initialValue;
              const isRemoved = draftRemoved[field.key] === true;
              const fieldEditable = editable(field);
              const disabled = busy || !fieldEditable;
              const issueStatus = inspectorFieldIssueStatus(target, field, fieldStates);

              const set = (next: string) => {
                setDraftRemoved((prev) => {
                  if (!prev[field.key]) return prev;
                  const copy = { ...prev };
                  delete copy[field.key];
                  return copy;
                });
                setDraft((prev) => {
                  if (next === field.initialValue) {
                    if (!(field.key in prev)) return prev;
                    const copy = { ...prev };
                    delete copy[field.key];
                    return copy;
                  }
                  return { ...prev, [field.key]: next };
                });
              };

              const label =
                field.textIndex !== undefined
                  ? t('inspector.fields.textN', { n: field.textIndex })
                  : (field.customLabel ?? t(`inspector.fields.${field.labelKey}`));

              const hint = issueStatus
                ? t(`canvas.sourceEdit.fieldState.${issueStatus}`)
                : field.provenance === 'locked' && field.bindingLabel
                  ? t('inspector.provenance.tokenNamed', { name: field.bindingLabel })
                  : field.shared
                    ? t('inspector.element.shared')
                    : undefined;

              const provenanceTitle =
                field.provenance === 'token' && field.bindingLabel
                  ? t('inspector.provenance.tokenNamed', { name: field.bindingLabel })
                  : t(`inspector.provenance.${field.provenance}`);

              const canResetStyle =
                field.authored &&
                field.operation.kind === 'set-style' &&
                target?.capabilities?.canUpsertStyle === true &&
                !disabled;

              const describedBy = hint ? hintId : busy && fields.length > 0 ? statusId : undefined;

              return (
                <FieldRow
                  key={field.key}
                  label={label}
                  htmlFor={id}
                  hint={hint}
                  hintId={hint ? hintId : undefined}
                  provenance={field.provenance}
                  provenanceTitle={provenanceTitle}
                  isRemoved={isRemoved}
                  onReset={
                    canResetStyle
                      ? () =>
                          setDraftRemoved((prev) => ({
                            ...prev,
                            [field.key]: !prev[field.key],
                          }))
                      : undefined
                  }
                  resetLabel={
                    canResetStyle
                      ? isRemoved
                        ? t('inspector.element.restoreStyle')
                        : t('inspector.element.resetStyle')
                      : undefined
                  }
                  onScrub={
                    !disabled && field.control === 'length'
                      ? lengthScrub(value, set, field.allowNegative)
                      : undefined
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
                      describedBy={describedBy}
                    />
                  ) : field.control === 'length' ? (
                    <LengthField
                      id={id}
                      value={value}
                      onChange={set}
                      disabled={disabled}
                      allowNegative={field.allowNegative}
                      describedBy={describedBy}
                    />
                  ) : field.control === 'box' ? (
                    <BoxField
                      id={id}
                      value={value}
                      onChange={set}
                      disabled={disabled}
                      allowNegative={field.allowNegative}
                      describedBy={describedBy}
                    />
                  ) : field.control === 'slider' ? (
                    <SliderNumberField
                      id={id}
                      ariaLabel={label}
                      value={value}
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      onChange={set}
                      disabled={disabled}
                      describedBy={describedBy}
                    />
                  ) : field.control === 'segmented' && field.options ? (
                    <SegmentedControl
                      id={id}
                      ariaLabel={label}
                      value={value}
                      disabled={disabled}
                      onChange={set}
                      options={field.options.map((opt) => ({
                        value: opt.value,
                        label: t(`inspector.${opt.labelKey}`),
                        ...(field.labelKey === 'textAlign' && ALIGN_ICONS[opt.value]
                          ? { icon: ALIGN_ICONS[opt.value] }
                          : {}),
                      }))}
                    />
                  ) : field.control === 'select' && field.options ? (
                    <SelectField
                      id={id}
                      ariaLabel={label}
                      value={value}
                      disabled={disabled}
                      onChange={set}
                      describedBy={describedBy}
                      options={field.options.map((opt) => ({
                        value: opt.value,
                        label: t(`inspector.${opt.labelKey}`),
                      }))}
                    />
                  ) : (
                    <TextField
                      id={id}
                      value={value}
                      onChange={set}
                      disabled={disabled}
                      multiline={field.control === 'text'}
                      describedBy={describedBy}
                      mono={field.control === 'className'}
                    />
                  )}
                </FieldRow>
              );
            })}

            {section.group === 'content' && showInlineHint ? (
              <p className="m-0 text-[10px] leading-[var(--leading-snug)] text-[var(--color-text-muted)]">
                {t('inspector.element.inlineTextHint')}
              </p>
            ) : null}
          </InspectorSection>
        ))}

        {showBottomFallback ? (
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
          <div className="flex min-w-0 flex-col">
            <span
              id={statusId}
              className="min-w-0 truncate text-[11px] text-[var(--color-text-muted)]"
              aria-live="polite"
            >
              {busy
                ? t('inspector.element.applying')
                : pendingOperations.length > 0
                  ? t('inspector.element.pending', { count: pendingOperations.length })
                  : t('inspector.element.noPending')}
            </span>
            {!busy && pendingOperations.length > 0 ? (
              <span className="truncate text-[10px] text-[var(--color-text-muted)]">
                {textOnlyPending
                  ? t('inspector.element.pendingText', { count: pendingOperations.length })
                  : t('inspector.element.reloadNote')}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-[var(--space-1)]">
            <button
              type="button"
              disabled={busy || pendingOperations.length === 0}
              onClick={() => {
                setDraft({});
                setDraftRemoved({});
              }}
              className="rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40"
            >
              {t('inspector.element.discard')}
            </button>
            <button
              type="button"
              disabled={busy || pendingOperations.length === 0}
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
