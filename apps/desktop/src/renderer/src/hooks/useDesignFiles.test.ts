import { describe, expect, it } from 'vitest';
import type { DesignFileEntry } from './useDesignFiles';
import {
  handleWorkspaceListErrorToast,
  handleWorkspaceListSuccessToast,
  isWorkspaceListFailureToast,
  previewSourceFallbackFile,
  type WorkspaceListErrorToastState,
  withPreviewSourceFallback,
} from './useDesignFiles';

describe('useDesignFiles helpers', () => {
  it('creates a virtual App.jsx entry from previewSource', () => {
    expect(previewSourceFallbackFile('<html>ok</html>', '2026-05-03T00:00:00.000Z')).toEqual({
      path: 'App.jsx',
      kind: 'jsx',
      size: 15,
      updatedAt: '2026-05-03T00:00:00.000Z',
      source: 'preview-html',
    });
  });

  it('keeps real workspace files ahead of previewSource fallback', () => {
    const rows: DesignFileEntry[] = [
      {
        path: 'src/App.tsx',
        kind: 'tsx',
        size: 123,
        updatedAt: '2026-05-03T00:00:00.000Z',
        source: 'workspace',
      },
    ];

    expect(withPreviewSourceFallback(rows, '<html>fallback</html>')).toBe(rows);
  });

  it('uses previewSource when the workspace list is empty', () => {
    expect(
      withPreviewSourceFallback([], '<html>fallback</html>', '2026-05-03T00:00:00.000Z'),
    ).toEqual([
      {
        path: 'App.jsx',
        kind: 'jsx',
        size: 21,
        updatedAt: '2026-05-03T00:00:00.000Z',
        source: 'preview-html',
      },
    ]);
  });

  it('returns no files when neither workspace rows nor previewSource exist', () => {
    expect(withPreviewSourceFallback([], null)).toEqual([]);
    expect(withPreviewSourceFallback([], '')).toEqual([]);
  });
});

describe('workspace list error toast lifecycle', () => {
  it('replaces the previous workspace-list error toast instead of stacking duplicates', () => {
    const state: WorkspaceListErrorToastState = { key: null, toastId: null };
    const pushed: Array<{ title: string; description: string }> = [];
    const dismissed: string[] = [];

    handleWorkspaceListErrorToast({
      state,
      key: 'design:/missing-a:Failed to list workspace files',
      message: 'Failed to list workspace files',
      pushToast: (toast) => {
        pushed.push({ title: toast.title, description: toast.description ?? '' });
        return 'toast-a';
      },
      dismissToast: (id) => dismissed.push(id),
    });
    handleWorkspaceListErrorToast({
      state,
      key: 'design:/missing-a:Failed to list workspace files',
      message: 'Failed to list workspace files',
      pushToast: () => {
        throw new Error('duplicate toast should not be pushed');
      },
      dismissToast: (id) => dismissed.push(id),
    });
    handleWorkspaceListErrorToast({
      state,
      key: 'design:/missing-b:Failed to list workspace files',
      message: 'Failed to list workspace files',
      pushToast: (toast) => {
        pushed.push({ title: toast.title, description: toast.description ?? '' });
        return 'toast-b';
      },
      dismissToast: (id) => dismissed.push(id),
    });

    expect(pushed).toHaveLength(2);
    expect(dismissed).toEqual(['toast-a']);
    expect(state).toEqual({
      key: 'design:/missing-b:Failed to list workspace files',
      toastId: 'toast-b',
    });
  });

  it('dismisses the last workspace-list error toast after a successful list', () => {
    const state: WorkspaceListErrorToastState = {
      key: 'design:/missing:Failed to list workspace files',
      toastId: 'toast-a',
    };
    const dismissed: string[] = [];

    handleWorkspaceListSuccessToast(state, (id) => dismissed.push(id));
    handleWorkspaceListSuccessToast(state, (id) => dismissed.push(id));

    expect(dismissed).toEqual(['toast-a']);
    expect(state).toEqual({ key: null, toastId: null });
  });

  it('dismisses stale list-failure toasts that were created before this hook tracked them', () => {
    const state: WorkspaceListErrorToastState = {
      key: 'design:/missing:Failed to list workspace files',
      toastId: 'toast-a',
    };
    const dismissed: string[] = [];

    handleWorkspaceListSuccessToast(state, (id) => dismissed.push(id), [
      'old-list-toast',
      'toast-a',
    ]);

    expect(dismissed).toEqual(['toast-a', 'old-list-toast']);
    expect(state).toEqual({ key: null, toastId: null });
  });

  it('recognizes IPC list-failure toasts but not unrelated workspace errors', () => {
    expect(
      isWorkspaceListFailureToast({
        description:
          "Error invoking remote method 'codesign:files:v1:list': CodesignError: Failed to list workspace files",
      }),
    ).toBe(true);
    expect(
      isWorkspaceListFailureToast({ description: 'CodesignError: Failed to list workspace files' }),
    ).toBe(true);
    expect(isWorkspaceListFailureToast({ description: 'Workspace path does not exist' })).toBe(
      false,
    );
  });
});
