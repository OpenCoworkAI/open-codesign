import { describe, expect, it } from 'vitest';
import {
  SourceEditApplyRequestV1,
  SourceEditApplyResultV1,
  SourceEditInspectRequestV1,
  SourceEditInspectResultV1,
  SourceEditOperation,
  SourceEditTarget,
  sourceEditFieldKey,
} from './source-edits';

const hash = 'a'.repeat(64);
const target = {
  id: '30:50',
  tagName: 'header',
  start: 30,
  end: 50,
  insertionOffset: 37,
  scope: 'source-definition',
  editableFields: [{ kind: 'set-text', value: 'Hello' }],
  unsupported: [],
};
const request = {
  schemaVersion: 1,
  designId: 'design',
  path: 'App.jsx',
  expectedSourceHash: hash,
  previewRevision: 'preview-1',
  targetId: target.id,
  operation: { kind: 'set-text', value: 'New' },
  scope: 'source-definition',
};

describe('source edit wire contracts', () => {
  it('requires the actual file content when inspecting', () => {
    expect(
      SourceEditInspectRequestV1.parse({
        schemaVersion: 1,
        designId: 'design',
        path: 'App.jsx',
        expectedContent: '',
      }).expectedContent,
    ).toBe('');
    expect(
      SourceEditInspectRequestV1.safeParse({
        schemaVersion: 1,
        designId: 'design',
        path: 'App.jsx',
      }).success,
    ).toBe(false);
  });
  it('carries source and preview revisions separately', () => {
    expect(SourceEditApplyRequestV1.parse(request).previewRevision).toBe('preview-1');
    expect(SourceEditApplyRequestV1.safeParse({ ...request, previewRevision: '' }).success).toBe(
      false,
    );
    expect(
      SourceEditApplyRequestV1.safeParse({ ...request, expectedSourceHash: 'stale' }).success,
    ).toBe(false);
  });
  it('describes current editable literals and unsupported reasons', () => {
    expect(SourceEditTarget.parse(target).editableFields).toEqual([
      { kind: 'set-text', value: 'Hello' },
    ]);
    expect(
      SourceEditInspectResultV1.parse({
        schemaVersion: 1,
        status: 'ready',
        path: 'App.jsx',
        sourceHash: hash,
        targets: [target],
      }).status,
    ).toBe('ready');
  });
  it('carries ordered field layout while rejecting executable or oversized descriptors', () => {
    const textLayout = [
      { kind: 'text', textId: '38:43', value: 'Cart (' },
      { kind: 'dynamic' },
      { kind: 'element', targetId: '44:49' },
    ];
    expect(SourceEditTarget.parse({ ...target, textLayout }).textLayout).toEqual(textLayout);
    for (const invalid of [
      [{ kind: 'text', value: 'x', start: 0, end: 100 }],
      [{ kind: 'dynamic', expression: 'run()' }],
      [{ kind: 'element', targetId: '../file.jsx' }],
      [{ kind: 'text', value: 'x'.repeat(100_001) }],
      Array.from({ length: 10_001 }, () => ({ kind: 'dynamic' })),
    ])
      expect(SourceEditTarget.safeParse({ ...target, textLayout: invalid }).success).toBe(false);
    expect(SourceEditApplyRequestV1.safeParse({ ...request, textLayout }).success).toBe(false);
  });
  it('uses field identities independent from current displayed values', () => {
    expect(sourceEditFieldKey({ kind: 'set-text', value: 'Hello' })).toBe('text:only');
    expect(sourceEditFieldKey({ kind: 'set-text', textId: '38:43', value: 'Changed' })).toBe(
      'text:38:43',
    );
    expect(sourceEditFieldKey({ kind: 'set-attribute', name: 'title', value: 'Tip' })).toBe(
      'attribute:title',
    );
    expect(sourceEditFieldKey({ kind: 'set-style', property: 'gap', value: '12' })).toBe(
      'style:gap',
    );
  });
  it('adds bounded text segment identities without accepting caller write ranges', () => {
    const operation = { kind: 'set-text', value: 'New', textId: '38:43' };
    expect(SourceEditOperation.parse(operation)).toEqual(operation);
    for (const textId of ['../App.jsx', 'run()', '-1:2', '38:43:44', '']) {
      expect(SourceEditOperation.safeParse({ ...operation, textId }).success).toBe(false);
    }
    expect(SourceEditOperation.safeParse({ ...operation, start: 0, end: 999 }).success).toBe(false);
    expect(
      SourceEditTarget.parse({
        ...target,
        directText: 'Hello',
        textSources: [
          {
            textId: '38:43',
            start: 0,
            end: 7,
            origin: 'const title → string literal',
          },
        ],
      }).textSources?.[0]?.start,
    ).toBe(0);
  });
  it.each([
    'onClick',
    'style',
    'src',
    'href',
    'data-codesign-source-id',
  ])('rejects forbidden attribute %s', (name) => {
    expect(SourceEditOperation.safeParse({ kind: 'set-attribute', name, value: 'x' }).success).toBe(
      false,
    );
  });
  it.each([
    'background',
    'backgroundImage',
    'position',
    '--custom',
  ])('rejects forbidden style %s', (property) => {
    expect(SourceEditOperation.safeParse({ kind: 'set-style', property, value: 'x' }).success).toBe(
      false,
    );
  });
  it('rejects extra executable fields, non-source scope and obsolete versions', () => {
    expect(
      SourceEditOperation.safeParse({ kind: 'set-text', value: 'x', expression: 'run()' }).success,
    ).toBe(false);
    expect(
      SourceEditApplyRequestV1.safeParse({ ...request, scope: 'selected-instance' }).success,
    ).toBe(false);
    expect(SourceEditApplyRequestV1.safeParse({ ...request, schemaVersion: 2 }).success).toBe(
      false,
    );
    expect(SourceEditApplyRequestV1.safeParse({ ...request, start: 10 }).success).toBe(false);
  });
  it('accepts main ACK metadata without requiring it from the pure engine', () => {
    const result = {
      schemaVersion: 1,
      status: 'applied',
      path: 'App.jsx',
      content: 'new',
      sourceHash: hash,
      patch: { start: 0, end: 3, expectedText: 'old', replacement: 'new' },
      scope: 'source-definition',
    };
    expect(SourceEditApplyResultV1.safeParse(result).success).toBe(true);
    const ack = {
      ...result,
      previewRevision: 'preview-1',
      warnings: ['Saved; refresh notification failed.'],
    };
    expect(SourceEditApplyResultV1.parse(ack)).toEqual(ack);
    expect(SourceEditApplyResultV1.safeParse({ ...ack, previewRevision: '' }).success).toBe(false);
    expect(SourceEditApplyResultV1.safeParse({ ...ack, warnings: [1] }).success).toBe(false);
  });
  it('discriminates applied patches and failures', () => {
    const rejected = {
      schemaVersion: 1,
      status: 'rejected',
      reason: 'stale-source',
      message: 'Reload source.',
    };
    expect(SourceEditApplyResultV1.parse(rejected)).toEqual(rejected);
    expect(SourceEditInspectResultV1.parse(rejected)).toEqual(rejected);
    expect(
      SourceEditApplyResultV1.parse({
        schemaVersion: 1,
        status: 'applied',
        path: 'App.jsx',
        content: 'new',
        sourceHash: hash,
        patch: { start: 0, end: 3, expectedText: 'old', replacement: 'new' },
        scope: 'source-definition',
      }).status,
    ).toBe('applied');
  });
});
