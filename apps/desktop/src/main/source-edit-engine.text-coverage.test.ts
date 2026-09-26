import { describe, expect, it } from 'vitest';
import { analyzeSourceEdit, planSourceEdit } from './source-edit-engine';

// Reduced from local generated resume/product/deck structures; no private originals.
const generated = `const resume = {name:'Alex', role:'Design engineer', jobs:[{title:'Engineer'},{title:'Designer'}]};
const label = 'Download';
function Badge(){return <small>Shared badge</small>}
function Icon(){return <svg aria-hidden="true"><path d="M0 0" /></svg>}
function App(){
 React.useEffect(()=>{document.title='Resume'},[]);
 return <main><h1>{resume.name}</h1><h2>{resume.role}</h2>
 <button onClick={()=>window.print()}><Icon />{label}</button>
 <p>Profile <br />and <em>craft</em>.</p>
 <section>{resume.jobs.map(job=><article><h3>{job.title}</h3><Badge /></article>)}</section>
 <aside>{resume.jobs[1].title}</aside><footer>{resume.name}</footer><span>Alex</span>
 </main>;
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);`;

function inspect(source: string) {
  const result = analyzeSourceEdit({ path: 'App.jsx', source });
  if (result.status !== 'ready') throw new Error(result.message);
  return result;
}
function change(source: string, tag: string, value: string, segment = 0) {
  const result = inspect(source);
  const target = result.targets.find((t) => t.tagName === tag);
  const operation = target?.editableFields.filter((f) => f.kind === 'set-text')[segment];
  if (!target || !operation) throw new Error(`No text for ${tag}`);
  return planSourceEdit({
    path: 'App.jsx',
    source,
    expectedSourceHash: result.sourceHash,
    targetId: target.id,
    scope: 'source-definition',
    operation: { ...operation, value },
  });
}

