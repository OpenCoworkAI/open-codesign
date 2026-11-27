import type { SourceEditSelection } from '@open-codesign/runtime';
import {
  type SourceEditAttributeName,
  type SourceEditBoxSides,
  type SourceEditElementSnapshot,
  type SourceEditOperation,
  type SourceEditPreviewDraft,
  type SourceEditStyleBinding,
  type SourceEditStyleProperty,
  type SourceEditTarget,
  sourceEditFieldKey,
} from '@open-codesign/shared';
import { sourceEditFieldState } from '../../preview/helpers';
import { parseTweakCssVar } from './palette';

export type ElementKind =
  | 'heading'
  | 'paragraph'
  | 'text'
  | 'link'
  | 'button'
  | 'image'
  | 'input'
  | 'label'
  | 'list'
  | 'listItem'
  | 'header'
  | 'footer'
  | 'navigation'
  | 'main'
  | 'section'
  | 'form'
  | 'graphic'
  | 'media'
  | 'table'
  | 'container'
  | 'element';

const KIND_BY_TAG: Record<string, ElementKind> = {
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  p: 'paragraph',
  blockquote: 'paragraph',
  span: 'text',
  strong: 'text',
  em: 'text',
  small: 'text',
  b: 'text',
  i: 'text',
  code: 'text',
  a: 'link',
  button: 'button',
  img: 'image',
  picture: 'image',
  input: 'input',
  textarea: 'input',
  select: 'input',
  label: 'label',
  ul: 'list',
  ol: 'list',
  li: 'listItem',
  header: 'header',
  footer: 'footer',
  nav: 'navigation',
  main: 'main',
  section: 'section',
  article: 'section',
  aside: 'section',
  form: 'form',
  svg: 'graphic',
  video: 'media',
  audio: 'media',
  table: 'table',
  div: 'container',
  figure: 'container',
};

export function elementKind(tagName: string): ElementKind {
  return KIND_BY_TAG[tagName.toLowerCase()] ?? 'element';
}

export type FieldGroup =
  | 'content'
  | 'media'
  | 'appearance'
  | 'typography'
  | 'spacing'
  | 'layout'
  | 'classes'
  | 'color'
  | 'accessibility';

export type FieldControl =
  | 'text'
  | 'color'
  | 'length'
  | 'box'
  | 'attribute'
  | 'select'
  | 'segmented'
  | 'slider'
  | 'className';

export type FieldProvenance = 'authored' | 'token' | 'computed' | 'locked';

export interface FieldOption {
  value: string;
  labelKey: string;
}

export interface InspectorField {
  key: string;
  group: FieldGroup;
  control: FieldControl;
  operation: SourceEditOperation;
  /** Displayed initial value before any user edit in this draft. */
  initialValue: string;
  /** Source ownership / provenance of the initial value. */
  provenance: FieldProvenance;
  /** True when this field exists as a direct literal in `target.editableFields`. */
  authored: boolean;
  /** Optional token name or source binding expression shown in provenance hints. */
  bindingLabel?: string;
  /** Label key under `inspector.fields`. */
  labelKey: string;
  /** Explicit raw label for dynamic `.map()` item keys. */
  customLabel?: string;
  /** 1-based position among several text segments of one element. */
  textIndex?: number;
  /** The text comes from a shared definition, so every use changes together. */
  shared: boolean;
  /** Choices for `select` and `segmented` controls. */
  options?: readonly FieldOption[];
  /** Range parameters for `slider` controls. */
  min?: number;
  max?: number;
  step?: number;
  /** Allows negative numeric lengths (e.g. `margin`, `letterSpacing`). */
  allowNegative?: boolean;
}

export interface InspectorSectionDescriptor {
  group: FieldGroup;
  defaultOpen: boolean;
  fields: InspectorField[];
}

export const FIELD_GROUP_ORDER: readonly FieldGroup[] = [
  'content',
  'media',
  'appearance',
  'typography',
  'spacing',
  'layout',
  'classes',
  'color',
  'accessibility',
];

const LEGACY_FIELD_GROUP_ORDER: readonly FieldGroup[] = [
  'content',
  'color',
  'layout',
  'accessibility',
  'classes',
];

const DIRECT_TEXT_ORIGIN = 'JSX text definition';

const MEDIA_TAGS = new Set(['img', 'picture', 'video', 'audio']);
const NO_DEFAULT_TYPOGRAPHY_TAGS = new Set(['img', 'picture', 'video', 'audio', 'hr']);
const TEXT_FIRST_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'blockquote',
  'span',
  'strong',
  'em',
  'small',
  'b',
  'i',
  'code',
  'a',
  'button',
  'label',
  'li',
  'input',
  'textarea',
  'select',
]);
const ARIA_RELEVANT_TAGS = new Set(['a', 'button', 'input', 'textarea', 'select', 'nav']);

