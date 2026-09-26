import { createHash } from 'node:crypto';
import { parse } from '@babel/parser';
import {
  SourceEditApplyResultV1,
  SourceEditInspectResultV1,
  type SourceEditOperation,
} from '@open-codesign/shared';
import { describe, expect, it, vi } from 'vitest';
import { analyzeSourceEdit, planSourceEdit } from './source-edit-engine';

vi.mock('@babel/parser', { spy: true });

function inspect(source: string, path = 'App.jsx') {
  const result = analyzeSourceEdit({ path, source });
  expect(SourceEditInspectResultV1.safeParse(result).success).toBe(true);
  if (result.status !== 'ready') throw new Error(`${result.reason}: ${result.message}`);
  return result;
}
function apply(
  source: string,
  operation: SourceEditOperation,
  tagName = 'header',
  path = 'App.jsx',
) {
  const result = inspect(source, path);
  const target = result.targets.find((item) => item.tagName === tagName);
  if (!target) throw new Error('Missing fixture target');
  return planSourceEdit({
    path,
    source,
    expectedSourceHash: result.sourceHash,
    targetId: target.id,
    operation,
    scope: 'source-definition',
  });
}
function applied(
  source: string,
  operation: SourceEditOperation,
  tagName = 'header',
  path = 'App.jsx',
) {
  const result = apply(source, operation, tagName, path);
  expect(SourceEditApplyResultV1.safeParse(result).success).toBe(true);
  if (result.status !== 'applied') throw new Error(`${result.reason}: ${result.message}`);
  expect(source.slice(result.patch.start, result.patch.end)).toBe(result.patch.expectedText);
  expect(Buffer.from(result.content.slice(0, result.patch.start))).toEqual(
    Buffer.from(source.slice(0, result.patch.start)),
  );
  expect(
    Buffer.from(result.content.slice(result.patch.start + result.patch.replacement.length)),
  ).toEqual(Buffer.from(source.slice(result.patch.end)));
  expect(result.sourceHash).toBe(createHash('sha256').update(result.content, 'utf8').digest('hex'));
  expect(() =>
    parse(result.content, {
      sourceType: 'module',
      plugins: path.endsWith('.tsx') ? ['jsx', 'typescript'] : ['jsx'],
    }),
  ).not.toThrow();
  return result;
}
const simple =
  'function App() { return <header title="Welcome" style={{ gap: 12, color: "red" }}>Hello</header>; }';

