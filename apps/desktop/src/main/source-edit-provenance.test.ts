import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';
import {
  type AstNode,
  children,
  createTextResolver,
  nameOf,
  node,
  walk,
} from './source-edit-provenance';

function fixture(source: string) {
  const ast = node(parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] }));
  if (!ast) throw new Error('Expected positioned AST');
  const expressions: AstNode[] = [];
  walk(ast, (current) => {
    if (current.type === 'JSXExpressionContainer') {
      const expression = node(current.expression);
      if (expression) expressions.push(expression);
    }
  });
  const resolve = createTextResolver(ast);
  return { ast, expressions, resolve, results: expressions.map(resolve) };
}

function text(source: string) {
  return fixture(source).results.at(-1);
}

describe('structural AST helpers', () => {
  it('narrows positioned nodes without depending on Babel implementation types', () => {
    expect(node(null)).toBeUndefined();
    expect(node({ type: 'Identifier' })).toBeUndefined();
    expect(node({ type: 'Identifier', start: -1, end: 2 })).toBeUndefined();
    expect(node({ type: 'Identifier', start: 2, end: 1 })).toBeUndefined();
    const identifier = { type: 'Identifier', start: 0, end: 3, name: 'foo' };
    expect(children([null, identifier])).toEqual([identifier]);
    expect(children(identifier)).toEqual([]);
    expect(nameOf(identifier)).toBe('foo');
    expect(nameOf({ type: 'StringLiteral', start: 0, end: 3, value: 'x' })).toBe('x');
  });

  it('ignores metadata and does not loop on malformed cyclic structural trees', () => {
    const root: AstNode = { type: 'Program', start: 0, end: 3 };
    root.body = [root];
    root.extra = { type: 'StringLiteral', start: 0, end: 3, value: 'fake' };
    const visited: AstNode[] = [];
    walk(root, (current) => visited.push(current));
    expect(visited).toEqual([root]);
    expect(createTextResolver(root)(root)).toBeUndefined();
  });
});

