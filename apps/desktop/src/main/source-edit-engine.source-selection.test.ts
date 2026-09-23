import { describe, expect, it } from 'vitest';
import { analyzeSourceEdit, planSourceEdit } from './source-edit-engine';

const source = `function App() {
  const [count, setCount] = React.useState(0);
  const dialog = React.useRef(null);
  const label = React.useMemo(() => String(count), [count]);
  React.useEffect(() => { document.title = label; }, [label]);
  return <main><h1 title="Original">Welcome</h1>
    <button onClick={() => setCount(count + 1)}>{label}</button>
    {[1, 2].map(n => <p>Repeated</p>)}
    <section ref={dialog}><span>Dialog</span></section>
  </main>;
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);`;

function inspect() {
  const result = analyzeSourceEdit({ path: 'App.jsx', source, selectionMode: 'source' });
  if (result.status !== 'ready') throw new Error(result.message);
  return result;
}
function request(tag: string) {
  const result = inspect();
  const target = result.targets.find((t) => t.tagName === tag);
  if (!target) throw new Error(tag);
  return {
    path: 'App.jsx',
    source,
    selectionMode: 'source' as const,
    expectedSourceHash: result.sourceHash,
    targetId: target.id,
    scope: 'source-definition' as const,
    operation: { kind: 'set-text' as const, value: 'Edited' },
  };
}

describe('explicit source selection beside opaque execution', () => {
  it('keeps preview inspection and preview apply closed', () => {
    expect(analyzeSourceEdit({ path: 'App.jsx', source })).toMatchObject({
      status: 'rejected',
      reason: 'unsafe-source',
    });
    expect(planSourceEdit({ ...request('h1'), selectionMode: 'preview' })).toMatchObject({
      status: 'rejected',
      reason: 'unsafe-source',
    });
  });
  it('replaces only the explicitly selected static literal without executing effects', () => {
    const result = planSourceEdit(request('h1'));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') throw new Error(result.message);
    expect(result.content).toBe(source.replace('>Welcome<', '>{"Edited"}<'));
    expect(result.content).not.toContain('data-codesign-source-id');
  });
  it('keeps dynamic and repeated targets unsupported', () => {
    for (const tag of ['button', 'p'])
      expect(planSourceEdit(request(tag))).toMatchObject({
        status: 'rejected',
        reason: 'unsupported-field',
      });
  });
  it('does not overwrite an external edit or accept a forged target', () => {
    expect(planSourceEdit({ ...request('h1'), source: `${source}\n// external` })).toMatchObject({
      status: 'rejected',
      reason: 'stale-source',
    });
    expect(planSourceEdit({ ...request('h1'), targetId: '0:1' })).toMatchObject({
      status: 'rejected',
      reason: 'invalid-target',
    });
  });
  it('retains field validation and module/entry boundaries', () => {
    expect(
      planSourceEdit({
        ...request('h1'),
        operation: { kind: 'set-attribute', name: 'alt', value: 'new' },
      }),
    ).toMatchObject({ status: 'rejected', reason: 'unsupported-field' });
    expect(
      analyzeSourceEdit({
        path: 'App.jsx',
        source: `import x from "x";${source}`,
        selectionMode: 'source',
      }),
    ).toMatchObject({ status: 'rejected', reason: 'unsupported-module' });
    expect(
      analyzeSourceEdit({
        path: 'App.jsx',
        source: 'function App(){return flag ? <h1>A</h1> : <h1>B</h1>}',
        selectionMode: 'source',
      }),
    ).toMatchObject({ status: 'rejected', reason: 'unsupported-entry' });
  });
});