describe('source-definition span editing support matrix', () => {
  it('edits a static App header with one exact span and no pretty printing', () => {
    const result = applied(simple, { kind: 'set-text', value: 'Goodbye' });
    expect(result.content).toBe(simple.replace('>Hello<', '>{"Goodbye"}<'));
    expect(result.patch.expectedText).toBe('Hello');
    expect(result.scope).toBe('source-definition');
  });
  it('replaces existing title and gap literals only', () => {
    expect(
      applied(simple, { kind: 'set-attribute', name: 'title', value: 'New title' }).content,
    ).toBe(simple.replace('title="Welcome"', 'title={"New title"}'));
    expect(applied(simple, { kind: 'set-style', property: 'gap', value: '24' }).content).toBe(
      simple.replace('gap: 12', 'gap: 24'),
    );
    expect(applied(simple, { kind: 'set-style', property: 'gap', value: '1rem' }).content).toBe(
      simple.replace('gap: 12', 'gap: "1rem"'),
    );
  });
  it.each(['title', 'placeholder', 'alt'] as const)('edits a static %s attribute', (name) => {
    const source = `const App = () => <input ${name}={'Old'} />;`;
    expect(
      applied(source, { kind: 'set-attribute', name, value: 'New' }, 'input').content,
    ).toContain(`${name}={"New"}`);
  });
  it.each([
    'color',
    'backgroundColor',
    'fontSize',
    'gap',
    'padding',
    'borderRadius',
    'maxWidth',
  ] as const)('edits existing style property %s', (property) => {
    const source = `const App = () => <header style={{ ${property}: "${property.includes('olor') ? 'red' : '1px'}" }}>Hi</header>;`;
    const value = property.includes('olor') ? '#aabbcc' : '2rem';
    expect(applied(source, { kind: 'set-style', property, value }).content).toContain(
      `${property}: "${value}"`,
    );
  });
  it('uses original UTF16 offsets, preserves BOM/CRLF and hashes exact UTF8', () => {
    const source =
      '\uFEFF// emoji 😀\r\nfunction App() {\r\n return <header title="A">Hello</header>;\r\n}\r\n';
    const result = inspect(source);
    expect(result.sourceHash).toBe(createHash('sha256').update(source, 'utf8').digest('hex'));
    const target = result.targets[0];
    expect(target?.start).toBe(source.indexOf('<header'));
    expect(target?.id).toBe(`${source.indexOf('<header')}:${source.indexOf('</header>') + 9}`);
    expect(target?.insertionOffset).toBe(source.indexOf('>Hello'));
    const edited = applied(source, { kind: 'set-text', value: 'Next\nline 😀' });
    expect(edited.content).toBe(source.replace('Hello', '{"Next\\nline 😀"}'));
    expect(edited.content.startsWith('\uFEFF')).toBe(true);
  });
  it('escapes JSX/JS syntax, quotes, newlines, script boundaries and Unicode separators', () => {
    const value = '"}\n</header><script>alert(1)</script> & \\ \u2028\u2029';
    const result = applied(simple, { kind: 'set-text', value });
    expect(inspect(result.content).targets[0]?.editableFields).toContainEqual({
      kind: 'set-text',
      value,
    });
    expect(result.patch.replacement).not.toContain('<script>');
    expect(result.patch.replacement).not.toContain('\u2028');
    expect(applied(result.content, { kind: 'set-text', value: 'Again' }).content).toContain(
      '>{"Again"}</header>',
    );
  });
  it('treats attribute injection attempts as escaped literal text', () => {
    const value = '" onClick={evil()} x="';
    const result = applied(simple, { kind: 'set-attribute', name: 'title', value });
    expect(inspect(result.content).targets[0]?.editableFields).toContainEqual({
      kind: 'set-attribute',
      name: 'title',
      value,
    });
  });
  it.each([
    ['Hello\n  world', 'Hello world'],
    ['\r\n   Hello\r\n   world\r\n ', 'Hello world'],
    ['  Hello  ', '  Hello  '],
    ['A\tB &amp; C', 'A B & C'],
  ])('normalizes JSXText %j as React does', (text, value) => {
    expect(
      inspect(`const App = () => <header>${text}</header>;`).targets[0]?.editableFields,
    ).toContainEqual({ kind: 'set-text', value });
  });
  it('supports TSX, _App and direct fragments without creating new preview entries', () => {
    const source =
      'type Label = string; const _App = (): JSX.Element => <><header title={"Hi"}>Hello</header></>;';
    expect(
      applied(source, { kind: 'set-text', value: 'TSX' }, 'header', 'view.tsx').content,
    ).toContain('{"TSX"}');
  });
  it('positions annotation before the original slash in self-closing tags', () => {
    const source = 'function App(){return <input title="A" />;}';
    const target = inspect(source).targets[0];
    expect(source.slice(target?.insertionOffset)).toBe('/>;}');
  });
  it.each([
    'React.useState',
    'useState',
  ])('edits static header/layout beside %s state and pure setter handlers', (hook) => {
    const source = `function App(){ const [count,setCount]=${hook}(0); return <main style={{gap:8}}><header title="Static">Welcome</header><button onClick={()=>setCount(c=>c+1)}>{count}</button></main>; }`;
    const result = inspect(source);
    expect(result.targets.find((target) => target.tagName === 'button')?.editableFields).toEqual(
      [],
    );
    expect(applied(source, { kind: 'set-text', value: 'Updated' }).content).toContain(
      '>{"Updated"}</header>',
    );
    expect(
      applied(source, { kind: 'set-attribute', name: 'title', value: 'Title' }).content,
    ).toContain('title={"Title"}');
    expect(
      applied(source, { kind: 'set-style', property: 'gap', value: '16' }, 'main').content,
    ).toContain('gap:16');
  });
  it.each([
    '()=>setCount(count+1)',
    '()=>{setCount(c=>{return c+1});}',
    'function(){return setCount(0)}',
  ])('supports a pure inline state handler %s', (handler) => {
    const source = `function App(){const [count,setCount]=React.useState(0);return <header onClick={${handler}}>Static</header>}`;
    expect(applied(source, { kind: 'set-text', value: 'New' }).scope).toBe('source-definition');
  });
  it('leaves static layout editable despite dynamic/map/custom descendants', () => {
    const source =
      'function App(){ const xs=[1]; return <header title="Layout" style={{gap: 8}}>{xs.map(x => <span title="dynamic">{x}</span>)}<Card><b>Forwarded</b></Card><footer>Static</footer></header>;}';
    const result = inspect(source);
    expect(
      result.targets.find((target) => target.tagName === 'header')?.editableFields,
    ).toContainEqual({ kind: 'set-style', property: 'gap', value: '8' });
    expect(result.targets.find((target) => target.tagName === 'span')?.editableFields).toEqual([]);
    expect(result.targets.find((target) => target.tagName === 'b')?.editableFields).toEqual([]);
    expect(
      result.targets.find((target) => target.tagName === 'footer')?.editableFields,
    ).toContainEqual({ kind: 'set-text', value: 'Static' });
    expect(applied(source, { kind: 'set-style', property: 'gap', value: '16' }).content).toContain(
      'gap: 16',
    );
  });
});