describe('createTextResolver', () => {
  it('returns exact quoted UTF-16 spans and decoded literal values', () => {
    const source = `const emoji = '😀'; const view = <h1>{'A\\nB & C'}</h1>`;
    const result = text(source);
    expect(result).toEqual({
      start: source.indexOf("'A"),
      end: source.indexOf("'A") + "'A\\nB & C'".length,
      value: 'A\nB & C',
      origin: 'string literal',
    });
    expect(source.slice(result?.start, result?.end)).toBe("'A\\nB & C'");
  });

  it('traces const aliases to the original shared definition', () => {
    const source = `const title = 'Engineer'; const alias = title; const view = <><h1>{alias}</h1><h2>{title}</h2></>`;
    const { results } = fixture(source);
    expect(results.map((result) => result?.value)).toEqual(['Engineer', 'Engineer']);
    expect(results[0]?.start).toBe(results[1]?.start);
    expect(results[0]?.origin).toBe('const alias → const title → string literal');
  });

  it('supports the resume object and nested static array/member paths', () => {
    const source = `const resume = { name: 'Ada Lovelace', experience: [{ company: 'Analytical Engines', current: true, year: 1843, note: null }] }; function App() { return <><h1>{resume.name}</h1><p>{resume.experience[0]['company']}</p></>; }`;
    const { results } = fixture(source);
    expect(results.map((result) => result?.value)).toEqual(['Ada Lovelace', 'Analytical Engines']);
    expect(results[0]?.origin).toBe('resume.name → const resume → string literal');
    expect(results[1]?.origin).toContain('resume.experience["0"]["company"]');
    expect(source.slice(results[1]?.start, results[1]?.end)).toBe("'Analytical Engines'");
  });

  it.each([
    [`const name = 'Ada'; const data = { name }; <h1>{data.name}</h1>`, 'Ada'],
    [`const data = { ['name']: 'Ada' }; <h1>{data['name']}</h1>`, 'Ada'],
    [`const data = { 0: 'Ada' }; <h1>{data[0]}</h1>`, 'Ada'],
    [`const data = ['Ada']; const alias = data; <h1>{alias[0]}</h1>`, 'Ada'],
    [
      `const inner = { name: 'Ada' }; const data = { inner }; const alias = data.inner; <h1>{alias.name}</h1>`,
      'Ada',
    ],
    [`const data = { name: 'Ada' }; const title = data.name; <h1>{title}</h1>`, 'Ada'],
    [`<h1>{{ name: 'Ada' }.name}</h1>`, 'Ada'],
    [`<h1>{['Ada'][0]}</h1>`, 'Ada'],
    [`function App() { const title = 'Local'; return <h1>{title}</h1>; }`, 'Local'],
    [`const App = () => { const title = 'Arrow'; return <h1>{title}</h1>; };`, 'Arrow'],
    [`const title = 'Outer'; { const title = 'Block'; <h1>{title}</h1>; }`, 'Block'],
    [`const title = 'Outer'; { const title = 'Block'; } <h1>{title}</h1>`, 'Outer'],
    [
      `const data = { name: 'Ada' }; function other(data) { data.name = 'Else'; } <h1>{data.name}</h1>`,
      'Ada',
    ],
    [`const title = 'Ada'; consume(title); <h1>{title}</h1>`, 'Ada'],
    [`const data = { name: 'Ada' }; consume(data.name); <h1>{data.name}</h1>`, 'Ada'],
  ])('resolves safe static provenance: %s', (source, expected) => {
    expect(text(source)?.value).toBe(expected);
  });

  it.each([
    `let title = 'Mutable'; <h1>{title}</h1>`,
    `var title = 'Mutable'; <h1>{title}</h1>`,
    `<h1>{unknown}</h1>`,
    `import title from 'elsewhere'; <h1>{title}</h1>`,
    `const title = getTitle(); <h1>{title}</h1>`,
    `const title = 'A' + 'B'; <h1>{title}</h1>`,
    'const title = `Template`; <h1>{title}</h1>',
    `const title = 'Outer'; function App(title) { return <h1>{title}</h1>; }`,
    `const title = 'Outer'; function App({ title }) { return <h1>{title}</h1>; }`,
    `const title = 'Outer'; function App(title = 'Default') { return <h1>{title}</h1>; }`,
    `const title = 'Outer'; function App(...title) { return <h1>{title}</h1>; }`,
    `const title = 'Outer'; function App() { return <h1>{title}</h1>; var title = 'Local'; }`,
    `const title = 'Outer'; { <h1>{title}</h1>; const title = 'Later'; }`,
    `const title = 'Outer'; { let title = 'Local'; <h1>{title}</h1>; }`,
    `const title = 'Outer'; try {} catch (title) { <h1>{title}</h1>; }`,
    `const title = 'Outer'; for (let title of values) { <h1>{title}</h1>; }`,
    `const title = 'Outer'; const App = function title() { return <h1>{title}</h1>; };`,
    `const title = 'Outer'; { function title() {} <h1>{title}</h1>; }`,
    `const title = 'Outer'; { class title {} <h1>{title}</h1>; }`,
    `const title = 'Outer'; class Other { static { let title; <h1>{title}</h1>; } }`,
    `const title = 'Outer'; { const { title } = props; <h1>{title}</h1>; }`,
    `const { title } = { title: 'A' }; <h1>{title}</h1>`,
    `const title = alias; const alias = title; <h1>{title}</h1>`,
    `const title = title; <h1>{title}</h1>`,
    `const title = 'A'; title = 'B'; <h1>{title}</h1>`,
    `const title = 'A'; title++; <h1>{title}</h1>`,
    `const title = 'A'; ({ title } = other); <h1>{title}</h1>`,
    `const title = 'A'; [title] = other; <h1>{title}</h1>`,
    `const title = 'A'; for (title of values) {} <h1>{title}</h1>`,
    `const title = 'A'; eval(code); <h1>{title}</h1>`,
    `const title = 'A'; (eval as Function)(code); <h1>{title}</h1>`,
    `const title = 'A'; (title as string) = 'B'; <h1>{title}</h1>`,
    `const title = 'A'; title!++; <h1>{title}</h1>`,
    `const data = { name: 'A' }; <h1>{data[unknown]}</h1>`,
    `const key = 'name'; const data = { name: 'A' }; <h1>{data[key]}</h1>`,
    `const data = { name: 'A' }; <h1>{data?.name}</h1>`,
    `const data = { name: 'A' }; <h1>{data.missing}</h1>`,
    `const data = { name: 'A' }; <h1>{data.toString()}</h1>`,
    `const data = { get name() { return 'A'; } }; <h1>{data.name}</h1>`,
    `const data = { name: 'A', set other(value) {} }; <h1>{data.name}</h1>`,
    `const data = { name: 'A', method() {} }; <h1>{data.name}</h1>`,
    `const data = { name: 'A', ...other }; <h1>{data.name}</h1>`,
    `const data = { name: 'A', name: 'B' }; <h1>{data.name}</h1>`,
    `const data = { name: 'A', ['name']: 'B' }; <h1>{data.name}</h1>`,
    `const data = { name: 'A', [dynamic]: 'B' }; <h1>{data.name}</h1>`,
    `const data = { name: 'A', __proto__: other }; <h1>{data.name}</h1>`,
    `const data = { name: 'A', other: call() }; <h1>{data.name}</h1>`,
    `const data = { name: 'A', self: data }; <h1>{data.name}</h1>`,
    `const data = ['A', ...other]; <h1>{data[0]}</h1>`,
    `const data = ['A', , 'B']; <h1>{data[0]}</h1>`,
    `const data = ['A']; <h1>{data[-1]}</h1>`,
    `const data = ['A']; <h1>{data[1]}</h1>`,
    `const data = { name: 1 }; <h1>{data.name}</h1>`,
    `function Title({ title }) { return <h1>{title}</h1>; } <Title title="A" />`,
  ])('rejects unknown, mutable, shadowed, or dynamic provenance: %s', (source) => {
    expect(text(source)).toBeUndefined();
  });

  it.each([
    `data.name = 'B'`,
    `data.name++`,
    `(data.name as string) = 'A'`,
    `data.name! = 'A'`,
    `(data.name as string)++`,
    `for (data.name! of values) {}`,
    `({ name: data.name! } = other)`,
    `delete data.name`,
    `data['name'] = 'B'`,
    `data[dynamic] = 'B'`,
    `({ name: data.name } = other)`,
    `[data.name] = other`,
    `for (data.name of values) {}`,
    `consume(data)`,
    `new Consumer(data)`,
    `data.method()`,
    `Object.assign(data, { name: 'B' })`,
    `Object.defineProperty(data, 'name', { get: () => 'B' })`,
    `const alias = data; alias.name = 'B'`,
    `let alias = data`,
    `const { name } = data`,
    `const alias = data; consume(alias)`,
    `const wrapper = { data }; consume(wrapper)`,
    `const wrapper = [data]; wrapper[0].name = 'B'`,
    `const copied = { ...data }`,
    `const copied = [...data]`,
    `function expose() { return data; }`,
    `const expose = () => data`,
    `const view = <Other data={data} />`,
    `const view = <Other {...data} />`,
    `export { data }`,
    `export default data`,
    `data[dynamic]`,
  ])('rejects container escape/mutation across aliases: %s', (use) => {
    expect(text(`const data = { name: 'A' }; ${use}; <h1>{data.name}</h1>`)).toBeUndefined();
  });

  it('rejects mutation after the selected expression and inside closures', () => {
    expect(
      text(
        `const data = { name: 'A' }; <h1>{data.name}</h1>; function mutate() { data.name = 'B'; }`,
      ),
    ).toBeUndefined();
  });

  it.each([
    `function mutate() { data.name = 'B'; }`,
    `const mutate = () => { data.name = 'B'; };`,
    `function mutate() { const alias = data; consume(alias); }`,
    `class Mutator { run() { consume(data); } }`,
  ])('detects deferred captures even before the const declaration: %s', (prefix) => {
    expect(text(`${prefix} const data = { name: 'A' }; <h1>{data.name}</h1>`)).toBeUndefined();
  });

  it('resolves safe captured constants declared after the component function', () => {
    expect(
      text(`function App() { return <h1>{data.name}</h1>; } const data = { name: 'A' };`)?.value,
    ).toBe('A');
  });

  it.each([
    `const title = 'Outer'; class App { constructor(public title: string) { <h1>{title}</h1>; } }`,
    `const title = 'Outer'; namespace App { import title = require('unknown'); <h1>{title}</h1>; }`,
    `const title = 'Outer'; namespace App { enum title { Value } <h1>{title}</h1>; }`,
    `const title = 'Outer'; namespace App { namespace title {} <h1>{title}</h1>; }`,
  ])('does not bypass TypeScript runtime binding shadows: %s', (source) => {
    expect(text(source)).toBeUndefined();
  });

  it('rejects exported const containers but permits exported immutable strings', () => {
    expect(text(`export const data = { name: 'A' }; <h1>{data.name}</h1>`)).toBeUndefined();
    expect(text(`export const title = 'A'; <h1>{title}</h1>`)?.value).toBe('A');
  });

  it('propagates nested aliases, array mutation, and selected-field snapshots conservatively', () => {
    expect(
      text(
        `const data = { name: 'A', experience: [{ company: 'B' }] }; const alias = data.experience[0]; consume(alias); <h1>{data.name}</h1>`,
      ),
    ).toBeUndefined();
    expect(
      text(
        `const data = { name: 'A', experience: [{ company: 'B' }] }; data.experience.push(other); <h1>{data.name}</h1>`,
      ),
    ).toBeUndefined();
    expect(
      text(
        `const data = { name: 'A' }; const title = data.name; data.name = 'B'; <h1>{title}</h1>`,
      ),
    ).toBeUndefined();
  });

  it('keeps unrelated equal text and safe independent objects separate', () => {
    const { results } = fixture(
      `const good = { name: 'Same' }; const bad = { name: 'Same' }; consume(bad); <><h1>{good.name}</h1><h2>{bad.name}</h2></>`,
    );
    expect(results[0]?.value).toBe('Same');
    expect(results[1]).toBeUndefined();
  });

  it('allows readonly resume maps without exposing callback parameters as editable definitions', () => {
    const { results } = fixture(
      `const resume = { name: 'Alex', jobs: [{ title: 'Engineer', skills: ['JS', 'TS'] }, { title: 'Lead', skills: ['Design'] }] }; function App() { return <><h1>{resume.name}</h1>{resume.jobs.map((job, index) => <section key={index}><h3>{job.title}</h3>{job.skills.map(skill => <p>{skill}</p>)}</section>)}<p>{resume.jobs[1].title}</p></>; }`,
    );
    expect(results[0]?.value).toBe('Alex');
    expect(results.at(-1)?.value).toBe('Lead');
    expect(results.slice(1, -1).every((result) => result === undefined)).toBe(true);
  });

  it.each([
    `job => <h3>{job.title}</h3>`,
    `(job, index) => <h3 key={index}>{job.title.toUpperCase()}</h3>`,
    `job => { const title = job.title; return <h3>{title}</h3>; }`,
    `job => format(job.title)`,
    `job => job.skills.map(skill => <span>{skill}</span>)`,
    `function (job) { return <h3>{job.title}</h3>; }`,
    `() => <h3>Static title</h3>`,
  ])('permits verified readonly inline map callbacks: %s', (callback) => {
    expect(
      text(
        `const resume = { name: 'Alex', jobs: [{ title: 'Engineer', skills: ['JS'] }] }; resume.jobs.map(${callback}); <h1>{resume.name}</h1>`,
      )?.value,
    ).toBe('Alex');
  });

  it.each([
    `job => { job.title = 'Changed'; return null; }`,
    `job => { (job.title as string) = 'Changed'; return null; }`,
    `job => { job.title! = 'Changed'; return null; }`,
    `job => { job.title++; return null; }`,
    `job => { delete job.title; return null; }`,
    `job => { consume(job); return null; }`,
    `job => job`,
    `job => <Other job={job} />`,
    `job => <Other {...job} />`,
    `job => { const alias = job; alias.title = 'Changed'; }`,
    `job => job.skills`,
    `job => consume(job.skills)`,
    `job => job.skills.push('New')`,
    `job => job.skills.map(skill => { consume(job); return skill; })`,
    `job => job.skills.map(skill => { skill = 'Changed'; return skill; })`,
    `job => job[dynamic]`,
    `job => job.method()`,
    `job => { job = other; return null; }`,
    `(job, index) => { index++; return job.title; }`,
    `(job, index, jobs) => jobs.pop()`,
    `({ title }) => title`,
    `function (job) { arguments[0].title = 'Changed'; return job.title; }`,
    `job => this.mutate(job)`,
    `externalCallback`,
    `async job => job.title`,
  ])('rejects unverified, mutating, or escaping map callbacks: %s', (callback) => {
    expect(
      text(
        `const resume = { name: 'Alex', jobs: [{ title: 'Engineer', skills: ['JS'] }] }; resume.jobs.map(${callback}); <h1>{resume.name}</h1>`,
      ),
    ).toBeUndefined();
  });

  it.each([
    `resume.jobs.map = unknown`,
    `Array.prototype.map = unknown`,
    `[].__proto__.map = unknown`,
    `[]['__proto__'].map = unknown`,
    `[]['__' + 'proto__'].map = unknown`,
    `[].constructor.prototype.map = unknown`,
    `Reflect.getPrototypeOf([]).map = unknown`,
    `const prototype = Array.prototype; consume(prototype)`,
    `Object.defineProperty(Array.prototype, 'map', { value: unknown })`,
    `Object.setPrototypeOf(resume.jobs, other)`,
  ])('does not trust overridden array maps: %s', (mutation) => {
    expect(
      text(
        `const resume = { name: 'Alex', jobs: [{ title: 'Engineer' }] }; ${mutation}; resume.jobs.map(job => job.title); <h1>{resume.name}</h1>`,
      ),
    ).toBeUndefined();
  });

  it('does not trust custom object map methods or callback this arguments', () => {
    expect(
      text(
        `const resume = { name: 'Alex', jobs: { map: unknown } }; resume.jobs.map(job => job.title); <h1>{resume.name}</h1>`,
      ),
    ).toBeUndefined();
    expect(
      text(
        `const resume = { name: 'Alex', jobs: [{ title: 'Engineer' }] }; resume.jobs.map(job => job.title, context); <h1>{resume.name}</h1>`,
      ),
    ).toBeUndefined();
  });

  it('requires expression node identity from its own tree and handles invalid roots', () => {
    const { resolve, expressions } = fixture(`<h1>{'A'}</h1>`);
    expect(resolve({ ...expressions[0] })).toBeUndefined();
    expect(resolve(undefined)).toBeUndefined();
    expect(createTextResolver(null)(expressions[0])).toBeUndefined();
  });
});
