import {
  SourceEditAttributeName,
  type SourceEditMapItemBinding,
  type SourceEditMapSource,
  SourceEditStyleProperty,
  type SourceEditTarget,
} from '@open-codesign/shared';
import type { SourceEditBindingPlan, SourceEditFieldState } from './source-edit-binding';

export const SOURCE_EDIT_ATTRIBUTE = 'data-codesign-source-id';
export const SOURCE_EDIT_ITEM_INDEX_ATTRIBUTE = 'data-codesign-item-index';
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
    Partial<Pick<SourceEditTarget, 'editableFields' | 'textLayout' | 'mapSource'>>)[];
  mapItemBindings?: readonly SourceEditMapItemBinding[] | undefined;
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
  mapSources?: Record<string, SourceEditMapSource>;
}

const VALID_FIELD_STATUSES = new Set(['ready', 'changed', 'ambiguous', 'unmapped']);

function isValidSelectionFieldKey(key: string): boolean {
  if (key === 'className' || key === 'visibility') return true;
  if (key.startsWith('text:')) return /^text:(?:only|\d{1,10}:\d{1,10})$/.test(key);
  if (key.startsWith('attribute:')) {
    return SourceEditAttributeName.safeParse(key.slice('attribute:'.length)).success;
  }
  if (key.startsWith('style:')) {
    return SourceEditStyleProperty.safeParse(key.slice('style:'.length)).success;
  }
  if (key.startsWith('map-text:')) {
    const match = /^map-text:(\d{1,4}):([\s\S]{1,128})$/.exec(key);
    return match !== null && Number(match[1]) <= 1_000;
  }
  if (key.startsWith('structure:')) {
    const match = /^structure:(?:reorder|duplicate|delete)(?::(\d{1,4}))?$/.exec(key);
    return match !== null && (match[1] === undefined || Number(match[1]) <= 1_000);
  }
  return false;
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
            isValidSelectionFieldKey(field.key) &&
            VALID_FIELD_STATUSES.has(field.status) &&
            (field.message === undefined ||
              (typeof field.message === 'string' && field.message.length <= 500)) &&
            Object.keys(field).every((key) => ['key', 'status', 'message'].includes(key)),
        )))
  );
}

function isValidOpeningEnd(source: string, offset: number): boolean {
  return (
    offset >= 0 &&
    offset < source.length &&
    (source[offset] === '>' || source.slice(offset, offset + 2) === '/>')
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
  opts?: { html?: boolean },
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
  const allowCaseInsensitiveTag =
    opts?.html === true || /^\s*(?:<!doctype\b|<html\b)/i.test(source.slice(0, 2048));
  const targets: Record<string, string> = {};
  const directTexts: Record<string, string> = {};
  const fieldPlans: Record<string, SourceEditBindingPlan> = {};
  const mapSources: Record<string, SourceEditMapSource> = {};
  const offsets = new Set<number>();
  const editsByOffset = new Map<number, string[]>();
  const pushEdit = (offset: number, text: string) => {
    const existing = editsByOffset.get(offset);
    if (existing) existing.push(text);
    else editsByOffset.set(offset, [text]);
  };

  for (const target of plan.targets) {
    const openPrefix = target
      ? source.slice(target.start, target.start + target.tagName.length + 1)
      : '';
    const expectedPrefix = target ? `<${target.tagName}` : '';
    const matchesTag = allowCaseInsensitiveTag
      ? openPrefix.toLowerCase() === expectedPrefix.toLowerCase()
      : openPrefix === expectedPrefix;
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
      !matchesTag ||
      !/^[\s/>]$/.test(source[target.start + target.tagName.length + 1] ?? '') ||
      !isValidOpeningEnd(source, target.insertionOffset) ||
      Object.hasOwn(targets, target.id) ||
      offsets.has(target.insertionOffset)
    ) {
      throw new Error('Invalid source edit target plan.');
    }
    targets[target.id] = target.tagName;
    if (typeof target.directText === 'string') directTexts[target.id] = target.directText;
    if (target.textLayout && target.editableFields) {
      fieldPlans[target.id] = {
        textLayout: target.textLayout,
        editableFields: target.editableFields,
        ...(target.mapSource ? { mapSource: target.mapSource } : {}),
      };
    }
    if (target.mapSource) mapSources[target.id] = target.mapSource;
    offsets.add(target.insertionOffset);
    pushEdit(
      target.insertionOffset,
      ` ${SOURCE_EDIT_ATTRIBUTE}="${plan.previewRevision}:${target.id}"`,
    );
  }

  if (plan.mapItemBindings !== undefined) {
    if (
      opts?.html ||
      !Array.isArray(plan.mapItemBindings) ||
      plan.mapItemBindings.length > MAX_SOURCE_EDIT_TARGETS
    ) {
      throw new Error('Invalid source edit target plan.');
    }
    const rootOffsets = new Set<number>();
    for (const binding of plan.mapItemBindings) {
      if (
        !binding ||
        typeof binding !== 'object' ||
        typeof binding.targetId !== 'string' ||
        !/^\d{1,10}:\d{1,10}$/.test(binding.targetId) ||
        !Number.isSafeInteger(binding.paramsStart) ||
        !Number.isSafeInteger(binding.paramsEnd) ||
        !Number.isSafeInteger(binding.rootInsertionOffset) ||
        typeof binding.wrapParens !== 'boolean' ||
        binding.paramsStart < 0 ||
        binding.paramsStart > binding.paramsEnd ||
        binding.paramsEnd > source.length ||
        !isValidOpeningEnd(source, binding.rootInsertionOffset) ||
        rootOffsets.has(binding.rootInsertionOffset) ||
        (binding.existingIndexName !== undefined &&
          (typeof binding.existingIndexName !== 'string' ||
            !/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(binding.existingIndexName)))
      ) {
        throw new Error('Invalid source edit target plan.');
      }
      rootOffsets.add(binding.rootInsertionOffset);
      const idxName = binding.existingIndexName ?? '__csIdx';
      pushEdit(binding.rootInsertionOffset, ` ${SOURCE_EDIT_ITEM_INDEX_ATTRIBUTE}={${idxName}}`);
      if (!binding.existingIndexName) {
        if (binding.wrapParens) {
          pushEdit(binding.paramsStart, '(');
          pushEdit(binding.paramsEnd, ', __csIdx)');
        } else {
          pushEdit(binding.paramsEnd, ', __csIdx');
        }
      }
    }
  }

  const chunks: string[] = [];
  let end = source.length;
  const sortedOffsets = [...editsByOffset.keys()].sort((a, b) => b - a);
  for (const offset of sortedOffsets) {
    const insertions = editsByOffset.get(offset);
    if (!insertions) continue;
    chunks.push(source.slice(offset, end), insertions.join(''));
    end = offset;
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
      ...(Object.keys(mapSources).length ? { mapSources } : {}),
    },
  };
}
