import { describe, expect, it } from 'vitest';
import { analyzeSourceEdit, planSourceEdit } from './source-edit-engine';

const source = `function App() {
  const [count, setCount] = React.useState(0);
  const dialog = React.useRef(null);
  const label = React.useMemo(() => String(count), [count]);
  React.useEffect(() => { document.title = label; }, [label]);
  return <main><h1 title="Original" style={{gap:2}}>Welcome</h1>
    <button onClick={() => setCount(count + 1)}>{label}</button>
    {[1, 2].map(n => <p>Repeated</p>)}
    <section ref={dialog}><span>Dialog</span></section>
  </main>;
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);`;

function inspect() {
  const result = analyzeSourceEdit({ path: 'App.jsx', source });
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
    expectedSourceHash: result.sourceHash,
    targetId: target.id,
    scope: 'source-definition' as const,
    operation: { kind: 'set-text' as const, value: 'Edited' },
  };
}

describe('one preview-only source edit path', () => {
  it('rejects legacy source mode for both inspection and patch planning', () => {
    expect(analyzeSourceEdit({ path: 'App.jsx', source, selectionMode: 'source' })).toMatchObject({
      status: 'rejected',
      reason: 'source-mode-removed',
    });
    expect(planSourceEdit({ ...request('h1'), selectionMode: 'source' })).toMatchObject({
      status: 'rejected',
      reason: 'source-mode-removed',
    });
    expect(
      planSourceEdit({ ...request('h1'), source: `${source}\n// stale`, selectionMode: 'source' }),
    ).toMatchObject({ status: 'rejected', reason: 'source-mode-removed' });
  });
  it('treats omitted and explicit preview modes identically', () => {
    expect(analyzeSourceEdit({ path: 'App.jsx', source, selectionMode: 'preview' })).toEqual(
      inspect(),
    );
    expect(planSourceEdit({ ...request('h1'), selectionMode: 'preview' })).toEqual(
      planSourceEdit(request('h1')),
    );
  });
  it('keeps existing text, attribute and style candidates beside effects and explicit mounting', () => {
    expect(inspect().targets.find((t) => t.tagName === 'h1')?.editableFields).toEqual([
      { kind: 'set-text', value: 'Welcome' },
      { kind: 'set-attribute', name: 'title', value: 'Original' },
      { kind: 'set-style', property: 'gap', value: '2' },
    ]);
    expect(
      planSourceEdit({
        ...request('h1'),
        operation: { kind: 'set-attribute', name: 'title', value: 'Changed' },
      }),
    ).toMatchObject({
      status: 'applied',
      content: source.replace('title="Original"', 'title={"Changed"}'),
    });
    expect(
      planSourceEdit({
        ...request('h1'),
        operation: { kind: 'set-style', property: 'gap', value: '8' },
      }),
    ).toMatchObject({ status: 'applied', content: source.replace('gap:2', 'gap:8') });
  });
  it('replaces only the selected static literal without executing effects', () => {
    const result = planSourceEdit(request('h1'));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') throw new Error(result.message);
    expect(result.content).toBe(source.replace('>Welcome<', '>{"Edited"}<'));
    expect(result.content).not.toContain('data-codesign-source-id');
  });
  it('refuses dynamic data but edits repeated literal definitions with shared scope', () => {
    expect(planSourceEdit(request('button'))).toMatchObject({
      status: 'rejected',
      reason: 'unsupported-field',
    });
    expect(planSourceEdit(request('p'))).toMatchObject({
      status: 'applied',
      scope: 'source-definition',
      content: source.replace('>Repeated<', '>{"Edited"}<'),
    });
  });
  it('does not overwrite external edits or accept forged targets', () => {
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
      analyzeSourceEdit({ path: 'App.jsx', source: `import x from "x";${source}` }),
    ).toMatchObject({ status: 'rejected', reason: 'unsupported-module' });
    expect(
      analyzeSourceEdit({
        path: 'App.jsx',
        source: 'function App(){return flag ? <h1>A</h1> : <h1>B</h1>}',
      }),
    ).toMatchObject({ status: 'rejected', reason: 'unsupported-entry' });
  });
});