export const DISPLAY_OPTIONS: readonly FieldOption[] = [
  { value: 'block', labelKey: 'options.display.block' },
  { value: 'flex', labelKey: 'options.display.flex' },
  { value: 'grid', labelKey: 'options.display.grid' },
  { value: 'none', labelKey: 'options.display.hidden' },
];

export const FLEX_DIRECTION_OPTIONS: readonly FieldOption[] = [
  { value: 'row', labelKey: 'options.flexDirection.row' },
  { value: 'column', labelKey: 'options.flexDirection.column' },
  { value: 'row-reverse', labelKey: 'options.flexDirection.rowReverse' },
  { value: 'column-reverse', labelKey: 'options.flexDirection.columnReverse' },
];

export const JUSTIFY_CONTENT_OPTIONS: readonly FieldOption[] = [
  { value: 'flex-start', labelKey: 'options.justifyContent.flexStart' },
  { value: 'center', labelKey: 'options.justifyContent.center' },
  { value: 'flex-end', labelKey: 'options.justifyContent.flexEnd' },
  { value: 'space-between', labelKey: 'options.justifyContent.spaceBetween' },
  { value: 'space-around', labelKey: 'options.justifyContent.spaceAround' },
  { value: 'space-evenly', labelKey: 'options.justifyContent.spaceEvenly' },
];

export const ALIGN_ITEMS_OPTIONS: readonly FieldOption[] = [
  { value: 'stretch', labelKey: 'options.alignItems.stretch' },
  { value: 'flex-start', labelKey: 'options.alignItems.flexStart' },
  { value: 'center', labelKey: 'options.alignItems.center' },
  { value: 'flex-end', labelKey: 'options.alignItems.flexEnd' },
  { value: 'baseline', labelKey: 'options.alignItems.baseline' },
];

export const FLEX_WRAP_OPTIONS: readonly FieldOption[] = [
  { value: 'nowrap', labelKey: 'options.flexWrap.nowrap' },
  { value: 'wrap', labelKey: 'options.flexWrap.wrap' },
];

export const TEXT_ALIGN_OPTIONS: readonly FieldOption[] = [
  { value: 'left', labelKey: 'options.textAlign.left' },
  { value: 'center', labelKey: 'options.textAlign.center' },
  { value: 'right', labelKey: 'options.textAlign.right' },
  { value: 'justify', labelKey: 'options.textAlign.justify' },
];

export const TEXT_TRANSFORM_OPTIONS: readonly FieldOption[] = [
  { value: 'none', labelKey: 'options.textTransform.none' },
  { value: 'uppercase', labelKey: 'options.textTransform.uppercase' },
  { value: 'lowercase', labelKey: 'options.textTransform.lowercase' },
  { value: 'capitalize', labelKey: 'options.textTransform.capitalize' },
];

export const FONT_WEIGHT_OPTIONS: readonly FieldOption[] = [
  { value: '300', labelKey: 'options.fontWeight.light' },
  { value: '400', labelKey: 'options.fontWeight.regular' },
  { value: '500', labelKey: 'options.fontWeight.medium' },
  { value: '600', labelKey: 'options.fontWeight.semibold' },
  { value: '700', labelKey: 'options.fontWeight.bold' },
  { value: '800', labelKey: 'options.fontWeight.extrabold' },
];

export const FONT_FAMILY_OPTIONS: readonly FieldOption[] = [
  { value: 'system-ui, -apple-system, sans-serif', labelKey: 'options.fontFamily.system' },
  { value: 'Inter, system-ui, sans-serif', labelKey: 'options.fontFamily.sans' },
  { value: 'Georgia, Cambria, serif', labelKey: 'options.fontFamily.serif' },
  { value: 'ui-monospace, SFMono-Regular, monospace', labelKey: 'options.fontFamily.mono' },
  { value: 'Fraunces, Georgia, serif', labelKey: 'options.fontFamily.display' },
];

export const BOX_SHADOW_OPTIONS: readonly FieldOption[] = [
  { value: 'none', labelKey: 'options.boxShadow.none' },
  { value: '0 1px 2px rgba(0, 0, 0, 0.06)', labelKey: 'options.boxShadow.subtle' },
  { value: '0 4px 16px rgba(0, 0, 0, 0.08)', labelKey: 'options.boxShadow.card' },
  { value: '0 12px 32px rgba(0, 0, 0, 0.14)', labelKey: 'options.boxShadow.elevated' },
];

