import type { SourceEditTarget } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import {
  elementKind,
  formatLength,
  groupInspectorFields,
  inspectorFields,
  lockedReasons,
  operationWithValue,
  parseBox,
  parseLength,
  previewDraftFor,
} from './element-model';

const baseTarget: SourceEditTarget = {
  id: '10:40',
  tagName: 'BUTTON',
  start: 10,
  end: 40,
  insertionOffset: 17,
  scope: 'source-definition',
  editableFields: [],
  unsupported: [],
};

describe('inspector element-model', () => {
  it('maps HTML tags to human element kinds with fallback', () => {
    expect(elementKind('h2')).toBe('heading');
    expect(elementKind('BUTTON')).toBe('button');
    expect(elementKind('blockquote')).toBe('paragraph');
    expect(elementKind('custom-widget')).toBe('element');
  });

  it('shapes editable fields into semantic groups and marks shared text origins', () => {
    const target: SourceEditTarget = {
      ...baseTarget,
      editableFields: [
        { kind: 'set-text', textId: '1:5', value: 'Hello' },
        { kind: 'set-text', textId: '8:12', value: 'World' },
        { kind: 'set-style', property: 'color', value: '#112233' },
        { kind: 'set-style', property: 'backgroundColor', value: '#ffffff' },
        { kind: 'set-style', property: 'padding', value: '8px 16px' },
        { kind: 'set-style', property: 'gap', value: '12px' },
        { kind: 'set-attribute', name: 'title', value: 'Save item' },
      ],
      textSources: [
        { textId: '1:5', start: 0, end: 5, origin: 'JSX text definition' },
        { textId: '8:12', start: 6, end: 11, origin: 'const labels → string literal' },
      ],
    };
    const fields = inspectorFields(target);
    expect(
      fields.map((field) => ({
        group: field.group,
        control: field.control,
        labelKey: field.labelKey,
        textIndex: field.textIndex,
        shared: field.shared,
      })),
    ).toEqual([
      { group: 'content', control: 'text', labelKey: 'text', textIndex: 1, shared: false },
      { group: 'content', control: 'text', labelKey: 'text', textIndex: 2, shared: true },
      { group: 'color', control: 'color', labelKey: 'color', textIndex: undefined, shared: false },
      {
        group: 'color',
        control: 'color',
        labelKey: 'backgroundColor',
        textIndex: undefined,
        shared: false,
      },
      {
        group: 'layout',
        control: 'box',
        labelKey: 'padding',
        textIndex: undefined,
        shared: false,
      },
      { group: 'layout', control: 'length', labelKey: 'gap', textIndex: undefined, shared: false },
      {
        group: 'accessibility',
        control: 'attribute',
        labelKey: 'title',
        textIndex: undefined,
        shared: false,
      },
    ]);

    const grouped = groupInspectorFields(fields);
    expect(grouped.map((section) => section.group)).toEqual([
      'content',
      'color',
      'layout',
      'accessibility',
    ]);
    expect(grouped.map((section) => section.fields.length)).toEqual([2, 2, 2, 1]);
  });

  it('omits textIndex when only one text field exists and filters optional capability locks', () => {
    const target: SourceEditTarget = {
      ...baseTarget,
      editableFields: [{ kind: 'set-text', value: 'Only text' }],
      unsupported: [
        { field: 'attributes', reason: 'no-static-attribute', message: 'optional' },
        { field: 'style', reason: 'no-inline-style', message: 'optional' },
        { field: 'text', reason: 'dynamic-expression', message: 'first' },
        { field: 'style', reason: 'dynamic-expression', message: 'duplicate' },
        { field: 'attributes', reason: 'unsafe-attribute', message: 'locked' },
      ],
    };
    const fields = inspectorFields(target);
    expect(fields[0]?.textIndex).toBeUndefined();
    expect(lockedReasons(null)).toEqual([]);
    expect(lockedReasons(target)).toEqual(['dynamic-expression', 'unsafe-attribute']);
  });

  it('builds live preview drafts only from style and attribute operations', () => {
    const op = operationWithValue({ kind: 'set-text', value: 'Old' }, 'New');
    expect(op).toEqual({ kind: 'set-text', value: 'New' });
    expect(
      previewDraftFor([
        op,
        { kind: 'set-style', property: 'color', value: '#ff0000' },
        { kind: 'set-attribute', name: 'placeholder', value: 'Search…' },
      ]),
    ).toEqual({
      styles: { color: '#ff0000' },
      attributes: { placeholder: 'Search…' },
    });
  });

  it('parses and formats lengths and 1-to-4-side CSS boxes', () => {
    expect(parseLength(' 16.25rem ')).toEqual({ amount: 16.25, unit: 'rem' });
    expect(parseLength('12')).toEqual({ amount: 12, unit: '' });
    expect(parseLength('auto')).toBeNull();
    expect(formatLength({ amount: 12.3456, unit: 'px' })).toBe('12.35px');
    expect(parseBox('8px 16px')).toEqual([
      { amount: 8, unit: 'px' },
      { amount: 16, unit: 'px' },
    ]);
    expect(parseBox('4px 8px 12px 16px')).toHaveLength(4);
    expect(parseBox('4px auto')).toBeNull();
    expect(parseBox('1px 2px 3px 4px 5px')).toBeNull();
  });
});
