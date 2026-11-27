import { describe, expect, it } from 'vitest';
import BABEL_STANDALONE from '../vendor/babel.standalone.js?raw';
import {
  buildInteractivePreviewDocument,
  buildPreviewDocument,
  buildStandaloneDocument,
} from './index';
import {
  instrumentSourceForEditing,
  isSourceEditSelection,
  MAX_SOURCE_EDIT_TARGETS,
  SOURCE_EDIT_ATTRIBUTE,
  SOURCE_EDIT_ITEM_INDEX_ATTRIBUTE,
  type SourceEditPreviewOptions,
} from './source-edit-instrumentation';

const sourceHash = 'a'.repeat(64);
function planFor(source: string, tags: string[]): SourceEditPreviewOptions {
  return {
    source,
    sourceHash,
    previewRevision: 'preview-1',
    targets: tags.map((tagName) => {
      const start = source.indexOf(`<${tagName}`);
      const closing = source.indexOf(`</${tagName}>`, start);
      const end = closing < 0 ? source.indexOf('/>', start) + 2 : closing + tagName.length + 3;
      const openingEnd = source.indexOf('>', start);
      const insertionOffset = source[openingEnd - 1] === '/' ? openingEnd - 1 : openingEnd;
      return { id: `${start}:${end}`, tagName, start, end, insertionOffset };
    }),
  };
}

function artifactCompileInput(document: string): {
  source: string;
  options: object;
  offset: number;
} {
  const matches = [...document.matchAll(/var source = (.+);\n {2}var options = (.+);/g)];
  const artifact = matches.at(-1);
  if (!artifact?.[1] || !artifact[2]) throw new Error('Missing artifact compile input');
  return {
    source: JSON.parse(artifact[1]) as string,
    options: JSON.parse(artifact[2]) as object,
    offset: artifact.index,
  };
}

const babel = new Function('exports', 'module', `${BABEL_STANDALONE}\nreturn exports;`)({}, {}) as {
  transform(source: string, options: object): { code: string };
};

