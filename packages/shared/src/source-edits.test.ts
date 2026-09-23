import { describe, expect, it } from 'vitest';
import {
  SourceEditApplyRequestV1,
  SourceEditApplyResultV1,
  SourceEditInspectRequestV1,
  SourceEditInspectResultV1,
  SourceEditOperation,
  SourceEditTarget,
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
