import type { SourceEditTarget } from '@open-codesign/shared';
import type { SourceEditBindingPlan, SourceEditFieldState } from './source-edit-binding';

export const SOURCE_EDIT_ATTRIBUTE = 'data-codesign-source-id';
export const MAX_SOURCE_EDIT_TARGETS = 10_000;

export interface SourceEditPreviewOptions {
  /** Exact inspected source; the main process owns and verifies its SHA-256 hash. */
  source: string;
  sourceHash: string;
  previewRevision: string;
  targets: readonly (Pick<
    SourceEditTarget,
    'id' | 'tagName' | 'start' | 'end' | 'insertionOffset' | 'directText'
  > &
    Partial<Pick<SourceEditTarget, 'editableFields' | 'textLayout'>>)[];
}

export interface SourceEditSelection {
  targetId: string;
  sourceHash: string;
  previewRevision: string;
  fieldStates?: SourceEditFieldState[];
}

export interface SourceEditAncestor {
  selector: string;
  tagName: string;
}

export interface SourceEditOverlayContext {
  sourceHash: string;
  previewRevision: string;
  targets: Record<string, string>;
  directTexts?: Record<string, string>;
  fieldPlans?: Record<string, SourceEditBindingPlan>;
}

export function isSourceEditRevision(
  value: unknown,
): value is Pick<SourceEditSelection, 'sourceHash' | 'previewRevision'> {
  if (typeof value !== 'object' || value === null) return false;
  const revision = value as Partial<SourceEditSelection>;
  return (
    typeof revision.sourceHash === 'string' &&
    /^[a-f0-9]{64}$/.test(revision.sourceHash) &&
    typeof revision.previewRevision === 'string' &&
    /^[A-Za-z0-9_-]{1,128}$/.test(revision.previewRevision)
  );
}

/** This is an untrusted selection hint, never permission to write a source range. */
export function isSourceEditSelection(value: unknown): value is SourceEditSelection {
  if (!isSourceEditRevision(value)) return false;
  const selection = value as Partial<SourceEditSelection>;
  return (
    typeof selection.targetId === 'string' &&
    /^\d{1,10}:\d{1,10}$/.test(selection.targetId) &&
    Object.keys(value).every((key) =>
      ['targetId', 'sourceHash', 'previewRevision', 'fieldStates'].includes(key),
    ) &&
    (selection.fieldStates === undefined ||
      (Array.isArray(selection.fieldStates) &&
        selection.fieldStates.length <= 512 &&
        new Set(selection.fieldStates.map((field) => field?.key)).size ===
          selection.fieldStates.length &&
        selection.fieldStates.every(
          (field) =>
            field &&
            typeof field === 'object' &&
            typeof field.key === 'string' &&
            /^(?:text:(?:only|\d{1,10}:\d{1,10})|attribute:(?:title|placeholder|alt)|style:(?:color|backgroundColor|fontSize|gap|padding|borderRadius|maxWidth))$/.test(
              field.key,
            ) &&
            ['ready', 'changed', 'ambiguous', 'unmapped'].includes(field.status) &&
            (field.message === undefined ||
              (typeof field.message === 'string' && field.message.length <= 500)) &&
            Object.keys(field).every((key) => ['key', 'status', 'message'].includes(key)),
        )))
  );
}

/**
 * Accept only a successful main-process AST inspection of this exact source.
 * Main refuses edits on authored provenance attributes; their spelling in text,
 * comments or attribute values is legal and is not an attribute declaration.
 */
export function instrumentSourceForEditing(
  source: string,
  plan: SourceEditPreviewOptions,
): {
  source: string;
  context: SourceEditOverlayContext;
} {
  if (!plan || source !== plan.source || !isSourceEditRevision(plan)) {
    throw new Error('Source edit preview requires the exact inspected source and revision.');
  }

  if (!Array.isArray(plan.targets) || plan.targets.length > MAX_SOURCE_EDIT_TARGETS) {
    throw new Error('Invalid source edit target plan.');
  }
  const targets: Record<string, string> = {};
  const directTexts: Record<string, string> = {};
  const fieldPlans: Record<string, SourceEditBindingPlan> = {};
  const offsets = new Set<number>();
  for (const target of plan.targets) {
    if (
      !target ||
      typeof target.id !== 'string' ||
      !/^\d{1,10}:\d{1,10}$/.test(target.id) ||
      typeof target.tagName !== 'string' ||
      !/^[a-z][A-Za-z0-9-]*$/.test(target.tagName) ||
      !Number.isSafeInteger(target.start) ||
      !Number.isSafeInteger(target.end) ||
      !Number.isSafeInteger(target.insertionOffset) ||
      target.start < 0 ||
      target.end > source.length ||
      target.end <= target.insertionOffset ||
      target.id !== `${target.start}:${target.end}` ||
      target.insertionOffset < target.start + target.tagName.length + 1 ||
      source.slice(target.start, target.start + target.tagName.length + 1) !==
        `<${target.tagName}` ||
      !/^[\s/>]$/.test(source[target.start + target.tagName.length + 1] ?? '') ||
      (source[target.insertionOffset] !== '>' &&
        source.slice(target.insertionOffset, target.insertionOffset + 2) !== '/>') ||
      Object.hasOwn(targets, target.id) ||
      offsets.has(target.insertionOffset)
    ) {
      throw new Error('Invalid source edit target plan.');
    }
    targets[target.id] = target.tagName;
    if (typeof target.directText === 'string') directTexts[target.id] = target.directText;
    if (target.textLayout && target.editableFields)
      fieldPlans[target.id] = {
        textLayout: target.textLayout,
        editableFields: target.editableFields,
      };
    offsets.add(target.insertionOffset);
  }
  const chunks: string[] = [];
  let end = source.length;
  for (const target of [...plan.targets].sort((a, b) => b.insertionOffset - a.insertionOffset)) {
    chunks.push(
      source.slice(target.insertionOffset, end),
      ` ${SOURCE_EDIT_ATTRIBUTE}="${plan.previewRevision}:${target.id}"`,
    );
    end = target.insertionOffset;
  }
  chunks.push(source.slice(0, end));
  return {
    source: chunks.reverse().join(''),
    context: {
      sourceHash: plan.sourceHash,
      previewRevision: plan.previewRevision,
      targets,
      ...(Object.keys(directTexts).length ? { directTexts } : {}),
      ...(Object.keys(fieldPlans).length ? { fieldPlans } : {}),
    },
  };
}
