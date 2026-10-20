import type { SourceEditInspectResultV1 } from '@open-codesign/shared';
import { describe, expect, it, vi } from 'vitest';
import { inspectWorkspaceSourceEdit, persistWorkspaceSourceEdit } from './source-edit-persistence';

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
});