function expectLiteralCandidates(source: string, path = 'App.jsx') {
  const withLiterals = source.replace('<header', '<header title="Original" style={{gap:2}}');
  const result = inspect(withLiterals, path);
  for (const target of result.targets) {
    if (target.tagName === 'header' && target.editableFields.length) {
      expect(target.editableFields).toContainEqual({
        kind: 'set-attribute',
        name: 'title',
        value: 'Original',
      });
      expect(target.editableFields).toContainEqual({
        kind: 'set-style',
        property: 'gap',
        value: '2',
      });
    }
    for (const operation of target.editableFields)
      expect(
        planSourceEdit({
          path,
          source: withLiterals,
          expectedSourceHash: result.sourceHash,
          targetId: target.id,
          scope: 'source-definition',
          operation,
        }),
      ).toMatchObject({ status: 'applied' });
  }
}
function expectRejectedByInspectAndPlan(source: string, reason: string, path = 'App.jsx') {
  expect(analyzeSourceEdit({ path, source })).toMatchObject({ status: 'rejected', reason });
  const result = planSourceEdit({
    path,
    source,
    expectedSourceHash: createHash('sha256').update(source, 'utf8').digest('hex'),
    targetId: `${source.indexOf('<header>')}:${source.indexOf('</header>') + 9}`,
    operation: { kind: 'set-text', value: 'Changed' },
    scope: 'source-definition',
  });
  expect(result).toMatchObject({ status: 'rejected', reason });
  expect(result).not.toHaveProperty('content');
}

describe('preview runtime reserved literal boundaries', () => {
  it.each([
    'ReactDOM.createRoot',
    'A ReactDOM.createRoot example',
    '/*EDITMODE-BEGIN*/hello/*EDITMODE-END*/',
    '/* EDITMODE-BEGIN */',
    '/*outer/*EDITMODE-BEGIN*/',
    '/* E D I T M O D E - E N D */',
    '/*EDITMODE-END*/',
    '/*TWEAK-SCHEMA-BEGIN*/',
    '/* TWEAK-SCHEMA-END */',
    '/* T W E A K - S C H E M A - B E G I N */',
    '<!-- AGENT_BODY_BEGIN -->',
    '<!-- AGENT_BODY_END -->',
    '<!-- CODESIGN_OVERLAY_SCRIPT -->',
    '<!-- CODESIGN_JSX_RUNTIME -->',
    '<!-- CODESIGN_STANDALONE_RUNTIME -->',
    '<!-- OPEN-CODESIGN-PREVIEW-VIEWPORT -->',
    'function App() {}',
    'const App = () => null',
    'let _App = () => null',
    'Example: function _App() {}',
  ])('rejects reserved runtime text/attribute value %j in the full plan path', (value) => {
    const operations: SourceEditOperation[] = [
      { kind: 'set-text', value },
      { kind: 'set-attribute', name: 'title', value },
    ];
    for (const operation of operations) {
      const result = apply(simple, operation);
      expect(result).toMatchObject({ status: 'rejected', reason: 'runtime-reserved-value' });
      expect(result).not.toHaveProperty('content');
    }
  });
  it.each([
    'data-codesign-source-id is ordinary body text',
    '</SCRIPT><b>ordinary HTML text</b>',
    'function Application is not App',
    'const App2 is not App',
  ])('does not reserve ordinary prose %j', (value) => {
    const result = applied(simple, { kind: 'set-text', value });
    expect(inspect(result.content).targets[0]?.editableFields).toContainEqual({
      kind: 'set-text',
      value,
    });
  });
});