describe('source edit preview instrumentation', () => {
  it('inserts all host markers in reverse offset order without changing original source', () => {
    const source =
      'function App(){return <main><button title="Save">Save</button><input /></main>}';
    const plan = planFor(source, ['main', 'button', 'input']);
    const result = instrumentSourceForEditing(source, plan);
    for (const target of plan.targets) {
      expect(result.source).toContain(
        `${SOURCE_EDIT_ATTRIBUTE}="${plan.previewRevision}:${target.id}"`,
      );
      expect(result.context.targets[target.id]).toBe(target.tagName);
    }
    expect(plan.source).toBe(source);
    expect(result.source.replace(/ data-codesign-source-id="[A-Za-z0-9_-]+:\d+:\d+"/g, '')).toBe(
      source,
    );
  });

  it('carries field plans for mixed text without adding DOM wrappers or rewriting expressions', () => {
    const source = 'function App(){const count=2;return <button>Cart ({count})</button>}';
    const plan = planFor(source, ['button']);
    const target = plan.targets[0];
    if (!target) throw new Error('Missing target');
    target.textLayout = [
      { kind: 'text', textId: '1:2', value: 'Cart (' },
      { kind: 'dynamic' },
      { kind: 'text', textId: '3:4', value: ')' },
    ];
    target.editableFields = [
      { kind: 'set-text', textId: '1:2', value: 'Cart (' },
      { kind: 'set-text', textId: '3:4', value: ')' },
    ];
    const instrumented = instrumentSourceForEditing(source, plan);
    expect(instrumented.context.fieldPlans?.[target.id]).toEqual({
      textLayout: target.textLayout,
      editableFields: target.editableFields,
    });
    expect(
      instrumented.source.replace(/ data-codesign-source-id="[A-Za-z0-9_-]+:\d+:\d+"/g, ''),
    ).toBe(source);
    expect(instrumented.source).not.toContain('<span');
    const document = buildInteractivePreviewDocument(source, { path: 'App.jsx', sourceEdit: plan });
    const compiled = artifactCompileInput(document);
    expect(() => babel.transform(compiled.source, compiled.options)).not.toThrow();
    // Check generator-owned markers, not HTML tag syntax: the observer must precede user code.
    const observerIndex = document.indexOf('textObserver.observe(document.documentElement');
    expect(observerIndex).toBeGreaterThanOrEqual(0);
    expect(compiled.source).toContain('Cart (');
    expect(compiled.offset).toBeGreaterThan(observerIndex);
  });

  it('honors inspected offsets through greater-than text and nested JSX attributes', () => {
    const source =
      'function App(){return <div title="a > b" data-label={<span>Label</span>}>Body</div>}';
    const divStart = source.indexOf('<div');
    const spanStart = source.indexOf('<span');
    const divEnd = source.indexOf('</div>') + 6;
    const spanEnd = source.indexOf('</span>') + 7;
    const plan: SourceEditPreviewOptions = {
      source,
      sourceHash,
      previewRevision: 'preview-nested',
      targets: [
        {
          id: `${divStart}:${divEnd}`,
          tagName: 'div',
          start: divStart,
          end: divEnd,
          insertionOffset: source.indexOf('}>Body') + 1,
        },
        {
          id: `${spanStart}:${spanEnd}`,
          tagName: 'span',
          start: spanStart,
          end: spanEnd,
          insertionOffset: source.indexOf('>Label'),
        },
      ],
    };
    const input = artifactCompileInput(
      buildInteractivePreviewDocument(source, { path: 'App.jsx', sourceEdit: plan }),
    );
    expect(input.source).toContain('title="a > b"');
    expect(() => babel.transform(input.source, input.options)).not.toThrow();
    expect(input.source.match(/data-codesign-source-id=/g)).toHaveLength(2);
  });
  it('uses exact UTF-16 source offsets before EDITMODE replacement and auto-mount', () => {
    const makeSource = (heading: string) =>
      `// 😀\nconst TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{"heading":"${heading}"}/*EDITMODE-END*/;\nfunction App(){return <button title="Save">Save</button>}`;
    const original = makeSource('short');
    const revised = makeSource('a substantially longer token value');
    const oldPlan = planFor(original, ['button']);
    expect(() =>
      buildInteractivePreviewDocument(revised, { path: 'App.jsx', sourceEdit: oldPlan }),
    ).toThrow('exact inspected source');
    const nextPlan = {
      ...planFor(revised, ['button']),
      sourceHash: 'b'.repeat(64),
      previewRevision: 'preview-2',
    };
    const compiledInput = artifactCompileInput(
      buildInteractivePreviewDocument(revised, { path: 'App.jsx', sourceEdit: nextPlan }),
    );
    expect(compiledInput.source).toContain('window.__codesign_tweaks__.tokens');
    expect(compiledInput.source).toContain(
      `${SOURCE_EDIT_ATTRIBUTE}="${nextPlan.previewRevision}:${nextPlan.targets[0]?.id}"`,
    );
    expect(compiledInput.source).not.toContain(
      `${SOURCE_EDIT_ATTRIBUTE}="${oldPlan.previewRevision}:${oldPlan.targets[0]?.id}"`,
    );
    expect(compiledInput.source).toContain('render(<App />)');
    expect(() => babel.transform(compiledInput.source, compiledInput.options)).not.toThrow();
  });

  it.each([
    'App.jsx',
    'App.tsx',
  ])('preserves escaped attributes and self-closing JSX in %s', (path) => {
    const source = `${path.endsWith('.tsx') ? 'const count: number = 1;\n' : ''}function App(){return <input title="A &quot;quote&quot; &amp; B" placeholder={'a\\'b'} />}`;
    const plan = planFor(source, ['input']);
    const input = artifactCompileInput(
      buildInteractivePreviewDocument(source, { path, sourceEdit: plan }),
    );
    expect(input.source).toContain('title="A &quot;quote&quot; &amp; B"');
    const result = babel.transform(input.source, input.options);
    expect(result.code).toContain(`"${SOURCE_EDIT_ATTRIBUTE}"`);
  });

  it('does not instrument ordinary preview or standalone export paths', () => {
    const source = 'function App(){return <button>Save</button>}';
    const options = { path: 'App.jsx', sourceEdit: planFor(source, ['button']) };
    const interactive = artifactCompileInput(buildInteractivePreviewDocument(source, options));
    expect(interactive.source).toContain(SOURCE_EDIT_ATTRIBUTE);
    for (const build of [buildPreviewDocument, buildStandaloneDocument]) {
      expect(artifactCompileInput(build(source, options)).source).toBe(
        artifactCompileInput(build(source, { path: 'App.jsx' })).source,
      );
      expect(artifactCompileInput(build(source, options)).source).not.toContain(
        SOURCE_EDIT_ATTRIBUTE,
      );
    }
    expect(buildStandaloneDocument(source, options)).not.toContain('sourceEditContext');
  });

  it.each([
    '<html><body><button>Save</button></body></html>',
    '<!doctype html><script type="text/babel">function App(){return <button />}</script>',
  ])('rejects HTML and mixed HTML rather than guessing JSX source', (source) => {
    expect(() =>
      buildInteractivePreviewDocument(source, {
        path: 'App.jsx',
        sourceEdit: planFor(source, ['button']),
      }),
    ).toThrow('original JSX or TSX');
  });

  it.each([
    undefined,
    'index.html',
    'App.js',
  ])('requires an explicit JSX/TSX file path, not %s', (path) => {
    const source = 'function App(){return <button>Save</button>}';
    expect(() =>
      buildInteractivePreviewDocument(source, { path, sourceEdit: planFor(source, ['button']) }),
    ).toThrow('original JSX or TSX');
  });
  it.each([
    `function App(){return <header>${SOURCE_EDIT_ATTRIBUTE}</header>}`,
    `// ${SOURCE_EDIT_ATTRIBUTE}\nfunction App(){return <header>Title</header>}`,
    `function App(){return <header>{/* ${SOURCE_EDIT_ATTRIBUTE} */}Title</header>}`,
    `function App(){return <header title="${SOURCE_EDIT_ATTRIBUTE}">Title</header>}`,
    `function App(){return <header title={'${SOURCE_EDIT_ATTRIBUTE}'}>Title</header>}`,
  ])('allows the reserved spelling as ordinary source content: %s', (source) => {
    const plan = planFor(source, ['header']);
    const preview = buildInteractivePreviewDocument(source, { path: 'App.jsx', sourceEdit: plan });
    const input = artifactCompileInput(preview);
    expect(() => babel.transform(input.source, input.options)).not.toThrow();
    expect(input.source).toContain(
      `${SOURCE_EDIT_ATTRIBUTE}="${plan.previewRevision}:${plan.targets[0]?.id}"`,
    );
    expect(
      instrumentSourceForEditing(source, plan).source.replace(
        / data-codesign-source-id="[A-Za-z0-9_-]+:\d+:\d+"/g,
        '',
      ),
    ).toBe(source);
  });

  it.each([
    `function App(){return <button ${SOURCE_EDIT_ATTRIBUTE}="author-value">Save</button>}`,
    `function App(){return <button {...{ '${SOURCE_EDIT_ATTRIBUTE}': 'author-value' }}>Save</button>}`,
  ])('never lets authored attributes or spreads replace the injected marker: %s', (source) => {
    // Main rejects these declarations for editing. Even a caller bypassing that
    // prerequisite must not promote the author's attribute value to a source hint.
    const plan = planFor(source, ['button']);
    const instrumented = instrumentSourceForEditing(source, plan);
    const compiled = babel.transform(instrumented.source, { presets: ['react'] });
    const props = new Function('React', `${compiled.code}\nreturn App();`)({
      createElement: (_tag: string, attributes: Record<string, unknown>) => attributes,
    }) as Record<string, unknown>;
    expect(props[SOURCE_EDIT_ATTRIBUTE]).toBe(`${plan.previewRevision}:${plan.targets[0]?.id}`);
    expect(props[SOURCE_EDIT_ATTRIBUTE]).not.toBe('author-value');
    expect(Object.keys(instrumented.context.targets)).toEqual(
      plan.targets.map((target) => target.id),
    );
  });
  it('rejects already-wrapped source', () => {
    const wrapped = buildInteractivePreviewDocument('function App(){return <button/>}', {
      path: 'App.jsx',
    });
    expect(() =>
      buildInteractivePreviewDocument(wrapped, {
        path: 'App.jsx',
        sourceEdit: planFor(wrapped, ['button']),
      }),
    ).toThrow('original JSX or TSX');
  });

  it('rejects malformed, duplicate, out-of-bounds and excessive target plans', () => {
    const source = 'function App(){return <button>Save</button>}';
    const plan = planFor(source, ['button']);
    const target = plan.targets[0];
    if (!target) throw new Error('Missing fixture target');
    const invalidTargets = [
      [{ ...target, insertionOffset: target.insertionOffset + 1 }],
      [{ ...target, insertionOffset: Number.NaN }],
      [{ ...target, end: source.length + 1 }],
      [{ ...target, start: -1 }],
      [{ ...target, id: '1:2' }],
      [{ ...target, tagName: 'Button' }],
      [{ ...target, tagName: 'script><img' }],
      [target, target],
      Array.from({ length: MAX_SOURCE_EDIT_TARGETS + 1 }, () => target),
    ];
    for (const targets of invalidTargets) {
      expect(() => instrumentSourceForEditing(source, { ...plan, targets })).toThrow(
        'Invalid source edit target plan',
      );
    }
    expect(() => instrumentSourceForEditing(source, { ...plan, sourceHash: 'bad' })).toThrow(
      'revision',
    );
    expect(() =>
      instrumentSourceForEditing(source, { ...plan, previewRevision: '</script>' }),
    ).toThrow('revision');
  });
});

