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
    listDir(dir = '.') {
      const prefix = dir === '.' || dir.length === 0 ? '' : `${dir.replace(/\/$/, '')}/`;
      return [...map.keys()].filter((path) => path.startsWith(prefix)).sort();
    },
  };
}

const VALID_DESIGN_MD = `---
version: alpha
name: Project System
colors:
  primary: "#111111"
typography:
  body:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
rounded:
  sm: 4px
spacing:
  sm: 8px
---

## Overview

Use a compact product design system.
`;

describe('done tool', () => {
  it('documents unresolved-error warnings for artifact finalization', () => {
    const tool = makeDoneTool(makeFs());
    expect(tool.description).toContain('surface warnings to the user');
  });

  it('returns ok when App.jsx parses cleanly by default', async () => {
    const fs = makeFs({
      'App.jsx': `function App() { return <main><h1>Hi</h1></main>; }
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);`,
    });
    const tool = makeDoneTool(fs);
    const res = await tool.execute('id1', { summary: 'shipped' });
    expect(res.details.status).toBe('ok');
    expect(res.details.errors).toHaveLength(0);
    expect(res.details.summary).toBe('shipped');
  });

  it('falls back to legacy index.html when App.jsx is absent', async () => {
    const fs = makeFs({
      'index.html':
        '<!doctype html><html><head><title>t</title></head><body><main><h1>Hi</h1></main></body></html>',
    });
    const tool = makeDoneTool(fs);
    const res = await tool.execute('id-legacy', {});
    expect(res.details.status).toBe('ok');
    expect(res.details.path).toBe('index.html');
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

  it('does not count JSX component id props as duplicate DOM ids', async () => {
    const fs = makeFs({
      'App.jsx': `function Field({ id, children }) {
  return <label htmlFor={id}>{children}</label>;
}
function App() {
  return (
    <main>
      <Field id="email">
        <input id="email" />
      </Field>
    </main>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);`,
    });
    const tool = makeDoneTool(fs);
    const res = await tool.execute('id-jsx-component-id-prop', {});
    expect(res.details.errors.some((e) => /Duplicate id/.test(e.message))).toBe(false);
  });

  it('does not treat apostrophes in JSX text as string delimiters', async () => {
    const fs = makeFs({
      'App.jsx': `const css = \`
.paper { background: color-mix(in oklab, #fff 80%, transparent); }
\`;
function App() {
  return (
    <main>
      <style>{css}</style>
      <p>Spring '25 brand refresh, packaging system &amp; site art direction.</p>
    </main>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);`,
    });
    const tool = makeDoneTool(fs);
    const res = await tool.execute('id-jsx-text-apostrophe', {});
    expect(res.details.errors.some((e) => /Unbalanced/.test(e.message))).toBe(false);
  });

  it('can require DESIGN.md before accepting an app artifact', async () => {
    const fs = makeFs({
      'App.jsx': `function App() { return <main><h1>Hi</h1></main>; }
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);`,
    });
    const tool = makeDoneTool(fs, undefined, { requireDesignMd: true });
    const res = await tool.execute('id-require-design-md', {});
    expect(res.details.status).toBe('has_errors');
    expect(res.details.errors.some((e) => e.source === 'DESIGN.md')).toBe(true);
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

  it('validates DESIGN.md directly with the Google design.md rules', async () => {
    const fs = makeFs({ 'DESIGN.md': VALID_DESIGN_MD });
    const tool = makeDoneTool(fs);
    const res = await tool.execute('id-design-md', { path: 'DESIGN.md' });
    expect(res.details.status).toBe('ok');
    expect(res.details.path).toBe('DESIGN.md');
  });

  it('reports DESIGN.md validation errors directly', async () => {
    const fs = makeFs({ 'DESIGN.md': VALID_DESIGN_MD.replace('rounded:', 'radius:') });
    const tool = makeDoneTool(fs);
    const res = await tool.execute('id-design-md-bad', { path: 'DESIGN.md' });
    expect(res.details.status).toBe('has_errors');
    expect(res.details.errors.some((e) => /radius/.test(e.message))).toBe(true);
  });

  it('validates existing DESIGN.md before accepting App.jsx', async () => {
    const fs = makeFs({
      'App.jsx': `function App() { return <main><h1>Hi</h1></main>; }
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);`,
      'DESIGN.md': VALID_DESIGN_MD.replace('fontWeight: 400', 'weight: 400'),
    });
    const tool = makeDoneTool(fs);
    const res = await tool.execute('id-app-with-bad-design-md', { path: 'App.jsx' });
    expect(res.details.status).toBe('has_errors');
    expect(res.details.errors.some((e) => e.source === 'DESIGN.md')).toBe(true);
  });

  it('requires DESIGN.md when multiple renderable design sources exist', async () => {
    const fs = makeFs({
      'App.jsx': `function App() { return <main><h1>Hi</h1></main>; }
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);`,
      'settings.jsx': `function App() { return <main><h1>Settings</h1></main>; }
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);`,
    });
    const tool = makeDoneTool(fs);
    const res = await tool.execute('id-multi-no-design-md', { path: 'App.jsx' });
    expect(res.details.status).toBe('has_errors');
    expect(res.details.errors.some((e) => /DESIGN\.md/.test(e.message))).toBe(true);
  });

  it('ignores built-in template roots when deciding whether DESIGN.md is required', async () => {
    const fs = makeFs({
      'App.jsx': `function App() { return <main><h1>Hi</h1></main>; }
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);`,
      'frames/iphone.jsx': 'function IPhoneFrame() { return <div />; }',
      'skills/dashboard.jsx': 'function DashboardSkill() { return <div />; }',
      '_starters/template.html': '<main>starter</main>',
    });
    const tool = makeDoneTool(fs);
    const res = await tool.execute('id-template-roots', { path: 'App.jsx' });
    expect(res.details.status).toBe('ok');
  });

  it('ignores renderable asset paths when deciding whether DESIGN.md is required', async () => {
    const fs = makeFs({
      'App.jsx': `function App() { return <main><h1>Hi</h1></main>; }
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);`,
      'assets/demo.html': '<main>asset preview</main>',
    });
    const tool = makeDoneTool(fs);
    const res = await tool.execute('id-asset-html', { path: 'App.jsx' });
    expect(res.details.status).toBe('ok');
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
