import { describe, expect, it, vi } from 'vitest';
import {
  hasWorkspaceSourceReference,
  readWorkspacePreviewSource,
  resolveReferencedWorkspacePreviewPath,
  resolveWorkspacePreviewSource,
  type WorkspacePreviewRead,
} from './workspace-source';

describe('workspace preview source resolution', () => {
  it('resolves HTML source references to sibling JSX files', () => {
    expect(
      resolveReferencedWorkspacePreviewPath(
        '<!doctype html><body><!-- artifact source lives in index.jsx --></body>',
        'index.html',
      ),
    ).toBe('index.jsx');
    expect(
      resolveReferencedWorkspacePreviewPath(
        '<!-- artifact source lives in App.tsx -->',
        'screens/index.html',
      ),
    ).toBe('screens/App.tsx');
  });

  it('ignores source-reference-looking strings outside HTML preview files', () => {
    expect(
      resolveReferencedWorkspacePreviewPath(
        'const marker = "<!-- artifact source lives in other.jsx -->";',
        'App.jsx',
      ),
    ).toBeNull();
  });

  it('does not resolve source-reference-looking strings from JSX saved as index.html', () => {
    expect(
      resolveReferencedWorkspacePreviewPath(
        'const marker = "<!-- artifact source lives in other.jsx -->";\nfunction App(){ return <main>{marker}</main>; }\nReactDOM.createRoot(document.getElementById("root")).render(<App/>);',
        'index.html',
      ),
    ).toBeNull();
  });

  it('reads the referenced source so hub cards, snapshots, and file tabs share one chain', async () => {
    const read = vi.fn<WorkspacePreviewRead>(async (_designId, path) => ({
      path,
      content:
        path === 'index.html'
          ? '<!doctype html><body><!-- artifact source lives in index.jsx --></body>'
          : 'function App(){ return <main id="real-source">Hi</main>; }',
    }));

    await expect(
      readWorkspacePreviewSource({ designId: 'd1', path: 'index.html', read }),
    ).resolves.toEqual({
      path: 'index.jsx',
      content: 'function App(){ return <main id="real-source">Hi</main>; }',
    });
    expect(read).toHaveBeenCalledWith('d1', 'index.html');
    expect(read).toHaveBeenCalledWith('d1', 'index.jsx');
  });

  it('falls back to the original source when no read API is available', async () => {
    await expect(
      resolveWorkspacePreviewSource({
        designId: 'd1',
        source: '<!doctype html><body><!-- artifact source lives in index.jsx --></body>',
      }),
    ).resolves.toEqual({
      path: 'index.html',
      content: '<!doctype html><body><!-- artifact source lives in index.jsx --></body>',
    });
  });

  it('can require referenced source resolution for persistence/export paths', async () => {
    const source = '<!doctype html><body><!-- artifact source lives in index.jsx --></body>';

    expect(hasWorkspaceSourceReference(source)).toBe(true);
    await expect(
      resolveWorkspacePreviewSource({
        designId: 'd1',
        source,
        requireReferencedSource: true,
      }),
    ).rejects.toThrow(/Cannot resolve referenced preview source/);
  });

  it('falls back to original source when referenced workspace read returns empty content', async () => {
    const source = '<!doctype html><body><!-- artifact source lives in index.jsx --></body>';
    const read = vi.fn<WorkspacePreviewRead>(async (_designId, path) => ({
      path,
      content: '',
    }));

    await expect(
      resolveWorkspacePreviewSource({
        designId: 'd1',
        source,
        read,
        requireReferencedSource: true,
      }),
    ).resolves.toEqual({ path: 'index.html', content: source });
  });

  it('falls back to original source when referenced workspace read throws', async () => {
    const source = '<!doctype html><body><!-- artifact source lives in index.jsx --></body>';
    const read = vi.fn<WorkspacePreviewRead>(async () => {
      throw new Error('files API unavailable');
    });

    await expect(
      resolveWorkspacePreviewSource({
        designId: 'd1',
        source,
        read,
        requireReferencedSource: false,
      }),
    ).resolves.toEqual({ path: 'index.html', content: source });
  });
});