export const OBJECT_FIT_OPTIONS: readonly FieldOption[] = [
  { value: 'cover', labelKey: 'options.objectFit.cover' },
  { value: 'contain', labelKey: 'options.objectFit.contain' },
  { value: 'fill', labelKey: 'options.objectFit.fill' },
  { value: 'none', labelKey: 'options.objectFit.none' },
  { value: 'scale-down', labelKey: 'options.objectFit.scaleDown' },
];

export const OVERFLOW_OPTIONS: readonly FieldOption[] = [
  { value: 'visible', labelKey: 'options.overflow.visible' },
  { value: 'hidden', labelKey: 'options.overflow.hidden' },
  { value: 'auto', labelKey: 'options.overflow.auto' },
  { value: 'scroll', labelKey: 'options.overflow.scroll' },
];

function formatBoxSides(sides: SourceEditBoxSides): string {
  const { top, right, bottom, left } = sides;
  if (top === right && right === bottom && bottom === left) return `${top}px`;
  if (top === bottom && left === right) return `${top}px ${right}px`;
  return `${top}px ${right}px ${bottom}px ${left}px`;
}

function boxModelFallback(
  property: SourceEditStyleProperty,
  snapshot: SourceEditElementSnapshot | null | undefined,
): string | undefined {
  if (!snapshot) return undefined;
  if (property === 'padding') return formatBoxSides(snapshot.boxModel.padding);
  if (property === 'margin') return formatBoxSides(snapshot.boxModel.margin);
  if (property === 'borderWidth') return formatBoxSides(snapshot.boxModel.border);
  return undefined;
}

function isColorLikeValue(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.startsWith('#') ||
    /^(?:rgb|rgba|hsl|hsla)\(/i.test(trimmed) ||
    parseTweakCssVar(trimmed) !== null
  );
}

function styleControlMeta(
  property: SourceEditStyleProperty,
  value: string,
): Pick<InspectorField, 'control' | 'options' | 'min' | 'max' | 'step' | 'allowNegative'> {
  switch (property) {
    case 'color':
    case 'backgroundColor':
    case 'borderColor':
      return { control: 'color' };
    case 'background':
      return { control: !value || isColorLikeValue(value) ? 'color' : 'text' };
    case 'opacity':
      return { control: 'slider', min: 0, max: 1, step: 0.05 };
    case 'padding':
      return { control: 'box' };
    case 'margin':
      return { control: 'box', allowNegative: true };
    case 'borderRadius': {
      const box = parseBox(value);
      return { control: box && box.length > 1 ? 'box' : 'length' };
    }
    case 'letterSpacing':
      return { control: 'length', allowNegative: true };
    case 'fontSize':
    case 'lineHeight':
    case 'gap':
    case 'width':
    case 'height':
    case 'maxWidth':
    case 'minHeight':
    case 'borderWidth':
      return { control: 'length' };
    case 'display':
      return { control: 'segmented', options: DISPLAY_OPTIONS };
    case 'flexDirection':
      return { control: 'segmented', options: FLEX_DIRECTION_OPTIONS };
    case 'flexWrap':
      return { control: 'segmented', options: FLEX_WRAP_OPTIONS };
    case 'textAlign':
      return { control: 'segmented', options: TEXT_ALIGN_OPTIONS };
    case 'fontFamily':
      return { control: 'select', options: FONT_FAMILY_OPTIONS };
    case 'fontWeight':
      return { control: 'select', options: FONT_WEIGHT_OPTIONS };
    case 'textTransform':
      return { control: 'select', options: TEXT_TRANSFORM_OPTIONS };
    case 'boxShadow':
      return { control: 'select', options: BOX_SHADOW_OPTIONS };
    case 'justifyContent':
      return { control: 'select', options: JUSTIFY_CONTENT_OPTIONS };
    case 'alignItems':
      return { control: 'select', options: ALIGN_ITEMS_OPTIONS };
    case 'objectFit':
      return { control: 'select', options: OBJECT_FIT_OPTIONS };
    case 'overflow':
      return { control: 'select', options: OVERFLOW_OPTIONS };
    case 'border':
    case 'gridTemplateColumns':
      return { control: 'text' };
  }
}

function legacyStyleGroup(property: SourceEditStyleProperty): FieldGroup {
  return property === 'color' || property === 'backgroundColor' ? 'color' : 'layout';
}