describe('source edit selection shape', () => {
  const valid = { sourceHash, previewRevision: 'preview-1', targetId: '10:50' };
  it('accepts only bounded revision-bearing selection hints', () => {
    expect(isSourceEditSelection(valid)).toBe(true);
    for (const value of [
      null,
      {},
      { ...valid, path: 'App.jsx' },
      { ...valid, start: 10 },
      { ...valid, targetId: 'x' },
      { ...valid, sourceHash: 'f'.repeat(65) },
      { ...valid, previewRevision: 'x'.repeat(129) },
    ]) {
      expect(isSourceEditSelection(value)).toBe(false);
    }
  });

  it('accepts expanded field keys (all styles, attributes, className, visibility, map-text, structure)', () => {
    expect(
      isSourceEditSelection({
        ...valid,
        fieldStates: [
          { key: 'text:only', status: 'ready' },
          { key: 'attribute:aria-label', status: 'ready' },
          { key: 'attribute:href', status: 'ready' },
          { key: 'attribute:src', status: 'ready' },
          { key: 'style:fontFamily', status: 'ready' },
          { key: 'style:gridTemplateColumns', status: 'ready' },
          { key: 'style:objectFit', status: 'ready' },
          { key: 'className', status: 'ready' },
          { key: 'visibility', status: 'ready' },
          { key: 'map-text:0:title', status: 'ready' },
          { key: 'structure:reorder:0', status: 'ready' },
          { key: 'structure:duplicate', status: 'ready' },
          { key: 'structure:delete:2', status: 'ready' },
        ],
      }),
    ).toBe(true);
    for (const badKey of [
      'style:position',
      'attribute:onclick',
      'map-text:1001:title',
      'structure:delete:1001',
      'unknown:key',
    ]) {
      expect(
        isSourceEditSelection({
          ...valid,
          fieldStates: [{ key: badKey, status: 'ready' }],
        }),
      ).toBe(false);
    }
  });
});