describe('generated page text-definition coverage', () => {
  it('maps an object field to its literal, never replacing equal text elsewhere', () => {
    const result = change(generated, 'h1', 'Morgan');
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') throw new Error(result.message);
    expect(result.patch.expectedText).toBe("'Alex'");
    expect(result.content).toBe(generated.replace("name:'Alex'", 'name:"Morgan"'));
    const after = inspect(result.content);
    for (const tag of ['h1', 'footer'])
      expect(after.targets.find((t) => t.tagName === tag)?.editableFields[0]?.value).toBe('Morgan');
    expect(after.targets.find((t) => t.tagName === 'span')?.editableFields[0]?.value).toBe('Alex');
    expect(after.targets.find((t) => t.tagName === 'h1')?.textSources?.[0]?.origin).toContain(
      'resume',
    );
  });
  it('traces a fixed array record independently of map callback parameters', () => {
    const result = change(generated, 'aside', 'Architect');
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') throw new Error(result.message);
    expect(result.content).toBe(generated.replace("title:'Designer'", 'title:"Architect"'));
    const mapped = inspect(generated).targets.find((t) => t.tagName === 'h3');
    expect(mapped?.editableFields).toEqual([]);
    expect(mapped?.unsupported).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'unresolved-text-source' })]),
    );
  });
  it('edits only one mixed child and preserves icons, elements and sibling segments', () => {
    const button = change(generated, 'button', 'Export');
    expect(button.status).toBe('applied');
    if (button.status !== 'applied') throw new Error(button.message);
    expect(button.content).toBe(
      generated.replace("const label = 'Download'", 'const label = "Export"'),
    );
    const result = change(generated, 'p', 'plus ', 1);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') throw new Error(result.message);
    expect(result.content).toBe(generated.replace('and <em>', '{"plus "}<em>'));
    expect(inspect(result.content).targets.find((t) => t.tagName === 'p')?.directText).toBe(
      'Profile plus .',
    );
  });
  it('makes shared component literals explicit source definitions', () => {
    const result = change(generated, 'small', 'Shared replacement');
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') throw new Error(result.message);
    expect(result.content).toBe(generated.replace('>Shared badge<', '>{"Shared replacement"}<'));
    const target = inspect(generated).targets.find((t) => t.tagName === 'small');
    expect(target?.scope).toBe('source-definition');
    expect(target?.textSources?.[0]?.origin).toContain('all uses');
    expect(target?.editableFields.map((f) => f.kind)).toEqual(['set-text']);
  });
  it('does not authorize a forged text segment or instance scope', () => {
    const before = inspect(generated);
    const target = before.targets.find((t) => t.tagName === 'p');
    if (!target) throw new Error('No paragraph');
    const request = {
      path: 'App.jsx',
      source: generated,
      expectedSourceHash: before.sourceHash,
      targetId: target.id,
      scope: 'source-definition' as const,
      operation: { kind: 'set-text' as const, value: 'bad', textId: '0:1' },
    };
    expect(planSourceEdit(request)).toMatchObject({
      status: 'rejected',
      reason: 'unsupported-field',
    });
    expect(
      planSourceEdit({ ...request, operation: { kind: 'set-text', value: 'bad' } }),
    ).toMatchObject({ status: 'rejected', reason: 'unsupported-field' });
    expect(planSourceEdit({ ...request, source: `${generated}\n// external` })).toMatchObject({
      status: 'rejected',
      reason: 'stale-source',
    });
  });
  it.each([
    'name.toUpperCase()',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this is generated JSX source under test
    '`Hello ${name}`',
    'flag ? name : "Other"',
    'items[index]',
    'Date.now()',
  ])('refuses computed text %s without running code', (expression) => {
    const source = `const name='Alex'; const items=['one']; function App(){return <h1>{${expression}}</h1>}`;
    const target = inspect(source).targets[0];
    expect(target?.editableFields).toEqual([]);
    expect(target?.unsupported.some((p) => p.reason === 'unresolved-text-source')).toBe(true);
  });
  it('refuses component props and transformed/forwarded children instead of guessing an instance', () => {
    const source = `function Label({text}){return <h1>{text}</h1>} function App(){return <main><Label text="First"/><Label text="Second"/><Transform><b>Child</b></Transform></main>}`;
    for (const tag of ['h1', 'b'])
      expect(inspect(source).targets.find((t) => t.tagName === tag)?.editableFields).toEqual([]);
  });
  it('keeps a Cart static segment candidate beside an unresolved count', () => {
    const source = 'function App(){return <button>Cart {count}</button>}';
    const target = inspect(source).targets[0];
    expect(target?.directText).toBeUndefined();
    expect(target?.editableFields).toEqual([
      expect.objectContaining({ kind: 'set-text', value: 'Cart ', textId: expect.any(String) }),
    ]);
    const operation = target?.editableFields[0];
    if (operation?.kind !== 'set-text') throw new Error('Missing cart text');
    expect(target?.textLayout).toEqual([
      { kind: 'text', value: 'Cart ', textId: operation.textId },
      { kind: 'dynamic' },
    ]);
    expect(change(source, 'button', 'Basket ')).toMatchObject({
      status: 'applied',
      content: source.replace('Cart ', '{"Basket "}'),
    });
  });
  it('describes native boundaries, opaque children, comments and actual literal origins in order', () => {
    const source = `const label='Download'; function App(){return <p>\n {/* comment */}\n <svg/><Icon />{label}<>{'fragment'}</>{count} tail\n </p>}`;
    const result = inspect(source);
    const target = result.targets.find((t) => t.tagName === 'p');
    const svg = result.targets.find((t) => t.tagName === 'svg');
    if (!target || !svg) throw new Error('Missing layout targets');
    const text = target.editableFields.filter((f) => f.kind === 'set-text');
    expect(text.map((f) => f.value)).toEqual(['Download', ' tail']);
    expect(target.textLayout).toEqual([
      { kind: 'element', targetId: svg.id },
      { kind: 'dynamic' },
      { kind: 'text', textId: text[0]?.textId, value: 'Download' },
      { kind: 'dynamic' },
      { kind: 'dynamic' },
      { kind: 'text', textId: text[1]?.textId, value: ' tail' },
    ]);
    const origin = target.textSources?.[0];
    expect(source.slice(origin?.start, origin?.end)).toBe("'Download'");
    const [childStart, childEnd] = text[0]?.textId?.split(':').map(Number) ?? [];
    expect(source.slice(childStart, childEnd)).toBe('{label}');
  });
  it('preserves optional IDs for legacy single literal text', () => {
    const target = inspect('function App(){return <h1>Title</h1>}').targets[0];
    expect(target?.editableFields).toEqual([{ kind: 'set-text', value: 'Title' }]);
    expect(target?.textLayout).toEqual([{ kind: 'text', value: 'Title' }]);
  });
  it('turns oversized text into dynamic metadata instead of an invalid text descriptor', () => {
    const result = inspect(`function App(){return <p>${'x'.repeat(100_001)}</p>}`);
    expect(result.targets[0]?.editableFields).toEqual([]);
    expect(result.targets[0]?.textSources).toEqual([]);
    expect(result.targets[0]?.textLayout).toEqual([{ kind: 'dynamic' }]);
    expect(result.targets[0]?.unsupported).toContainEqual(
      expect.objectContaining({ reason: 'literal-too-large' }),
    );
  });
  it('bounds native targets and flat text-layout descriptors', () => {
    for (const children of ['<span/>'.repeat(10_000), '{"x"}'.repeat(10_001)]) {
      expect(
        analyzeSourceEdit({ path: 'App.jsx', source: `function App(){return <p>${children}</p>}` }),
      ).toMatchObject({ status: 'rejected', reason: 'unsupported-targets' });
    }
  });
  it.each([
    `(data.title as string) = 'A'`,
    `data.title! = 'A'`,
    `[].__proto__.map = function(){data.title='A';return []}; data.rows.map(row=>row.title)`,
    `[].__proto__.map = function(){this[0].title='A';return []}; data.rows.map(row=>row.title)`,
    `[].constructor.prototype.map = function(){this[0].title='A';return []}; data.rows.map(row=>row.title)`,
  ])('refuses overwritten TSX/data initializers even when displayed text initially matches: %s', (mutation) => {
    const source = `const data={title:'A',rows:[{title:'A'}]}; ${mutation}; function App(){return <><h1>{data.title}</h1><h2>{data.rows[0].title}</h2></>}`;
    const result = analyzeSourceEdit({ path: 'App.tsx', source });
    if (result.status !== 'ready') throw new Error(result.message);
    for (const target of result.targets) {
      expect(target.editableFields).toEqual([]);
      expect(
        planSourceEdit({
          path: 'App.tsx',
          source,
          expectedSourceHash: result.sourceHash,
          targetId: target.id,
          scope: 'source-definition',
          operation: { kind: 'set-text', textId: target.textSources?.[0]?.textId, value: 'B' },
        }),
      ).toMatchObject({ status: 'rejected', reason: 'unsupported-field' });
    }
  });
  it('keeps existing attribute and style candidates beside opaque effects', () => {
    const source = `function App(){React.useEffect(()=>{},[]);return <h1 title="Title" style={{gap:2}}>Text</h1>}`;
    expect(inspect(source).targets[0]?.editableFields).toEqual([
      { kind: 'set-text', value: 'Text' },
      { kind: 'set-attribute', name: 'title', value: 'Title' },
      { kind: 'set-style', property: 'gap', value: '2' },
    ]);
  });
});
