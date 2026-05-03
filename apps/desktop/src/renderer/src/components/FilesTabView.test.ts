import { describe, expect, it } from 'vitest';
import { openFileTab } from '../store/slices/tabs';
import {
  chooseWorkspacePreviewSourceMode,
  defaultWorkspacePreviewPath,
  isRenderableDesignFileKind,
  resolveReferencedWorkspacePreviewPath,
  workspaceBaseHrefForFile,
  workspacePreviewDependencyKey,
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

  it('builds a workspace protocol base href for workspace-relative asset resolution', () => {
    expect(
      workspaceBaseHrefForFile({
        designId: 'design-123',
        workspacePath: '/Users/alice/My Workspace',
        filePath: 'nested/My File.html',
      }),
    ).toBe('workspace://design-123/nested/');
    expect(
      workspaceBaseHrefForFile({
        designId: 'design-123',
        workspacePath: '/Users/alice/My Workspace',
        filePath: 'index.html',
      }),
    ).toBe('workspace://design-123/');
    expect(
      workspaceBaseHrefForFile({
        designId: null,
        workspacePath: '/Users/alice/My Workspace',
        filePath: 'index.html',
      }),
    ).toBeUndefined();
  });

  it('encodes workspace base href path segments without flattening folders', () => {
    expect(
      workspaceBaseHrefForFile({
        designId: 'design-123',
        workspacePath: '/Users/alice/My Workspace',
        filePath: 'Aide Sketch/Dashboard V1 Hi-Fi.html',
      }),
    ).toBe('workspace://design-123/Aide%20Sketch/');
  });

  it('opens file tabs for JSX paths without rewriting them to index.html', () => {
    const result = openFileTab([{ kind: 'files' }], 'src/App.jsx');
    expect(result.tabs).toEqual([{ kind: 'files' }, { kind: 'file', path: 'src/App.jsx' }]);
    expect(result.index).toBe(1);
  });

  it('chooses renderable entry files before non-renderable assets by default', () => {
    expect(
      defaultWorkspacePreviewPath([
        { path: '.DS_Store', kind: 'asset', updatedAt: '2026-04-26T00:00:00Z', size: 1 },
        { path: 'index.jsx', kind: 'jsx', updatedAt: '2026-04-26T00:00:00Z', size: 100 },
      ]),
    ).toBe('index.jsx');
    expect(
      defaultWorkspacePreviewPath([
        { path: 'assets/logo.png', kind: 'asset', updatedAt: '2026-04-26T00:00:00Z', size: 1 },
        { path: 'App.tsx', kind: 'tsx', updatedAt: '2026-04-26T00:00:00Z', size: 100 },
      ]),
    ).toBe('App.tsx');
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

  it('does not resolve artifact source comments from non-HTML files', () => {
    expect(
      resolveReferencedWorkspacePreviewPath(
        'const marker = "<!-- artifact source lives in other.jsx -->";',
        'App.jsx',
      ),
    ).toBeNull();
  });

  it('tracks both the selected placeholder and resolved source file revisions', () => {
    const files = [
      { path: 'index.html', kind: 'html' as const, updatedAt: '2026-04-26T00:00:00Z', size: 100 },
      { path: 'index.jsx', kind: 'jsx' as const, updatedAt: '2026-04-26T00:00:01Z', size: 200 },
    ];

    expect(workspacePreviewDependencyKey(files, 'index.html', 'index.jsx')).toBe(
      'index.html:2026-04-26T00:00:00Z:100|index.jsx:2026-04-26T00:00:01Z:200',
    );
    expect(workspacePreviewDependencyKey(files, 'index.html', 'index.html')).toBe(
      'index.html:2026-04-26T00:00:00Z:100',
    );
  });
});