describe('public review regressions: script entries and effects', () => {
  it.each([
    'export default function App(){return <header>Hello</header>}',
    'export function App(){return <header>Hello</header>}',
    'export const App=()=> <header>Hello</header>;',
    'function App(){return <header>Hello</header>} export {App};',
    'function App(){return <header>Hello</header>} export {};',
    'function App(){return <header>Hello</header>} export * from "./other";',
    'import React from "react"; function App(){return <header>Hello</header>}',
    'import "./effects"; function App(){return <header>Hello</header>}',
  ])('rejects module syntax incompatible with script preview: %s', (source) => {
    expectRejectedByInspectAndPlan(source, 'unsupported-module');
  });
  it.each([
    'import type {FC} from "react"; function App(){return <header>Hello</header>}',
    'export type Label = string; function App(){return <header>Hello</header>}',
  ])('rejects TSX module shapes too: %s', (source) => {
    expectRejectedByInspectAndPlan(source, 'unsupported-module', 'App.tsx');
  });
  it('keeps direct literal candidates beside effects for independent preview verification', () => {
    const source = `function App(){React.useEffect(()=>{self['document'].getElementsByTagName('header')[0].append(' injected')},[]);return <header>Hello</header>}`;
    expectLiteralCandidates(source);
  });
  it.each([
    'React.useEffect(()=>{},[])',
    'React.useLayoutEffect(()=>{},[])',
    'React.useInsertionEffect(()=>{},[])',
    'React.useImperativeHandle(handle,()=>({}),[])',
    'React.useSyncExternalStore(subscribe,snapshot)',
    'useEffect(()=>{},[])',
    'const effect=React.useEffect; effect(()=>{},[])',
    "const R=React; R['use'+'Effect'](()=>{},[])",
    `React['useEffect'](()=>{},[])`,
    `React['use'+'Effect'](()=>{},[])`,
  ])('keeps direct literal candidates beside non-state or reflected hooks: %s', (effect) => {
    expectLiteralCandidates(`function App(){${effect};return <header>Hello</header>}`);
  });
  it.each([
    'self',
    'global',
    'globalThis',
    'top',
    'parent',
    'this',
  ])('keeps direct literal candidates beside the %s global/reflection entry', (entry) => {
    expectLiteralCandidates(
      `function App(){${entry}['document'].getElementsByTagName('header')[0].append(' injected');return <header>Hello</header>}`,
    );
  });
});

describe('preview candidates do not execute or globally reject scheduling code', () => {
  it('exposes existing literal fields without executing string timers', () => {
    const source = `function App(){setTimeout("document.querySelector('header').textContent='injected'",0);return <header>Hello</header>}`;
    expectLiteralCandidates(source);
  });
  it('keeps direct literal candidates for callback timers as well', () => {
    expectLiteralCandidates('function App(){setTimeout(()=>{},0);return <header>Hello</header>}');
  });
  it.each([
    'setTimeout',
    'setInterval',
    'setImmediate',
    'clearTimeout',
    'clearInterval',
    'clearImmediate',
    'queueMicrotask',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'requestIdleCallback',
    'cancelIdleCallback',
    'scheduler',
    'postMessage',
    'MessageChannel',
    'MessagePort',
  ])('keeps direct literal candidates for scheduling global %s through aliases', (reference) => {
    expectLiteralCandidates(
      `function App(){const schedule=${reference};return <header>Hello</header>}`,
    );
  });
});

