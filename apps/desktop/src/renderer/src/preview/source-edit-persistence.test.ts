import type { SourceEditInspectResultV1 } from '@open-codesign/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  inspectWorkspaceSourceEdit,
  persistWorkspaceSourceEdit,
  persistWorkspaceSourceEditBatch,
  redoWorkspaceSourceEdit,
  undoWorkspaceSourceEdit,
} from './source-edit-persistence';

const inspectRequest = {
  schemaVersion: 1 as const,
  designId: 'a',
  path: 'App.jsx',
  expectedContent: '<p>Old</p>',
};
const applyRequest = {
  schemaVersion: 1 as const,
  designId: 'a',
  path: 'App.jsx',
  expectedSourceHash: 'a'.repeat(64),
  previewRevision: 'revision',
  targetId: '1:20',
  scope: 'source-definition' as const,
  operation: { kind: 'set-text' as const, value: 'New' },
};
describe('source edit IPC persistence boundary', () => {
  it('rejects an inspection for another path', async () => {
    await expect(
      inspectWorkspaceSourceEdit(
        inspectRequest,
        vi.fn(
          async (): Promise<SourceEditInspectResultV1> => ({
            schemaVersion: 1,
            status: 'ready',
            path: 'Other.jsx',
            sourceHash: 'a'.repeat(64),
            targets: [],
          }),
        ),
      ),
    ).rejects.toThrow('different source path');
  });
  it('preserves main rejection reasons without a write fallback', async () => {
    const result = {
      schemaVersion: 1 as const,
      status: 'rejected' as const,
      reason: 'dynamic-source',
      message: 'Cannot edit dynamic expression',
    };
    expect(
      await persistWorkspaceSourceEdit(
        applyRequest,
        vi.fn(async () => result),
      ),
    ).toEqual(result);
  });
  it.each([
    undefined,
    'stale',
  ])('rejects missing or mismatched preview echo %s', async (previewRevision) => {
    const apply = vi.fn(async () => ({
      schemaVersion: 1 as const,
      status: 'applied' as const,
      path: 'App.jsx',
      content: '<p>New</p>',
      sourceHash: 'b'.repeat(64),
      scope: 'source-definition' as const,
      patch: { start: 3, end: 6, expectedText: 'Old', replacement: 'New' },
      ...(previewRevision ? { previewRevision } : {}),
    }));
    await expect(persistWorkspaceSourceEdit(applyRequest, apply)).rejects.toThrow(
      'preview revision',
    );
  });
  it('fails closed on a malformed ACK', async () => {
    const apply = vi.fn(async () => ({ status: 'success' })) as unknown as Parameters<
      typeof persistWorkspaceSourceEdit
    >[1];
    await expect(persistWorkspaceSourceEdit(applyRequest, apply)).rejects.toThrow();
  });
  it('validates batch apply acknowledgements and preserves rejection results', async () => {
    const batchRequest = {
      schemaVersion: 1 as const,
      designId: 'a',
      path: 'App.jsx',
      expectedSourceHash: 'a'.repeat(64),
      previewRevision: 'revision',
      targetId: '1:20',
      scope: 'source-definition' as const,
      operations: [
        { kind: 'set-text' as const, value: 'New' },
        { kind: 'set-attribute' as const, name: 'title' as const, value: 'Tip' },
      ],
    };
    const applied = {
      schemaVersion: 1 as const,
      status: 'applied' as const,
      path: 'App.jsx',
      content: '<p title={"Tip"}>New</p>',
      sourceHash: 'b'.repeat(64),
      scope: 'source-definition' as const,
      previewRevision: 'revision',
      patch: { start: 0, end: 10, expectedText: 'Old', replacement: 'New' },
    };
    expect(
      await persistWorkspaceSourceEditBatch(
        batchRequest,
        vi.fn(async () => applied),
      ),
    ).toEqual(applied);
    const rejected = {
      schemaVersion: 1 as const,
      status: 'rejected' as const,
      reason: 'stale-source',
      message: 'Changed',
    };
    expect(
      await persistWorkspaceSourceEditBatch(
        batchRequest,
        vi.fn(async () => rejected),
      ),
    ).toEqual(rejected);
    await expect(
      persistWorkspaceSourceEditBatch(
        batchRequest,
        vi.fn(async () => ({ ...applied, path: 'Other.jsx' })),
      ),
    ).rejects.toThrow('different source path');
    await expect(
      persistWorkspaceSourceEditBatch(
        batchRequest,
        vi.fn(async () => ({ ...applied, previewRevision: 'old' })),
      ),
    ).rejects.toThrow('preview revision');
    await expect(
      persistWorkspaceSourceEditBatch(
        batchRequest,
        vi.fn(async () => ({ status: 'ok' })) as unknown as Parameters<
          typeof persistWorkspaceSourceEditBatch
        >[1],
      ),
    ).rejects.toThrow();
  });
  it('validates undo and redo requests and acknowledgements fail-closed', async () => {
    const historyRequest = {
      schemaVersion: 1 as const,
      designId: 'a',
      path: 'App.jsx',
      expectedSourceHash: 'a'.repeat(64),
      previewRevision: 'revision',
    };
    const applied = {
      schemaVersion: 1 as const,
      status: 'applied' as const,
      path: 'App.jsx',
      content: '<p>Undo</p>',
      sourceHash: 'c'.repeat(64),
      scope: 'source-definition' as const,
      previewRevision: 'revision',
      canUndo: false,
      canRedo: true,
      patch: { start: 0, end: 10, expectedText: 'New', replacement: 'Old' },
    };
    expect(
      await undoWorkspaceSourceEdit(
        historyRequest,
        vi.fn(async () => applied),
      ),
    ).toEqual(applied);
    expect(
      await redoWorkspaceSourceEdit(
        historyRequest,
        vi.fn(async () => ({ ...applied, canUndo: true, canRedo: false })),
      ),
    ).toMatchObject({ status: 'applied', canUndo: true, canRedo: false });
    const rejected = {
      schemaVersion: 1 as const,
      status: 'rejected' as const,
      reason: 'stale-source',
      message: 'Changed',
    };
    expect(
      await undoWorkspaceSourceEdit(
        historyRequest,
        vi.fn(async () => rejected),
      ),
    ).toEqual(rejected);
    await expect(
      redoWorkspaceSourceEdit(
        historyRequest,
        vi.fn(async () => ({ ...applied, path: 'Other.jsx' })),
      ),
    ).rejects.toThrow('different source path');
    await expect(
      undoWorkspaceSourceEdit(
        historyRequest,
        vi.fn(async () => ({ ...applied, previewRevision: 'stale' })),
      ),
    ).rejects.toThrow('preview revision');
    await expect(
      redoWorkspaceSourceEdit(
        historyRequest,
        vi.fn(async () => ({ status: 'bad' })) as unknown as Parameters<
          typeof redoWorkspaceSourceEdit
        >[1],
      ),
    ).rejects.toThrow();
  });
});