function semanticStyleGroup(property: SourceEditStyleProperty, tagName: string): FieldGroup {
  switch (property) {
    case 'background':
    case 'backgroundColor':
    case 'opacity':
    case 'borderRadius':
    case 'border':
    case 'borderColor':
    case 'borderWidth':
    case 'boxShadow':
      return 'appearance';
    case 'color':
    case 'fontFamily':
    case 'fontSize':
    case 'fontWeight':
    case 'lineHeight':
    case 'letterSpacing':
    case 'textAlign':
    case 'textTransform':
      return 'typography';
    case 'padding':
    case 'margin':
      return 'spacing';
    case 'objectFit':
      return MEDIA_TAGS.has(tagName) ? 'media' : 'appearance';
    case 'display':
    case 'flexDirection':
    case 'justifyContent':
    case 'alignItems':
    case 'flexWrap':
    case 'gridTemplateColumns':
    case 'gap':
    case 'width':
    case 'height':
    case 'maxWidth':
    case 'minHeight':
    case 'overflow':
      return 'layout';
  }
}

export function operationValue(operation: SourceEditOperation): string {
  switch (operation.kind) {
    case 'set-text':
    case 'set-attribute':
    case 'set-style':
    case 'set-class-name':
    case 'set-map-item-text':
      return operation.value;
    case 'toggle-visibility':
      return operation.hidden ? 'none' : 'visible';
    default:
      return '';
  }
}

function legacyFieldFor(target: SourceEditTarget, operation: SourceEditOperation): InspectorField {
  const key = sourceEditFieldKey(operation);
  if (operation.kind === 'set-text') {
    const origin = target.textSources?.find((item) => item.textId === operation.textId)?.origin;
    return {
      key,
      group: 'content',
      control: 'text',
      operation,
      initialValue: operation.value,
      provenance: 'authored',
      authored: true,
      labelKey: 'text',
      shared: origin !== undefined && !origin.startsWith(DIRECT_TEXT_ORIGIN),
    };
  }
  if (operation.kind === 'set-attribute') {
    return {
      key,
      group: 'accessibility',
      control: 'attribute',
      operation,
      initialValue: operation.value,
      provenance: 'authored',
      authored: true,
      labelKey: operation.name,
      shared: false,
    };
  }
  if (operation.kind === 'set-class-name') {
    return {
      key,
      group: 'classes',
      control: 'className',
      operation,
      initialValue: operation.value,
      provenance: 'authored',
      authored: true,
      labelKey: 'className',
      shared: false,
    };
  }
  if (operation.kind === 'set-style') {
    const color = operation.property === 'color' || operation.property === 'backgroundColor';
    return {
      key,
      group: legacyStyleGroup(operation.property),
      control: color ? 'color' : operation.property === 'padding' ? 'box' : 'length',
      operation,
      initialValue: operation.value,
      provenance: parseTweakCssVar(operation.value) ? 'token' : 'authored',
      authored: true,
      labelKey: operation.property,
      shared: false,
    };
  }
  return {
    key,
    group: 'content',
    control: 'text',
    operation,
    initialValue: operationValue(operation),
    provenance: 'authored',
    authored: true,
    labelKey: operation.kind,
    shared: false,
  };
}

export function inspectorFields(target: SourceEditTarget): InspectorField[] {
  const fields = target.editableFields.map((operation) => legacyFieldFor(target, operation));
  const texts = fields.filter((field) => field.control === 'text');
  if (texts.length > 1) texts.forEach((field, index) => (field.textIndex = index + 1));
  return fields;
}

export function groupInspectorFields(
  fields: readonly InspectorField[],
): Array<{ group: FieldGroup; fields: InspectorField[] }> {
  return LEGACY_FIELD_GROUP_ORDER.flatMap((group) => {
    const members = fields.filter((field) => field.group === group);
    return members.length > 0 ? [{ group, fields: members }] : [];
  });
}

function explicitFieldState(
  states: SourceEditSelection['fieldStates'],
  key: string,
): NonNullable<SourceEditSelection['fieldStates']>[number] | undefined {
  const matching = states?.filter((state) => state.key === key);
  return matching?.length === 1 ? matching[0] : undefined;
}

