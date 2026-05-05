import { describe, expect, it } from 'vitest';
import {
  needsJsxRuntime,
  parseCachedPreview,
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
});
