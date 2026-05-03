import { describe, expect, it, vi } from 'vitest';
import { makeDoneTool } from './done.js';
import type { TextEditorFsCallbacks } from './text-editor.js';

function makeFs(initial: Record<string, string> = {}): TextEditorFsCallbacks {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    view(path) {
      const c = map.get(path);
      return c === undefined ? null : { content: c, numLines: c.split('\n').length };
    },
    create(path, content) {
      map.set(path, content);
      return { path };
    },
    strReplace(path, oldStr, newStr) {
      const cur = map.get(path);
      if (cur === undefined) throw new Error('not found');
      map.set(path, cur.replace(oldStr, newStr));
      return { path };
    },
    insert(path) {
      return { path };
    },
    listDir() {
      return [];
    },
  };
}

describe('done tool', () => {
  it('documents unresolved-error warnings for artifact finalization', () => {
    const tool = makeDoneTool(makeFs());
    expect(tool.description).toContain('surface warnings to the user');
  });

  it('returns ok when index.html parses cleanly', async () => {
    const fs = makeFs({
      'index.html':
        '<!doctype html><html><head><title>t</title></head><body><main><h1>Hi</h1></main></body></html>',
    });
    const tool = makeDoneTool(fs);
    const res = await tool.execute('id1', { summary: 'shipped' });
    expect(res.details.status).toBe('ok');
    expect(res.details.errors).toHaveLength(0);
    expect(res.details.summary).toBe('shipped');
  });

  it('reports has_errors with line numbers when tags are unbalanced', async () => {
    const fs = makeFs({
      'index.html': '<!doctype html><html><body>\n<section>\n<div>\n</body></html>',
    });
    const tool = makeDoneTool(fs);
    const res = await tool.execute('id2', {});
    expect(res.details.status).toBe('has_errors');
    expect(res.details.errors.some((e) => /Unclosed/.test(e.message))).toBe(true);
  });

  it('reports has_errors when target file is missing', async () => {
    const fs = makeFs();
    const tool = makeDoneTool(fs);
    const res = await tool.execute('id3', {});
    expect(res.details.status).toBe('has_errors');
    expect(res.details.errors[0]?.message).toMatch(/File not found/);
  });

  it('flags duplicate ids and missing alt', async () => {
    const fs = makeFs({
      'index.html':
        '<!doctype html><html><body><div id="x"></div><div id="x"></div><img src="a.png"></body></html>',
    });
    const tool = makeDoneTool(fs);
    const res = await tool.execute('id4', {});
    expect(res.details.status).toBe('has_errors');
    expect(res.details.errors.some((e) => /Duplicate id/.test(e.message))).toBe(true);
    expect(res.details.errors.some((e) => /alt/.test(e.message))).toBe(true);
  });

  it('merges runtime verifier errors with static lint output', async () => {
    // Syntactically clean HTML — static lint passes — but runtime verifier
    // (host-injected stub here) reports a ReferenceError as if the JSX
    // failed at mount time. Assert both make it into the merged result.
    const fs = makeFs({
      'index.html': '<!doctype html><html><body><main><h1>Hi</h1></main></body></html>',
    });
    const runtimeVerify = vi.fn(async () => [
      {
        message: 'ReferenceError: TWEAK_DEFAULT is not defined',
        source: 'console.error',
        lineno: 12,
      },
    ]);
    const tool = makeDoneTool(fs, runtimeVerify);
    const res = await tool.execute('id5', { summary: 'shipped' });
    expect(runtimeVerify).toHaveBeenCalledOnce();
    expect(res.details.status).toBe('has_errors');
    expect(res.details.errors.some((e) => /ReferenceError/.test(e.message))).toBe(true);
    expect(res.details.errors.some((e) => e.source === 'console.error')).toBe(true);
  });

  it('returns ok when runtime verifier reports no errors', async () => {
    const fs = makeFs({
      'index.html': '<!doctype html><html><body><main><h1>Hi</h1></main></body></html>',
    });
    const runtimeVerify = vi.fn(async () => []);
    const tool = makeDoneTool(fs, runtimeVerify);
    const res = await tool.execute('id6', {});
    expect(res.details.status).toBe('ok');
    expect(res.details.errors).toHaveLength(0);
    expect(res.content[0]?.type).toBe('text');
  });

  it('flags stray content after ReactDOM.createRoot render (JSX)', async () => {
    const fs = makeFs({
      'index.html': `const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{}/*EDITMODE-END*/;
function App() { return <div>Hi</div>; }
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
| // stray pipe character that breaks Babel`,
    });
    const tool = makeDoneTool(fs);
    const res = await tool.execute('id-syntax-tail', {});
    expect(res.details.status).toBe('has_errors');
    expect(
      res.details.errors.some((e) => /Unexpected content after ReactDOM/.test(e.message)),
    ).toBe(true);
  });

  it('flags unbalanced braces in JSX', async () => {
    const fs = makeFs({
      'index.html': `const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{}/*EDITMODE-END*/;
function App() { return <div>Hi</div>; }}
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);`,
    });
    const tool = makeDoneTool(fs);
    const res = await tool.execute('id-syntax-brace', {});
    expect(res.details.status).toBe('has_errors');
    expect(res.details.errors.some((e) => /Unbalanced braces/.test(e.message))).toBe(true);
  });

  it('flags missing ReactDOM.createRoot call when content is JSX-shaped', async () => {
    const fs = makeFs({
      'index.html': `const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{}/*EDITMODE-END*/;
function App() { return <div>Hi</div>; }`,
    });
    const tool = makeDoneTool(fs);
    const res = await tool.execute('id-syntax-no-root', {});
    expect(res.details.status).toBe('has_errors');
    expect(res.details.errors.some((e) => /Missing ReactDOM\.createRoot/.test(e.message))).toBe(
      true,
    );
  });

  it('reports legacy render helper without HTML tag noise', async () => {
    const fs = makeFs({
      'index.html': `const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{}/*EDITMODE-END*/;
function Page() {
  return (
    <main>
      <button onClick={() => {}}>All</button>
    </main>
  );
}
render(<Page />);`,
    });
    const tool = makeDoneTool(fs);
    const res = await tool.execute('id-legacy-render', {});
    expect(res.details.status).toBe('has_errors');
    expect(res.details.errors.some((e) => /Legacy render\(<Page \/>/.test(e.message))).toBe(true);
    expect(res.details.errors.some((e) => /Unclosed|Closing <\//.test(e.message))).toBe(false);
  });

  it('does not run HTML tag balancing over JSX arrow-function props', async () => {
    const fs = makeFs({
      'index.html': `const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{}/*EDITMODE-END*/;
function FilterPill({ onClick }) {
  return <button onClick={onClick}>All</button>;
}
function App() {
  const [active, setActive] = React.useState("all");
  return (
    <main>
      <FilterPill active={active === "all"} onClick={() => setActive("all")} />
    </main>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);`,
    });
    const tool = makeDoneTool(fs);
    const res = await tool.execute('id-jsx-arrow-prop', {});
    expect(res.details.status).toBe('ok');
    expect(res.details.errors).toHaveLength(0);
  });
});