/** Resolves whether an inspector field can currently be edited and written to source. */
export function isInspectorFieldEditable(
  target: SourceEditTarget | null,
  field: InspectorField,
  fieldStates: SourceEditSelection['fieldStates'],
): boolean {
  if (!target || field.provenance === 'locked') return false;
  if (field.authored && field.operation.kind !== 'set-map-item-text') {
    return sourceEditFieldState(target, field.operation, fieldStates).status === 'ready';
  }
  const explicit = explicitFieldState(fieldStates, field.key);
  if (explicit && explicit.status !== 'ready') return false;
  switch (field.operation.kind) {
    case 'set-style':
    case 'remove-style':
    case 'toggle-visibility':
      return target.capabilities?.canUpsertStyle === true;
    case 'set-attribute':
    case 'remove-attribute':
      return target.capabilities?.canUpsertAttribute === true;
    case 'set-class-name':
      return target.capabilities?.canEditClassName === true;
    case 'set-map-item-text':
      return Boolean(target.mapSource);
    default:
      return false;
  }
}

/** Returns the status hint code when a field is blocked/locked by runtime validation. */
export function inspectorFieldIssueStatus(
  target: SourceEditTarget | null,
  field: InspectorField,
  fieldStates: SourceEditSelection['fieldStates'],
): 'changed' | 'ambiguous' | 'unmapped' | null {
  if (!target) return 'unmapped';
  if (field.authored && field.operation.kind !== 'set-map-item-text') {
    const status = sourceEditFieldState(target, field.operation, fieldStates).status;
    return status === 'ready' ? null : status;
  }
  const explicit = explicitFieldState(fieldStates, field.key);
  if (explicit && explicit.status !== 'ready') return explicit.status;
  return null;
}

function buildTextField(
  target: SourceEditTarget,
  operation: Extract<SourceEditOperation, { kind: 'set-text' }>,
  textIndex: number | undefined,
  fieldStates: SourceEditSelection['fieldStates'],
): InspectorField {
  const key = sourceEditFieldKey(operation);
  const origin = target.textSources?.find((item) => item.textId === operation.textId)?.origin;
  const status = sourceEditFieldState(target, operation, fieldStates).status;
  return {
    key,
    group: 'content',
    control: 'text',
    operation,
    initialValue: operation.value,
    provenance: status === 'ready' ? 'authored' : 'locked',
    authored: true,
    labelKey: 'text',
    ...(textIndex !== undefined ? { textIndex } : {}),
    shared: origin !== undefined && !origin.startsWith(DIRECT_TEXT_ORIGIN),
  };
}

function buildAttributeField(
  target: SourceEditTarget,
  name: SourceEditAttributeName,
  authoredOp: Extract<SourceEditOperation, { kind: 'set-attribute' }> | undefined,
  snapshot: SourceEditElementSnapshot | null | undefined,
  fieldStates: SourceEditSelection['fieldStates'],
  tagName: string,
): InspectorField {
  const key = `attribute:${name}`;
  const snapshotValue =
    name === 'href'
      ? snapshot?.elementMeta?.href
      : name === 'src'
        ? snapshot?.elementMeta?.src
        : undefined;
  const initialValue = authoredOp ? authoredOp.value : (snapshotValue ?? '');
  const operation: SourceEditOperation = authoredOp ?? {
    kind: 'set-attribute',
    name,
    value: initialValue,
  };
  const explicit = explicitFieldState(fieldStates, key);
  const stateStatus = authoredOp
    ? sourceEditFieldState(target, operation, fieldStates).status
    : (explicit?.status ?? 'ready');
  return {
    key,
    group: MEDIA_TAGS.has(tagName) && (name === 'src' || name === 'alt') ? 'media' : 'content',
    control: 'attribute',
    operation,
    initialValue,
    provenance: stateStatus !== 'ready' ? 'locked' : authoredOp ? 'authored' : 'computed',
    authored: Boolean(authoredOp),
    labelKey: name,
    shared: false,
  };
}

function buildStyleField(
  target: SourceEditTarget,
  property: SourceEditStyleProperty,
  authoredOp: Extract<SourceEditOperation, { kind: 'set-style' }> | undefined,
  binding: SourceEditStyleBinding | undefined,
  snapshot: SourceEditElementSnapshot | null | undefined,
  fieldStates: SourceEditSelection['fieldStates'],
  tagName: string,
): InspectorField {
  const key = `style:${property}`;
  const computed = snapshot?.computedStyle?.[property] ?? boxModelFallback(property, snapshot);
  const initialValue = authoredOp
    ? authoredOp.value
    : binding
      ? (computed ?? binding.expression)
      : (computed ?? '');
  const operation: SourceEditOperation = authoredOp ?? {
    kind: 'set-style',
    property,
    value: initialValue,
  };
  const explicit = explicitFieldState(fieldStates, key);
  const stateStatus = authoredOp
    ? sourceEditFieldState(target, operation, fieldStates).status
    : (explicit?.status ?? 'ready');
  const tweakVar = parseTweakCssVar(initialValue);
  let provenance: FieldProvenance;
  if (stateStatus !== 'ready' || (binding && !binding.editable && !authoredOp)) {
    provenance = 'locked';
  } else if (tweakVar !== null || binding?.tokenName) {
    provenance = 'token';
  } else if (authoredOp) {
    provenance = 'authored';
  } else if (binding) {
    provenance = 'token';
  } else {
    provenance = 'computed';
  }
  const bindingLabel = binding?.tokenName ?? tweakVar ?? binding?.expression;
  return {
    key,
    group: semanticStyleGroup(property, tagName),
    ...styleControlMeta(property, initialValue),
    operation,
    initialValue,
    provenance,
    authored: Boolean(authoredOp),
    ...(bindingLabel ? { bindingLabel } : {}),
    labelKey: property,
    shared: false,
  };
}

