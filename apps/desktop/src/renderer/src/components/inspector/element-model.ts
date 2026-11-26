import {
  type SourceEditOperation,
  type SourceEditTarget,
  sourceEditFieldKey,
} from '@open-codesign/shared';

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

export type FieldGroup = 'content' | 'color' | 'layout' | 'accessibility';
export type FieldControl = 'text' | 'color' | 'length' | 'box' | 'attribute';

export interface InspectorField {
  key: string;
  group: FieldGroup;
  control: FieldControl;
  operation: SourceEditOperation;
  /** Label key under `inspector.fields`. */
  labelKey: string;
  /** 1-based position among several text segments of one element. */
  textIndex?: number;
  /** The text comes from a shared definition, so every use changes together. */
  shared: boolean;
}

export const FIELD_GROUP_ORDER: readonly FieldGroup[] = [
  'content',
  'color',
  'layout',
  'accessibility',
];

const DIRECT_TEXT_ORIGIN = 'JSX text definition';

function fieldFor(target: SourceEditTarget, operation: SourceEditOperation): InspectorField {
  const key = sourceEditFieldKey(operation);
  if (operation.kind === 'set-text') {
    const origin = target.textSources?.find((item) => item.textId === operation.textId)?.origin;
    return {
      key,
      group: 'content',
      control: 'text',
      operation,
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
      labelKey: operation.name,
      shared: false,
    };
  }
  const color = operation.property === 'color' || operation.property === 'backgroundColor';
  return {
    key,
    group: color ? 'color' : 'layout',
    control: color ? 'color' : operation.property === 'padding' ? 'box' : 'length',
    operation,
    labelKey: operation.property,
    shared: false,
  };
}

export function inspectorFields(target: SourceEditTarget): InspectorField[] {
  const fields = target.editableFields.map((operation) => fieldFor(target, operation));
  const texts = fields.filter((field) => field.control === 'text');
  if (texts.length > 1) texts.forEach((field, index) => (field.textIndex = index + 1));
  return fields;
}

export function groupInspectorFields(
  fields: readonly InspectorField[],
): Array<{ group: FieldGroup; fields: InspectorField[] }> {
  return FIELD_GROUP_ORDER.flatMap((group) => {
    const members = fields.filter((field) => field.group === group);
    return members.length > 0 ? [{ group, fields: members }] : [];
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
  return { ...operation, value };
}

export interface PreviewDraft {
  styles: Partial<Record<string, string>>;
  attributes: Partial<Record<string, string>>;
}

export function previewDraftFor(operations: readonly SourceEditOperation[]): PreviewDraft {
  const draft: PreviewDraft = { styles: {}, attributes: {} };
  for (const operation of operations) {
    if (operation.kind === 'set-style') draft.styles[operation.property] = operation.value;
    else if (operation.kind === 'set-attribute') draft.attributes[operation.name] = operation.value;
  }
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
