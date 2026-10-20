import { describe, expect, it, vi } from 'vitest';
import BABEL_STANDALONE from '../vendor/babel.standalone.js?raw';
import {
  buildInteractivePreviewDocument,
  buildPreviewDocument,
  buildStandaloneDocument,
} from './index';

const babel = new Function('exports', 'module', `${BABEL_STANDALONE}\nreturn exports;`)({}, {}) as {
  transform(source: string, options: object): { code: string };
};

const builders = [
  ['preview', buildPreviewDocument],
  ['interactive', buildInteractivePreviewDocument],
  ['standalone', buildStandaloneDocument],
] as const;

describe.each(builders)('%s inline source literal safety', (_kind, build) => {
  it.each([
    '</SCRIPT>',
    '</script >',
    '</ScRiPt\t>',
    '<script data-example="value">',
    '<!-- <script> double escape state -->',
    'line\u2028separator\u2029paragraph',
    'controls\u0000\r\n\t"\\',
    'ordinary readable text',
  ])('preserves runtime values without exposing HTML delimiters: %j', (value) => {
    const source = `const value = ${JSON.stringify(value)};\nfunction App(){return <div title={value}>Normal JSX</div>}`;
    const document = build(source, { path: 'App.jsx' });
    const compileInputs = [
      ...document.matchAll(/var source = ([^\n]+);\n {2}var options = ([^\n]+);/g),
    ];
    const artifact = compileInputs.at(-1);
    if (!artifact?.[1] || !artifact[2]) throw new Error('Missing artifact compile source');
    const literal = artifact[1];
    expect(literal).not.toContain('<');
    expect(literal).not.toMatch(/<\/script[\s>]/i);
    const decoded = JSON.parse(literal) as string;
    expect(decoded.startsWith(source)).toBe(true);
    expect(new Function(`return ${literal};`)()).toBe(decoded);

    const initial = /window\.__codesign_tweaks__\.applyInitial\(([\s\S]*?)\);\}<\/script>/.exec(
      document,
    )?.[1];
    expect(initial).toBeDefined();
    expect(initial).not.toContain('<');
    expect(JSON.parse(initial ?? '')).toBe(decoded);

    const compiled = babel.transform(decoded, JSON.parse(artifact[2]) as object);
    const render = vi.fn();
    new Function('React', 'ReactDOM', 'document', compiled.code)(
      {
        createElement: (
          type: string | (() => unknown),
          props: object,
          ...children: unknown[]
        ): unknown => (typeof type === 'function' ? type() : { type, props, children }),
      },
      { createRoot: () => ({ render }) },
      { getElementById: () => ({}) },
    );
    expect(render).toHaveBeenCalledExactlyOnceWith({
      type: 'div',
      props: { title: value },
      children: ['Normal JSX'],
    });
  });
});