/**
 * Builds the element-driven inspector sections (`content`, `media`, `appearance`,
 * `typography`, `spacing`, `layout`, `classes`) from AST capabilities, bindings,
 * and live DOM computed styles while ensuring untouched computed properties
 * never emit source writes.
 */
export function buildElementInspectorSections(
  target: SourceEditTarget | null,
  elementSnapshot?: SourceEditElementSnapshot | null,
  fieldStates?: SourceEditSelection['fieldStates'],
  draftValues?: Record<string, string>,
): InspectorSectionDescriptor[] {
  if (!target) return [];
  const tagName = target.tagName.toLowerCase();
  const canUpsertStyle = target.capabilities?.canUpsertStyle === true;
  const canUpsertAttribute = target.capabilities?.canUpsertAttribute === true;
  const canEditClassName = target.capabilities?.canEditClassName === true;

  const authoredTexts: Extract<SourceEditOperation, { kind: 'set-text' }>[] = [];
  const authoredAttrs = new Map<
    SourceEditAttributeName,
    Extract<SourceEditOperation, { kind: 'set-attribute' }>
  >();
  const authoredStyles = new Map<
    SourceEditStyleProperty,
    Extract<SourceEditOperation, { kind: 'set-style' }>
  >();
  let authoredClassName: Extract<SourceEditOperation, { kind: 'set-class-name' }> | undefined;

  for (const op of target.editableFields) {
    if (op.kind === 'set-text') authoredTexts.push(op);
    else if (op.kind === 'set-attribute') authoredAttrs.set(op.name, op);
    else if (op.kind === 'set-style') authoredStyles.set(op.property, op);
    else if (op.kind === 'set-class-name') authoredClassName = op;
  }

  const styleBindings = new Map<SourceEditStyleProperty, SourceEditStyleBinding>();
  for (const binding of target.styleBindings ?? []) {
    styleBindings.set(binding.property, binding);
  }

  const fields: InspectorField[] = [];

  // 1. Text & `.map()` item text fields
  const multiText = authoredTexts.length > 1;
  authoredTexts.forEach((op, idx) => {
    fields.push(buildTextField(target, op, multiText ? idx + 1 : undefined, fieldStates));
  });

  if (target.mapSource && elementSnapshot?.itemIndex !== undefined) {
    const itemIndex = elementSnapshot.itemIndex;
    for (const mapField of target.mapSource.fields) {
      const value = mapField.values[itemIndex];
      if (value === undefined) continue;
      const op: SourceEditOperation = {
        kind: 'set-map-item-text',
        itemIndex,
        fieldKey: mapField.key,
        value,
      };
      const key = sourceEditFieldKey(op);
      const explicit = explicitFieldState(fieldStates, key);
      fields.push({
        key,
        group: 'content',
        control: 'text',
        operation: op,
        initialValue: value,
        provenance: explicit && explicit.status !== 'ready' ? 'locked' : 'authored',
        authored: true,
        labelKey: 'text',
        customLabel: mapField.property ?? mapField.key,
        shared: false,
      });
    }
  }

  // 2. Attributes (authored + tag-relevant upsertable attributes)
  const attrCandidates: SourceEditAttributeName[] = [
    'href',
    'src',
    'alt',
    'placeholder',
    'title',
    'aria-label',
  ];
  for (const attr of attrCandidates) {
    const authored = authoredAttrs.get(attr);
    const relevantToTag =
      canUpsertAttribute &&
      ((attr === 'href' && tagName === 'a') ||
        (attr === 'src' && (tagName === 'img' || tagName === 'video' || tagName === 'audio')) ||
        (attr === 'alt' && (tagName === 'img' || tagName === 'picture')) ||
        (attr === 'placeholder' && (tagName === 'input' || tagName === 'textarea')) ||
        (attr === 'aria-label' && ARIA_RELEVANT_TAGS.has(tagName)));
    if (authored || relevantToTag) {
      fields.push(
        buildAttributeField(target, attr, authored, elementSnapshot, fieldStates, tagName),
      );
    }
  }

  // 3. Style properties
  const seenStyles = new Set<SourceEditStyleProperty>();
  const addStyle = (prop: SourceEditStyleProperty) => {
    if (seenStyles.has(prop)) return;
    seenStyles.add(prop);
    fields.push(
      buildStyleField(
        target,
        prop,
        authoredStyles.get(prop),
        styleBindings.get(prop),
        elementSnapshot,
        fieldStates,
        tagName,
      ),
    );
  };

  if (!canUpsertStyle) {
    // Preserve exact authored style fields (and 0 inputs for SVGs / forwarded children).
    for (const prop of authoredStyles.keys()) addStyle(prop);
  } else {
    // Media
    if (
      tagName === 'img' ||
      tagName === 'video' ||
      authoredStyles.has('objectFit') ||
      styleBindings.has('objectFit')
    ) {
      addStyle('objectFit');
    }

    // Appearance
    if (authoredStyles.has('background') || styleBindings.has('background')) addStyle('background');
    addStyle('backgroundColor');
    addStyle('opacity');
    addStyle('borderRadius');
    if (authoredStyles.has('border') || styleBindings.has('border')) addStyle('border');
    addStyle('borderWidth');
    addStyle('borderColor');
    addStyle('boxShadow');

    // Typography (skip automatic typography controls on pure media/hr tags unless authored/bound)
    const typographyProps: readonly SourceEditStyleProperty[] = [
      'color',
      'fontFamily',
      'fontSize',
      'fontWeight',
      'lineHeight',
      'letterSpacing',
      'textAlign',
      'textTransform',
    ];
    for (const prop of typographyProps) {
      if (
        !NO_DEFAULT_TYPOGRAPHY_TAGS.has(tagName) ||
        authoredStyles.has(prop) ||
        styleBindings.has(prop)
      ) {
        addStyle(prop);
      }
    }

    // Spacing
    addStyle('padding');
    addStyle('margin');

    // Layout
    addStyle('display');
    const displayValue = (
      draftValues?.['style:display'] ??
      authoredStyles.get('display')?.value ??
      elementSnapshot?.computedStyle?.display ??
      ''
    )
      .trim()
      .toLowerCase();
    const isFlex = displayValue === 'flex' || displayValue === 'inline-flex';
    const isGrid = displayValue === 'grid' || displayValue === 'inline-grid';
    if (isFlex) {
      addStyle('flexDirection');
      addStyle('justifyContent');
      addStyle('alignItems');
      addStyle('flexWrap');
      addStyle('gap');
    } else if (isGrid) {
      addStyle('gridTemplateColumns');
      addStyle('justifyContent');
      addStyle('alignItems');
      addStyle('gap');
    } else {
      for (const prop of [
        'flexDirection',
        'justifyContent',
        'alignItems',
        'flexWrap',
        'gridTemplateColumns',
        'gap',
      ] as const) {
        if (authoredStyles.has(prop) || styleBindings.has(prop)) addStyle(prop);
      }
    }
    addStyle('width');
    addStyle('height');
    addStyle('maxWidth');
    addStyle('minHeight');
    addStyle('overflow');
  }

  // 4. Classes
  if (
    authoredClassName ||
    (canEditClassName &&
      (target.className !== undefined ||
        target.capabilities?.styleMode === 'tailwind' ||
        Boolean(elementSnapshot?.elementMeta?.className)))
  ) {
    const initialClass =
      authoredClassName?.value ?? target.className ?? elementSnapshot?.elementMeta?.className ?? '';
    const op: SourceEditOperation = authoredClassName ?? {
      kind: 'set-class-name',
      value: initialClass,
    };
    const explicit = explicitFieldState(fieldStates, 'className');
    fields.push({
      key: 'className',
      group: 'classes',
      control: 'className',
      operation: op,
      initialValue: initialClass,
      provenance:
        explicit && explicit.status !== 'ready'
          ? 'locked'
          : authoredClassName || target.className !== undefined
            ? 'authored'
            : 'computed',
      authored: Boolean(authoredClassName),
      labelKey: 'className',
      shared: false,
    });
  }

  // Group into ordered sections and determine defaultOpen state.
  const isMedia = MEDIA_TAGS.has(tagName);
  const isTextFirst = TEXT_FIRST_TAGS.has(tagName);
  return FIELD_GROUP_ORDER.flatMap((group) => {
    const members = fields.filter((field) => field.group === group);
    if (members.length === 0) return [];
    const hasAuthoredOrToken = members.some(
      (field) => field.authored || field.provenance === 'token',
    );
    let defaultOpen = hasAuthoredOrToken;
    if (!defaultOpen) {
      if (group === 'content' || group === 'media') defaultOpen = true;
      else if (group === 'appearance') defaultOpen = true;
      else if (group === 'typography') defaultOpen = isTextFirst && !isMedia;
      else if (group === 'spacing') defaultOpen = !isTextFirst;
      else if (group === 'layout') defaultOpen = !isTextFirst;
      else if (group === 'classes') defaultOpen = target.capabilities?.styleMode === 'tailwind';
    }
    return [{ group, defaultOpen, fields: members }];
  });
}