describe('conservative rejection and independent revalidation', () => {
  it.each([
    ['export default () => <header>Hi</header>', 'unsupported-module'],
    ['function Page(){return <header>Hi</header>}', 'unsupported-entry'],
    ['function App(p){return <header>{p.children}</header>}', 'unsupported-entry'],
    [
      'function App(){if(x)return <header>A</header>;return <header>B</header>}',
      'unsupported-entry',
    ],
    ['function App(){return <header>A</header>} const Alias=App;', 'reused-entry'],
    ['import Card from "./Card"; function App(){return <header>A</header>}', 'unsupported-module'],
    ['function App(){document.body.innerHTML="x";return <header>A</header>}', 'unsafe-source'],
    ['function App(){return <header ref={r}>A</header>}', 'unsafe-source'],
    ['function App(){return <header onClick={() => change()}>A</header>}', 'unsafe-source'],
    [
      'function App(){return <header onClick={e=>e.currentTarget.style.color="red"}>A</header>}',
      'unsafe-source',
    ],
    [
      'function App(){return <header onClick={e=>e.target.textContent="changed"}>A</header>}',
      'unsafe-source',
    ],
    [
      'function App(){return <header onClick={e=>e.target.setAttribute("title","changed")}>A</header>}',
      'unsafe-source',
    ],
    [
      'function App(){Reflect.set(target,"title","changed");return <header>A</header>}',
      'unsafe-source',
    ],
    [
      'function App(){const [count,setCount]=React.useState(0);return <header onClick={()=>setCount(c=>{document.body.textContent="x";return c+1})}>A</header>}',
      'unsafe-source',
    ],
    ['function App(){const x={};x.value=1;return <header>A</header>}', 'unsafe-source'],
    ['function App(){return <header dangerouslySetInnerHTML={{__html:"x"}}/>}', 'unsafe-source'],
    [
      'function App(){return <header>A</header>} ReactDOM.createRoot(root).render(<App/>);',
      'unsafe-source',
    ],
  ])('separates structural refusal from globally opaque execution: %s', (source, reason) => {
    if (reason === 'unsafe-source' || reason === 'reused-entry') {
      expectLiteralCandidates(source);
    } else
      expect(analyzeSourceEdit({ path: 'App.jsx', source })).toMatchObject({
        status: 'rejected',
        reason,
      });
  });
  it.each([
    'function useState(){return [0,evil]} function App(){const [count,setCount]=useState(0);return <header onClick={()=>setCount(0)}>Static</header>}',
    'function App(){const [count,setCount]=React.useState(0);return <header>{items.map(setCount=><button onClick={()=>setCount(0)}>Click</button>)}</header>}',
    'function App(){const [count,setCount]=React.useState(0);return <header onClick={count=>setCount(count)}>Static</header>}',
  ])('does not let opaque hook/setter/value bindings hide direct literal candidates: %s', (source) => {
    expectLiteralCandidates(source);
  });
  it('rejects stale hashes before locating targets', () => {
    const inspected = inspect(simple);
    expect(
      planSourceEdit({
        path: 'App.jsx',
        source: `${simple}\n`,
        expectedSourceHash: inspected.sourceHash,
        targetId: inspected.targets[0]?.id ?? '',
        operation: { kind: 'set-text', value: 'x' },
        scope: 'source-definition',
      }),
    ).toMatchObject({ status: 'rejected', reason: 'stale-source' });
  });
  it('does not authorize a forged source range or target id', () => {
    const inspected = inspect(simple);
    for (const targetId of [
      '0:12',
      `${simple.indexOf('Hello')}:${simple.indexOf('Hello') + 5}`,
      '01:02',
      'constructor',
    ]) {
      expect(
        planSourceEdit({
          path: 'App.jsx',
          source: simple,
          expectedSourceHash: inspected.sourceHash,
          targetId,
          operation: { kind: 'set-text', value: 'x' },
          scope: 'source-definition',
        }),
      ).toMatchObject({ status: 'rejected', reason: 'invalid-target' });
    }
  });
  it.each([
    '<header {...props} title="x">A</header>',
    '<header title="x" title="y">A</header>',
    '<header data-codesign-source-id="fake">A</header>',
    '<header children={other}>A</header>',
    '<header is="custom-header">A</header>',
    '<header contentEditable>A</header>',
  ])('disables ambiguous/provenance targets %s', (jsx) => {
    const source = `function App(){return ${jsx}}`;
    expect(inspect(source).targets[0]?.editableFields).toEqual([]);
    expect(apply(source, { kind: 'set-text', value: 'x' })).toMatchObject({
      status: 'rejected',
      reason: 'unsupported-field',
    });
  });
  it('lists custom and raw-content host definitions without editing them', () => {
    const source =
      'function App(){return <><my-widget title="X"/><script>{"alert(1)"}</script><style>{"p{}"}</style></>}';
    const targets = inspect(source).targets;
    expect(targets.map((target) => target.tagName)).toEqual(['my-widget', 'script', 'style']);
    expect(targets.every((target) => target.editableFields.length === 0)).toBe(true);
  });
  it('edits a shared text definition without asserting instance uniqueness', () => {
    const source =
      'function Card(){return <header title="one">Shared</header>} function App(){return <Card/>}';
    expect(inspect(source).targets[0]?.editableFields).toEqual([
      { kind: 'set-text', value: 'Shared' },
    ]);
    expect(apply(source, { kind: 'set-text', value: 'x' })).toMatchObject({
      status: 'applied',
      scope: 'source-definition',
      content: source.replace('>Shared<', '>{"x"}<'),
    });
    expect(apply(source, { kind: 'set-attribute', name: 'title', value: 'x' })).toMatchObject({
      status: 'rejected',
      reason: 'unsupported-field',
    });
  });
  it.each([
    '<header>{label}</header>',
    '<header>Hello <b>child</b></header>',
    '<header>{`template`}</header>',
    '<header>{"A"}{"B"}</header>',
  ])('rejects unresolved text or a missing mixed-segment ID: %s', (jsx) => {
    expect(apply(`function App(){return ${jsx}}`, { kind: 'set-text', value: 'x' })).toMatchObject({
      status: 'rejected',
      reason: 'unsupported-field',
    });
  });
  it.each([
    'shared',
    '{ ...shared, gap: 8 }',
    '{ gap: 8, gap: 9 }',
    '{ ["gap"]: 8 }',
    '{ gap }',
    '{ gap: size }',
    '{ get gap(){ return 8 } }',
  ])('rejects ambiguous/dynamic style %s', (style) => {
    const source = `function App(){return <header style={${style}}>A</header>}`;
    expect(apply(source, { kind: 'set-style', property: 'gap', value: '9' })).toMatchObject({
      status: 'rejected',
      reason: 'unsupported-field',
    });
  });
  it('rejects dynamic and missing attributes, but not unrelated static fields', () => {
    const source = 'function App(){return <header title={name} style={{gap:8}}>A</header>}';
    expect(apply(source, { kind: 'set-attribute', name: 'title', value: 'x' }).status).toBe(
      'rejected',
    );
    expect(apply(source, { kind: 'set-attribute', name: 'alt', value: 'x' }).status).toBe(
      'rejected',
    );
    expect(applied(source, { kind: 'set-style', property: 'gap', value: '9' }).content).toContain(
      'gap:9',
    );
  });
  it.each([
    'url(https://example.test)',
    'URL(x)',
    'u\\72l(x)',
    'var(--shared)',
    'expression(alert(1))',
    '1px;display:none',
    'calc(1px + 2px)',
    '-2px',
  ])('rejects unsafe or unsupported CSS %s', (value) => {
    expect(apply(simple, { kind: 'set-style', property: 'gap', value })).toMatchObject({
      status: 'rejected',
      reason: 'invalid-style',
    });
  });
  it('rejects forged event operations at runtime, independent of TS types', () => {
    const operation = {
      kind: 'set-attribute',
      name: 'onClick',
      value: 'evil()',
    } as unknown as SourceEditOperation;
    expect(apply(simple, operation)).toMatchObject({
      status: 'rejected',
      reason: 'invalid-operation',
    });
  });
  it('rejects HTML paths and parse failures', () => {
    expect(analyzeSourceEdit({ path: 'index.html', source: simple })).toMatchObject({
      status: 'rejected',
      reason: 'unsupported-path',
    });
    expect(
      analyzeSourceEdit({ path: 'App.jsx', source: 'function App(){return <header>' }),
    ).toMatchObject({ status: 'rejected', reason: 'parse-error' });
  });
  it('never returns applied content when the second parse fails', () => {
    const inspected = inspect(simple);
    const originalAst = parse(simple, { sourceType: 'module', plugins: ['jsx'] });
    vi.mocked(parse)
      .mockReturnValueOnce(originalAst)
      .mockImplementationOnce(() => {
        throw new Error('Simulated output parser failure');
      });
    const result = planSourceEdit({
      path: 'App.jsx',
      source: simple,
      expectedSourceHash: inspected.sourceHash,
      targetId: inspected.targets[0]?.id ?? '',
      operation: { kind: 'set-text', value: 'x' },
      scope: 'source-definition',
    });
    expect(result).toMatchObject({ status: 'rejected', reason: 'reparse-failed' });
    expect(result).not.toHaveProperty('content');
  });
});
