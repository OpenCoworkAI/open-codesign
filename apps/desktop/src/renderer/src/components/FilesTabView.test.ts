import { describe, expect, it } from 'vitest';
import { openFileTab } from '../store/slices/tabs';
import {
  chooseWorkspacePreviewSourceMode,
  isRenderableDesignFileKind,
  resolveReferencedWorkspacePreviewPath,
  workspaceBaseHrefFromPath,
} from './FilesTabView';

describe('FilesTabView preview helpers', () => {
  it('marks html/jsx/tsx files as renderable', () => {
    expect(isRenderableDesignFileKind('html')).toBe(true);
    expect(isRenderableDesignFileKind('jsx')).toBe(true);
    expect(isRenderableDesignFileKind('tsx')).toBe(true);
    expect(isRenderableDesignFileKind('css')).toBe(false);
    expect(isRenderableDesignFileKind('js')).toBe(false);
    expect(isRenderableDesignFileKind('asset')).toBe(false);
  });

  it('builds a file URL base href for workspace-relative asset resolution', () => {
    expect(workspaceBaseHrefFromPath('/Users/alice/My Workspace')).toBe(
      'file:///Users/alice/My%20Workspace/',
    );
  });

  it('opens file tabs for JSX paths without rewriting them to index.html', () => {
    const result = openFileTab([{ kind: 'files' }], 'src/App.jsx');
    expect(result.tabs).toEqual([{ kind: 'files' }, { kind: 'file', path: 'src/App.jsx' }]);
    expect(result.index).toBe(1);
  });

  it('prefers actual workspace reads over previewHtml when the files API is available', () => {
    expect(
      chooseWorkspacePreviewSourceMode({
        path: 'index.html',
        hasReadApi: true,
        hasPreviewHtml: true,
      }),
    ).toBe('read-workspace');
    expect(
      chooseWorkspacePreviewSourceMode({
        path: 'src/App.tsx',
        hasReadApi: true,
        hasPreviewHtml: true,
      }),
    ).toBe('read-workspace');
  });

  it('falls back to previewHtml only for legacy index.html previews without files.read', () => {
    expect(
      chooseWorkspacePreviewSourceMode({
        path: 'index.html',
        hasReadApi: false,
        hasPreviewHtml: true,
      }),
    ).toBe('preview-html-fallback');
    expect(
      chooseWorkspacePreviewSourceMode({
        path: 'src/App.jsx',
        hasReadApi: false,
        hasPreviewHtml: true,
      }),
    ).toBe('unavailable');
  });

  it('resolves placeholder HTML previews to their referenced JSX/TSX source path', () => {
    expect(
      resolveReferencedWorkspacePreviewPath(
        '<!doctype html><body><!-- artifact source lives in index.jsx --></body>',
        'index.html',
      ),
    ).toBe('index.jsx');
    expect(
      resolveReferencedWorkspacePreviewPath(
        '<!-- artifact source lives in App.tsx -->',
        'ui/demo.html',
      ),
    ).toBe('ui/App.tsx');
  });

  it('ignores unsafe placeholder source paths', () => {
    expect(
      resolveReferencedWorkspacePreviewPath(
        '<!-- artifact source lives in ../App.jsx -->',
        'index.html',
      ),
    ).toBeNull();
  });
});