/**
 * The engine reports one entry per missing capability, several of which say
 * the same thing ("no inline style", "no static style"). Users only need each
 * distinct reason once.
 */
export function lockedReasons(target: SourceEditTarget | null): string[] {
  if (!target) return [];
  const reasons: string[] = [];
  for (const item of target.unsupported) {
    // Absence of an optional capability is not a lock on something the user can see.
    if (item.reason === 'no-static-attribute' || item.reason === 'no-inline-style') continue;
    if (!reasons.includes(item.reason)) reasons.push(item.reason);
  }
  return reasons;
}

export function operationWithValue(
  operation: SourceEditOperation,
  value: string,
): SourceEditOperation {
  switch (operation.kind) {
    case 'set-text':
    case 'set-attribute':
    case 'set-style':
    case 'set-class-name':
    case 'set-map-item-text':
      return { ...operation, value };
    case 'toggle-visibility':
      return { ...operation, hidden: value === 'none' || value === 'true' };
    default:
      return operation;
  }
}

export type PreviewDraft = SourceEditPreviewDraft;

export interface PreviewDraftMeta {
  /** Optional mapping from `.map()` fieldKey to DOM text key for live item preview. */
  mapFieldTextKeys?: Record<string, string>;
}

export function previewDraftFor(
  operations: readonly SourceEditOperation[],
  draftMeta?: PreviewDraftMeta,
): PreviewDraft {
  const styles: Partial<Record<string, string>> = {};
  const removedSet = new Set<string>();
  const attributes: Partial<Record<string, string>> = {};
  const texts: Record<string, string> = {};
  let className: string | undefined;
  let hidden: boolean | undefined;

  for (const operation of operations) {
    if (operation.kind === 'set-style') {
      styles[operation.property] = operation.value;
      removedSet.delete(operation.property);
    } else if (operation.kind === 'remove-style') {
      delete styles[operation.property];
      removedSet.add(operation.property);
    } else if (operation.kind === 'set-attribute') {
      attributes[operation.name] = operation.value;
    } else if (operation.kind === 'set-text') {
      texts[operation.textId ?? 'only'] = operation.value;
    } else if (operation.kind === 'set-map-item-text') {
      const mapped = draftMeta?.mapFieldTextKeys?.[operation.fieldKey];
      if (mapped) texts[mapped] = operation.value;
    } else if (operation.kind === 'set-class-name') {
      className = operation.value;
    } else if (operation.kind === 'toggle-visibility') {
      hidden = operation.hidden;
    }
  }

  const draft: PreviewDraft = { styles, attributes };
  if (removedSet.size > 0) draft.removedStyles = [...removedSet];
  if (Object.keys(texts).length > 0) draft.texts = texts;
  if (className !== undefined) draft.className = className;
  if (hidden !== undefined) draft.hidden = hidden;
  return draft;
}

const LENGTH_RE = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|em|rem|%|vh|vw|vmin|vmax|ch|ex)?$/;

export interface ParsedLength {
  amount: number;
  unit: string;
}

export function parseLength(value: string): ParsedLength | null {
  const match = LENGTH_RE.exec(value.trim());
  if (!match?.[1]) return null;
  const amount = Number(match[1]);
  return Number.isFinite(amount) ? { amount, unit: match[2] ?? '' } : null;
}

export function formatLength(length: ParsedLength): string {
  const rounded = Math.round(length.amount * 100) / 100;
  return `${rounded}${length.unit}`;
}

export function parseBox(value: string): ParsedLength[] | null {
  const parts = value.trim().split(/\s+/);
  if (parts.length < 1 || parts.length > 4) return null;
  const parsed = parts.map(parseLength);
  return parsed.every((item): item is ParsedLength => item !== null) ? parsed : null;
}
