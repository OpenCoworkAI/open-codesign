import { describe, expect, it, vi } from 'vitest';
import {
  hasWorkspaceSourceReference,
  inferPreviewSourcePath,
  readWorkspacePreviewSource,
  resolveDesignPreviewSource,
  resolveReferencedWorkspacePreviewPath,
  resolveWorkspacePreviewSource,
  type WorkspacePreviewRead,
} from './workspace-source';

describe('workspace preview source resolution', () => {
  it('infers App.jsx for JSX modules and index.html for legacy HTML fragments', () => {
    expect(
      inferPreviewSourcePath(
        'function App() { return <main />; }\nReactDOM.createRoot(document.getElementById("root")).render(<App/>);',
      ),
    ).toBe('App.jsx');
    expect(inferPreviewSourcePath('<main id="legacy">Legacy</main>')).toBe('index.html');
    expect(inferPreviewSourcePath('<!doctype html><html><body>Legacy</body></html>')).toBe(
      'index.html',
    );
  });

  it('resolves HTML source references to sibling JSX files', () => {
    expect(
      hasWorkspaceSourceReference(
        '<!doctype html><body><!-- artifact source lives in index.jsx --></body>',
      ),
    ).toBe(true);
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

  it('resolves legacy HTML reference content even when a stale caller passes App.jsx', () => {
    expect(
      resolveReferencedWorkspacePreviewPath(
        '<!doctype html><body><!-- artifact source lives in index.jsx --></body>',
        'App.jsx',
      ),
    ).toBe('index.jsx');
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

  it('resolves design previews from workspace App.jsx before consulting snapshots', async () => {
    const read = vi.fn<WorkspacePreviewRead>(async (_designId, path) => {
      if (path !== 'App.jsx') throw new Error(`unexpected path ${path}`);
      return {
        path,
        content:
          'function App(){ return <main id="workspace-source">Hi</main>; }\nReactDOM.createRoot(document.getElementById("root")).render(<App/>);',
      };
    });
    const listSnapshots = vi.fn(async () => {
      throw new Error('snapshots should not be needed');
    });

    await expect(
      resolveDesignPreviewSource({ designId: 'd1', read, listSnapshots }),
    ).resolves.toEqual({
      path: 'App.jsx',
      content:
        'function App(){ return <main id="workspace-source">Hi</main>; }\nReactDOM.createRoot(document.getElementById("root")).render(<App/>);',
    });
    expect(read).toHaveBeenCalledWith('d1', 'App.jsx');
    expect(listSnapshots).not.toHaveBeenCalled();
  });

  it('resolves design previews from legacy index.html when App.jsx is absent', async () => {
    const read = vi.fn<WorkspacePreviewRead>(async (_designId, path) => {
      if (path === 'App.jsx') throw new Error('missing App.jsx');
      return {
        path,
        content:
          path === 'index.html'
            ? '<!doctype html><body><!-- artifact source lives in index.jsx --></body>'
            : 'function App(){ return <main id="legacy-source">Hi</main>; }',
      };
    });

    await expect(resolveDesignPreviewSource({ designId: 'd1', read })).resolves.toEqual({
      path: 'index.jsx',
      content: 'function App(){ return <main id="legacy-source">Hi</main>; }',
    });
    expect(read).toHaveBeenCalledWith('d1', 'App.jsx');
    expect(read).toHaveBeenCalledWith('d1', 'index.html');
    expect(read).toHaveBeenCalledWith('d1', 'index.jsx');
  });

  it('falls back to the latest snapshot when no workspace source exists', async () => {
    const read = vi.fn<WorkspacePreviewRead>(async () => {
      throw new Error('missing workspace file');
    });
    const listSnapshots = vi.fn(async () => [
      { artifactSource: '<main id="snapshot-source">Snapshot</main>' },
    ]);

    await expect(
      resolveDesignPreviewSource({ designId: 'd1', read, listSnapshots }),
    ).resolves.toEqual({
      path: 'index.html',
      content: '<main id="snapshot-source">Snapshot</main>',
    });
    expect(listSnapshots).toHaveBeenCalledWith('d1');
  });

  it('falls back to the original source when no read API is available', async () => {
    await expect(
      resolveWorkspacePreviewSource({
        designId: 'd1',
        source: '<!doctype html><body><!-- artifact source lives in index.jsx --></body>',
        path: 'index.html',
      }),
    ).resolves.toEqual({
      path: 'index.html',
      content: '<!doctype html><body><!-- artifact source lives in index.jsx --></body>',
    });
  });

  it('can require referenced source resolution for persistence/export paths', async () => {
    const source = '<!doctype html><body><!-- artifact source lives in index.jsx --></body>';

    expect(hasWorkspaceSourceReference(source, 'index.html')).toBe(true);
    await expect(
      resolveWorkspacePreviewSource({
        designId: 'd1',
        source,
        path: 'index.html',
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
        path: 'index.html',
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
        path: 'index.html',
        read,
        requireReferencedSource: false,
      }),
    ).resolves.toEqual({ path: 'index.html', content: source });
  });
});
