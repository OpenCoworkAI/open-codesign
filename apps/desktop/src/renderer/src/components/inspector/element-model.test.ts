import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SourceEditElementSnapshot, SourceEditTarget } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import {
  buildElementInspectorSections,
  elementKind,
  formatLength,
  groupInspectorFields,
  inspectorFieldIssueStatus,
  inspectorFields,
  isInspectorFieldEditable,
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

const baseSnapshot: SourceEditElementSnapshot = {
  computedStyle: {
    color: 'rgb(17, 24, 39)',
    backgroundColor: 'rgb(255, 255, 255)',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '16px',
    fontWeight: '600',
    lineHeight: '24px',
    letterSpacing: '0px',
    textAlign: 'left',
    textTransform: 'none',
    padding: '8px 16px',
    margin: '0px',
    borderRadius: '8px',
    borderWidth: '1px',
    borderColor: 'rgb(229, 231, 235)',
    boxShadow: 'none',
    opacity: '1',
    display: 'block',
    width: '140px',
    height: '40px',
    maxWidth: 'none',
    minHeight: '0px',
    overflow: 'visible',
  },
  boxModel: {
    width: 140,
    height: 40,
    padding: { top: 8, right: 16, bottom: 8, left: 16 },
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    border: { top: 1, right: 1, bottom: 1, left: 1 },
  },
  instanceCount: 1,
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

  it('builds live preview drafts for styles, removedStyles, attributes, texts, className, and visibility', () => {
    const textOp = operationWithValue({ kind: 'set-text', value: 'Old' }, 'New');
    const namedTextOp = operationWithValue({ kind: 'set-text', textId: '1:5', value: 'A' }, 'B');
    expect(textOp).toEqual({ kind: 'set-text', value: 'New' });
    expect(
      previewDraftFor([
        textOp,
        namedTextOp,
        { kind: 'set-style', property: 'color', value: '#ff0000' },
        { kind: 'remove-style', property: 'gap' },
        { kind: 'set-attribute', name: 'placeholder', value: 'Search…' },
        { kind: 'set-class-name', value: 'btn primary' },
        { kind: 'toggle-visibility', hidden: true },
      ]),
    ).toEqual({
      styles: { color: '#ff0000' },
      removedStyles: ['gap'],
      attributes: { placeholder: 'Search…' },
      texts: { only: 'New', '1:5': 'B' },
      className: 'btn primary',
      hidden: true,
    });
  });

  it('parses and formats lengths and 1-to-4-side CSS boxes', () => {
    expect(parseLength(' 16.25rem ')).toEqual({ amount: 16.25, unit: 'rem' });
    expect(parseLength('12')).toEqual({ amount: 12, unit: '' });
    expect(parseLength('-4px')).toEqual({ amount: -4, unit: 'px' });
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

  it('builds 5 unified design groups seeded from authored, token, and computed values', () => {
    const richTarget: SourceEditTarget = {
      id: '10:80',
      tagName: 'button',
      start: 10,
      end: 80,
      insertionOffset: 18,
      scope: 'source-definition',
      editableFields: [
        { kind: 'set-text', value: 'Submit' },
        { kind: 'set-style', property: 'backgroundColor', value: '#294c60' },
      ],
      styleBindings: [
        {
          property: 'color',
          expression: 't.ink',
          tokenName: 'ink',
          editable: false,
        },
        {
          property: 'borderRadius',
          expression: 'var(--ocd-tweak-radius)',
          tokenName: 'radius',
          editable: true,
        },
      ],
      capabilities: {
        canUpsertStyle: true,
        canUpsertAttribute: true,
        canEditClassName: true,
        canReorderUp: false,
        canReorderDown: true,
        canDuplicate: true,
        canDelete: true,
        sharedDefinition: false,
        styleMode: 'tailwind',
      },
      className: 'px-4 py-2',
      unsupported: [],
    };

    const sections = buildElementInspectorSections(richTarget, baseSnapshot);
    expect(sections.map((section) => section.group)).toEqual([
      'content',
      'appearance',
      'typography',
      'spacing',
      'layout',
      'classes',
    ]);

    const byKey = new Map(sections.flatMap((s) => s.fields).map((f) => [f.key, f]));
    expect(byKey.get('style:backgroundColor')).toMatchObject({
      initialValue: '#294c60',
      provenance: 'authored',
      authored: true,
    });
    const colorField = byKey.get('style:color');
    const fontSizeField = byKey.get('style:fontSize');
    if (!colorField || !fontSizeField) throw new Error('Missing expected style fields');
    expect(colorField).toMatchObject({
      initialValue: 'rgb(17, 24, 39)',
      provenance: 'locked',
      bindingLabel: 'ink',
      authored: false,
    });
    expect(isInspectorFieldEditable(richTarget, colorField, undefined)).toBe(false);
    expect(byKey.get('style:borderRadius')).toMatchObject({
      initialValue: '8px',
      provenance: 'token',
      bindingLabel: 'radius',
    });
    expect(fontSizeField).toMatchObject({
      initialValue: '16px',
      provenance: 'computed',
      authored: false,
    });
    expect(isInspectorFieldEditable(richTarget, fontSizeField, undefined)).toBe(true);
    expect(byKey.get('style:margin')).toMatchObject({
      initialValue: '0px',
      allowNegative: true,
    });
    expect(byKey.get('className')).toMatchObject({
      initialValue: 'px-4 py-2',
      provenance: 'authored',
    });
    // Block display omits flex/grid gap unless display changes to flex/grid
    expect(byKey.has('style:gap')).toBe(false);

    const flexSections = buildElementInspectorSections(richTarget, baseSnapshot, undefined, {
      'style:display': 'flex',
    });
    const flexKeys = new Set(flexSections.flatMap((s) => s.fields).map((f) => f.key));
    expect(flexKeys.has('style:flexDirection')).toBe(true);
    expect(flexKeys.has('style:justifyContent')).toBe(true);
    expect(flexKeys.has('style:alignItems')).toBe(true);
    expect(flexKeys.has('style:gap')).toBe(true);
  });

  it('exposes media fields for img, href for a, placeholder for input, and map item fields', () => {
    const imgTarget: SourceEditTarget = {
      ...baseTarget,
      tagName: 'img',
      capabilities: {
        canUpsertStyle: true,
        canUpsertAttribute: true,
        canEditClassName: false,
        canReorderUp: false,
        canReorderDown: false,
        canDuplicate: false,
        canDelete: false,
        sharedDefinition: false,
        styleMode: 'inline',
      },
    };
    const imgSnapshot: SourceEditElementSnapshot = {
      ...baseSnapshot,
      computedStyle: { ...baseSnapshot.computedStyle, objectFit: 'cover' },
      elementMeta: { src: 'https://example.com/hero.png' },
    };
    const imgSections = buildElementInspectorSections(imgTarget, imgSnapshot);
    expect(imgSections.some((s) => s.group === 'media')).toBe(true);
    expect(imgSections.some((s) => s.group === 'typography')).toBe(false);
    const imgKeys = new Set(imgSections.flatMap((s) => s.fields).map((f) => f.key));
    expect(imgKeys.has('attribute:src')).toBe(true);
    expect(imgKeys.has('attribute:alt')).toBe(true);
    expect(imgKeys.has('style:objectFit')).toBe(true);

    const cardTarget: SourceEditTarget = {
      ...baseTarget,
      tagName: 'a',
      mapSource: {
        arrayName: 'cards',
        itemCount: 2,
        fields: [{ key: 'title', property: 'Card title', values: ['First', 'Second'] }],
      },
      capabilities: {
        canUpsertStyle: true,
        canUpsertAttribute: true,
        canEditClassName: false,
        canReorderUp: true,
        canReorderDown: true,
        canDuplicate: true,
        canDelete: true,
        sharedDefinition: true,
        styleMode: 'inline',
      },
    };
    const cardSections = buildElementInspectorSections(cardTarget, {
      ...baseSnapshot,
      itemIndex: 1,
      elementMeta: { href: '/second' },
    });
    const cardByKey = new Map(cardSections.flatMap((s) => s.fields).map((f) => [f.key, f]));
    const mapField = cardByKey.get('map-text:1:title');
    expect(mapField).toMatchObject({
      initialValue: 'Second',
      customLabel: 'Card title',
    });
    if (!mapField) throw new Error('Missing expected map-text:1:title field');
    expect(isInspectorFieldEditable(cardTarget, mapField, [])).toBe(true);
    expect(inspectorFieldIssueStatus(cardTarget, mapField, [])).toBeNull();
    expect(
      isInspectorFieldEditable(cardTarget, mapField, [
        { key: 'map-text:1:title', status: 'changed' },
      ]),
    ).toBe(false);
    expect(
      inspectorFieldIssueStatus(cardTarget, mapField, [
        { key: 'map-text:1:title', status: 'changed' },
      ]),
    ).toBe('changed');
    expect(cardByKey.get('attribute:href')?.initialValue).toBe('/second');
  });

  it('exposes zero fields for SVG/non-upsertable targets with empty editableFields', () => {
    const svgTarget: SourceEditTarget = {
      ...baseTarget,
      tagName: 'svg',
      editableFields: [],
      capabilities: {
        canUpsertStyle: false,
        canUpsertAttribute: false,
        canEditClassName: false,
        canReorderUp: false,
        canReorderDown: false,
        canDuplicate: false,
        canDelete: false,
        sharedDefinition: false,
        styleMode: 'inline',
      },
    };
    expect(buildElementInspectorSections(svgTarget, baseSnapshot)).toEqual([]);
    expect(buildElementInspectorSections(null, baseSnapshot)).toEqual([]);
  });

  it('maintains 100% key parity under inspector.* across all 4 locales', () => {
    const localesDir = resolve(process.cwd(), '../../packages/i18n/src/locales');
    const flatten = (obj: Record<string, unknown>, prefix = ''): string[] =>
      Object.entries(obj).flatMap(([key, val]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        return val && typeof val === 'object' && !Array.isArray(val)
          ? flatten(val as Record<string, unknown>, path)
          : [path];
      });
    const enJson = JSON.parse(readFileSync(resolve(localesDir, 'en.json'), 'utf8')) as {
      inspector: Record<string, unknown>;
    };
    const enKeys = flatten(enJson.inspector).sort();
    for (const locale of ['zh-CN', 'es', 'pt-BR']) {
      const json = JSON.parse(readFileSync(resolve(localesDir, `${locale}.json`), 'utf8')) as {
        inspector: Record<string, unknown>;
      };
      expect(flatten(json.inspector).sort(), `inspector key parity for ${locale}`).toEqual(enKeys);
    }
  });
});
