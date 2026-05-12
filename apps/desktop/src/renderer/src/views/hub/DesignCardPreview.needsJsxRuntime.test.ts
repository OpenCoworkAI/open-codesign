import { describe, expect, it, vi } from 'vitest';
import {
  clearPreviewCardCachesForTest,
  hubScrollRootForCard,
  needsJsxRuntime,
  parseCachedPreview,
  readPreviewSourceForCard,
  workspaceBaseHrefForPreview,
} from './DesignCardPreview';

describe('needsJsxRuntime', () => {
  it('returns true for JSX that also contains <html> inside a return block', () => {
    // Regression for hub thumbnails rendering JSX source as plain text.
    // The `<html>` inside a `function App() { return <html>...</html> }` body
    // used to trigger the raw-HTML fast-path and bypass the babel runtime.
    const jsxWithHtmlTag = `const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{"a":1}/*EDITMODE-END*/;
function App() {
  return (
    <html>
      <body><h1>Hi</h1></body>
    </html>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);`;
    expect(needsJsxRuntime(jsxWithHtmlTag)).toBe(true);
  });

  it('returns true for EDITMODE-marked JSX without <html>', () => {
    expect(
      needsJsxRuntime(
        `const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{"accent":"#000"}/*EDITMODE-END*/;\nfunction App(){ return <div/>; }`,
      ),
    ).toBe(true);
  });

  it('returns false for a real HTML document', () => {
    expect(
      needsJsxRuntime('<!doctype html>\n<html><head><title>x</title></head><body>hi</body></html>'),
    ).toBe(false);
  });

  it('returns false for plain body-only HTML with no JSX markers', () => {
    expect(needsJsxRuntime('<div>hello</div>')).toBe(false);
  });

  it('returns true for ReactDOM.createRoot even without EDITMODE marker', () => {
    expect(
      needsJsxRuntime(
        `function App(){return <p/>;}\nReactDOM.createRoot(document.getElementById('root')).render(<App/>);`,
      ),
    ).toBe(true);
  });
});

describe('DesignCardPreview source helpers', () => {
  it('keeps the resolved source path when reading v3 cache entries', () => {
    expect(
      parseCachedPreview(
        JSON.stringify({
          schemaVersion: 1,
          path: 'screens/App.jsx',
          content: 'function App(){ return <main />; }',
        }),
      ),
    ).toEqual({
      path: 'screens/App.jsx',
      content: 'function App(){ return <main />; }',
    });
  });

  it('falls back for legacy raw cache entries', () => {
    expect(parseCachedPreview('<main>legacy</main>')).toEqual({
      path: 'index.html',
      content: '<main>legacy</main>',
    });
  });

  it('builds workspace base hrefs from resolved nested source paths', () => {
    expect(
      workspaceBaseHrefForPreview(
        { id: 'design-1', workspacePath: '/Users/alice/CoDesign/Nested' },
        'screens/App.jsx',
      ),
    ).toBe('workspace://design-1/screens/');
  });

  it('uses the hub scroll container as the thumbnail visibility root', () => {
    const root = { nodeType: 1 };
    const card = {
      closest: (selector: string) => (selector === '[data-codesign-hub-scroll-root]' ? root : null),
    } as unknown as HTMLElement;

    expect(hubScrollRootForCard(card)).toBe(root);
  });

  it('dedupes concurrent preview source reads for the same design version', async () => {
    clearPreviewCardCachesForTest();
    const globalWithWindow = globalThis as unknown as { window?: { codesign?: unknown } };
    const previousWindow = globalWithWindow.window;
    const list = vi.fn(
      async () =>
        new Promise<Array<{ artifactSource: string }>>((resolve) =>
          setTimeout(() => resolve([{ artifactSource: '<main>cached once</main>' }]), 0),
        ),
    );
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        codesign: {
          snapshots: { list },
        },
      },
    });

    try {
      const [first, second] = await Promise.all([
        readPreviewSourceForCard('design-1', '2026-05-05T00:00:00.000Z'),
        readPreviewSourceForCard('design-1', '2026-05-05T00:00:00.000Z'),
      ]);

      expect(list).toHaveBeenCalledTimes(1);
      expect(first).toEqual(second);
      expect(first?.content).toBe('<main>cached once</main>');
    } finally {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      });
      clearPreviewCardCachesForTest();
    }
  });

  it('uses the files API to resolve snapshot references to workspace source', async () => {
    clearPreviewCardCachesForTest();
    const globalWithWindow = globalThis as unknown as { window?: { codesign?: unknown } };
    const previousWindow = globalWithWindow.window;
    const list = vi.fn(async () => [
      {
        artifactSource: '<!doctype html><body><!-- artifact source lives in index.jsx --></body>',
      },
    ]);
    const read = vi.fn(async (_designId: string, path: string) => ({
      path,
      kind: 'jsx' as const,
      size: 53,
      updatedAt: '2026-05-05T00:00:00.000Z',
      content: 'function App(){ return <main id="workspace-source">Hi</main>; }',
    }));
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        codesign: {
          snapshots: { list },
          files: { read },
        },
      },
    });

    try {
      const result = await readPreviewSourceForCard('design-1', '2026-05-05T00:00:01.000Z');

      expect(result).toEqual({
        path: 'index.jsx',
        content: 'function App(){ return <main id="workspace-source">Hi</main>; }',
      });
      expect(read).toHaveBeenCalledWith('design-1', 'index.jsx');
    } finally {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      });
      clearPreviewCardCachesForTest();
    }
  });
});