describe('map item bindings and HTML instrumentation', () => {
  it('instruments .map() callbacks with parens wrapping and groups edits at rootInsertionOffset', () => {
    const source =
      'function App(){const items=[{name:"A"},{name:"B"}];return <ul>{items.map(item => <li>{item.name}</li>)}</ul>}';
    const liStart = source.indexOf('<li');
    const liEnd = source.indexOf('</li>') + 5;
    const liInsert = source.indexOf('>{item.name}');
    const paramsStart = source.indexOf('item =>');
    const paramsEnd = paramsStart + 'item'.length;
    const plan: SourceEditPreviewOptions = {
      source,
      sourceHash,
      previewRevision: 'preview-map',
      targets: [
        {
          id: `${liStart}:${liEnd}`,
          tagName: 'li',
          start: liStart,
          end: liEnd,
          insertionOffset: liInsert,
          mapSource: {
            arrayName: 'items',
            itemCount: 2,
            fields: [{ key: 'name', values: ['A', 'B'] }],
          },
        },
      ],
      mapItemBindings: [
        {
          targetId: `${liStart}:${liEnd}`,
          paramsStart,
          paramsEnd,
          wrapParens: true,
          rootInsertionOffset: liInsert,
        },
      ],
    };
    const result = instrumentSourceForEditing(source, plan);
    expect(result.source).toContain('items.map((item, __csIdx) =>');
    expect(result.source).toContain(
      ` ${SOURCE_EDIT_ATTRIBUTE}="preview-map:${liStart}:${liEnd}" ${SOURCE_EDIT_ITEM_INDEX_ATTRIBUTE}={__csIdx}>`,
    );
    expect(result.context.mapSources?.[`${liStart}:${liEnd}`]).toEqual({
      arrayName: 'items',
      itemCount: 2,
      fields: [{ key: 'name', values: ['A', 'B'] }],
    });
    const compiled = babel.transform(result.source, { presets: ['react'] });
    const rendered = new Function('React', `${compiled.code}\nreturn App();`)({
      createElement: (type: string, props: Record<string, unknown>, ...children: unknown[]) => ({
        type,
        props,
        children,
      }),
    }) as { children: Array<Array<{ props: Record<string, unknown> }>> };
    expect(rendered.children[0]?.map((el) => el.props[SOURCE_EDIT_ITEM_INDEX_ATTRIBUTE])).toEqual([
      0, 1,
    ]);
  });

  it('supports parenthesized params and existingIndexName in mapItemBindings', () => {
    const source =
      'function App(){return <ul>{a.map((x) => <li/>)}{b.map((y, idx) => <span/>)}</ul>}';
    const liInsert = source.indexOf('/>');
    const spanInsert = source.indexOf('/>', liInsert + 2);
    const xStart = source.indexOf('(x') + 1;
    const xEnd = xStart + 1;
    const yStart = source.indexOf('(y') + 1;
    const yEnd = yStart + 'y, idx'.length;
    const result = instrumentSourceForEditing(source, {
      source,
      sourceHash,
      previewRevision: 'preview-map2',
      targets: [],
      mapItemBindings: [
        {
          targetId: '1:2',
          paramsStart: xStart,
          paramsEnd: xEnd,
          wrapParens: false,
          rootInsertionOffset: liInsert,
        },
        {
          targetId: '3:4',
          paramsStart: yStart,
          paramsEnd: yEnd,
          wrapParens: false,
          existingIndexName: 'idx',
          rootInsertionOffset: spanInsert,
        },
      ],
    });
    expect(result.source).toContain(
      'a.map((x, __csIdx) => <li data-codesign-item-index={__csIdx}/>)',
    );
    expect(result.source).toContain('b.map((y, idx) => <span data-codesign-item-index={idx}/>)');
    expect(() => babel.transform(result.source, { presets: ['react'] })).not.toThrow();
  });

  it('rejects malformed or unsafe mapItemBindings and rejects mapItemBindings in HTML mode', () => {
    const source = 'function App(){return <ul>{a.map(x => <li>{x}</li>)}</ul>}';
    const liInsert = source.indexOf('>{x}');
    const base: SourceEditPreviewOptions = {
      source,
      sourceHash,
      previewRevision: 'preview-bad',
      targets: [],
    };
    expect(() =>
      instrumentSourceForEditing(source, {
        ...base,
        mapItemBindings: [
          {
            targetId: '1:2',
            paramsStart: 36,
            paramsEnd: 35,
            wrapParens: true,
            rootInsertionOffset: liInsert,
          },
        ],
      }),
    ).toThrow('Invalid source edit target plan');
    expect(() =>
      instrumentSourceForEditing(source, {
        ...base,
        mapItemBindings: [
          {
            targetId: '1:2',
            paramsStart: 35,
            paramsEnd: 36,
            wrapParens: true,
            existingIndexName: 'i} onClick={evil',
            rootInsertionOffset: liInsert,
          },
        ],
      }),
    ).toThrow('Invalid source edit target plan');
    expect(() =>
      instrumentSourceForEditing(
        source,
        {
          ...base,
          mapItemBindings: [
            {
              targetId: '1:2',
              paramsStart: 35,
              paramsEnd: 36,
              wrapParens: true,
              rootInsertionOffset: liInsert,
            },
          ],
        },
        { html: true },
      ),
    ).toThrow('Invalid source edit target plan');
  });

  it('instruments pure HTML documents and injects sourceEditContext without Babel compilation', () => {
    const html =
      '<!doctype html><html><body><DIV class="card"><button>Save</button><img src="a.png"></DIV></body></html>';
    const divStart = html.indexOf('<DIV');
    const divEnd = html.indexOf('</DIV>') + 6;
    const btnStart = html.indexOf('<button');
    const btnEnd = html.indexOf('</button>') + 9;
    const imgStart = html.indexOf('<img');
    const imgEnd = html.indexOf('>', imgStart) + 1;
    const plan: SourceEditPreviewOptions = {
      source: html,
      sourceHash,
      previewRevision: 'preview-html',
      targets: [
        {
          id: `${divStart}:${divEnd}`,
          tagName: 'div',
          start: divStart,
          end: divEnd,
          insertionOffset: html.indexOf('><button'),
        },
        {
          id: `${btnStart}:${btnEnd}`,
          tagName: 'button',
          start: btnStart,
          end: btnEnd,
          insertionOffset: html.indexOf('>Save'),
        },
        {
          id: `${imgStart}:${imgEnd}`,
          tagName: 'img',
          start: imgStart,
          end: imgEnd,
          insertionOffset: imgEnd - 1,
        },
      ],
    };
    const doc = buildInteractivePreviewDocument(html, { path: 'index.html', sourceEdit: plan });
    expect(doc).not.toContain('AGENT_BODY_BEGIN');
    expect(doc).not.toContain('window.Babel.transform');
    expect(doc).toContain(`${SOURCE_EDIT_ATTRIBUTE}="preview-html:${btnStart}:${btnEnd}"`);
    expect(doc).toContain(`${SOURCE_EDIT_ATTRIBUTE}="preview-html:${imgStart}:${imgEnd}"`);
    expect(doc).toContain('"previewRevision":"preview-html"');
  });
});
