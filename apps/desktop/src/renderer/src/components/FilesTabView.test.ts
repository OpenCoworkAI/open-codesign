import { describe, expect, it } from 'vitest';
import { openFileTab } from '../store/slices/tabs';
import {
  chooseWorkspacePreviewSourceMode,
  defaultWorkspacePreviewPath,
  isMarkdownPreviewFile,
  isRenderableDesignFileKind,
  previewKindForFile,
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
    expect(isRenderableDesignFileKind('markdown')).toBe(false);
    expect(isRenderableDesignFileKind('text')).toBe(false);
    expect(isRenderableDesignFileKind('image')).toBe(false);
    expect(isRenderableDesignFileKind('video')).toBe(false);
    expect(isRenderableDesignFileKind('audio')).toBe(false);
    expect(isRenderableDesignFileKind('pdf')).toBe(false);
    expect(isRenderableDesignFileKind('design-system')).toBe(false);
    expect(isRenderableDesignFileKind('asset')).toBe(false);
  });

  it('chooses broad preview kinds for common files and defaults unknown assets to text', () => {
    expect(isMarkdownPreviewFile('README.md', 'markdown')).toBe(true);
    expect(isMarkdownPreviewFile('DESIGN.md', 'design-system')).toBe(true);
    expect(previewKindForFile('App.jsx', 'jsx')).toBe('runtime');
    expect(previewKindForFile('README.md', 'markdown')).toBe('markdown');
    expect(previewKindForFile('notes.txt', 'text')).toBe('text');
    expect(previewKindForFile('data.json', 'text')).toBe('text');
    expect(previewKindForFile('style.css', 'css')).toBe('text');
    expect(previewKindForFile('assets/logo.png', 'image')).toBe('image');
    expect(previewKindForFile('clip.mp4', 'video')).toBe('video');
    expect(previewKindForFile('voice.mp3', 'audio')).toBe('audio');
    expect(previewKindForFile('brief.pdf', 'pdf')).toBe('pdf');
    expect(previewKindForFile('Makefile', 'asset')).toBe('text');
    expect(previewKindForFile('archive.zip', 'asset')).toBe('unsupported');
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
        { path: 'index.html', kind: 'html', updatedAt: '2026-04-26T00:00:00Z', size: 100 },
        { path: 'App.jsx', kind: 'jsx', updatedAt: '2026-04-26T00:00:01Z', size: 100 },
      ]),
    ).toBe('App.jsx');
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

  it('prefers actual workspace reads over previewSource when the files API is available', () => {
    expect(
      chooseWorkspacePreviewSourceMode({
        path: 'index.html',
        hasReadApi: true,
        hasPreviewSource: true,
      }),
    ).toBe('read-workspace');
    expect(
      chooseWorkspacePreviewSourceMode({
        path: 'src/App.tsx',
        hasReadApi: true,
        hasPreviewSource: true,
      }),
    ).toBe('read-workspace');
  });

  it('uses previewSource for virtual App.jsx fallback entries even when files.read exists', () => {
    expect(
      chooseWorkspacePreviewSourceMode({
        path: 'App.jsx',
        hasReadApi: true,
        hasPreviewSource: true,
        preferPreviewSource: true,
      }),
    ).toBe('preview-source-fallback');
  });

  it('falls back to previewSource only for App.jsx previews without files.read', () => {
    expect(
      chooseWorkspacePreviewSourceMode({
        path: 'App.jsx',
        hasReadApi: false,
        hasPreviewSource: true,
      }),
    ).toBe('preview-source-fallback');
    expect(
      chooseWorkspacePreviewSourceMode({
        path: 'index.html',
        hasReadApi: false,
        hasPreviewSource: true,
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
