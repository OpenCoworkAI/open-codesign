import { describe, expect, it } from 'vitest';
import { buildPreviewDocument, buildStandaloneDocument } from './index';

const BEGIN = '/*EDITMODE-BEGIN*/';
const END = '/*EDITMODE-END*/';
const TOKENS = 'window.__codesign_tweaks__.tokens';

function compiledSource(source: string, standalone = false): string {
  const document = (standalone ? buildStandaloneDocument : buildPreviewDocument)(source, {
    path: 'fixture.jsx',
  });
  const artifactStart = standalone
    ? document.lastIndexOf('var source = ')
    : document.indexOf('var source = ', document.indexOf('<!-- AGENT_BODY_BEGIN -->'));
  const start = artifactStart + 'var source = '.length;
  const end = document.indexOf(';\n  var options = ', start);
  if (artifactStart < 0 || end < start) throw new Error('Missing artifact source literal');
  return JSON.parse(document.slice(start, end)) as string;
}

function legacySmallInput(source: string): string {
  if (source.length > 8192) throw new Error('Legacy regexp is only a bounded small-input oracle');
  return source.replace(/\/\*\s*EDITMODE-BEGIN\s*\*\/[\s\S]*?\/\*\s*EDITMODE-END\s*\*\//g, TOKENS);
}

describe('linear EDITMODE binding', () => {
  it.each([
    ['', ''],
    ['plain source', 'plain source'],
    [`before${BEGIN}{"a":1}${END}after`, `before${TOKENS}after`],
    [`${BEGIN}one${END}/${BEGIN}two${END}`, `${TOKENS}/${TOKENS}`],
    [`${BEGIN}outer${BEGIN}nested${END}tail${END}`, `${TOKENS}tail${END}`],
    [`${END}before${BEGIN}unclosed`, `${END}before${BEGIN}unclosed`],
    [`${BEGIN}unclosed${BEGIN}still unclosed`, `${BEGIN}unclosed${BEGIN}still unclosed`],
    [`${BEGIN}ok${END}tail${BEGIN}unclosed`, `${TOKENS}tail${BEGIN}unclosed`],
    [`${BEGIN}${END}`, TOKENS],
    ['/*EDITMODE-BEGIN*//*EDITMODE-END*/', TOKENS],
    ['/*EDITMODE-BEGIN*/*EDITMODE-END*/', '/*EDITMODE-BEGIN*/*EDITMODE-END*/'],
    [`${BEGIN}nested/*EDITMODE-BEGIN*/*EDITMODE-END*/`, TOKENS],
    ['/*EDITMODE-END*/*EDITMODE-BEGIN*/body/*EDITMODE-END*/', `/*EDITMODE-END*${TOKENS}`],
    [
      `${BEGIN}body/*EDITMODE-END*/*EDITMODE-BEGIN*/tail${END}`,
      `${TOKENS}*EDITMODE-BEGIN*/tail${END}`,
    ],
    ['/* EDITMODE-BEGIN \t*/value/*\nEDITMODE-END\r */', TOKENS],
    ['/*editmode-BEGIN*/x/*EDITMODE-END*/', '/*editmode-BEGIN*/x/*EDITMODE-END*/'],
    [`const text = "${BEGIN}raw string content${END}";`, `const text = "${TOKENS}";`],
  ])('preserves raw first-BEGIN/first-END semantics for %j', (source, expected) => {
    expect(legacySmallInput(source)).toBe(expected);
    expect(compiledSource(source)).toBe(expected);
  });

  it('agrees with the old regexp on deterministic bounded mixed input', () => {
    const fragments = [
      BEGIN,
      END,
      'body',
      '/',
      '*',
      '/*',
      '*/',
      '\n',
      '/*\tEDITMODE-BEGIN\u00a0*/',
      '/*\uFEFFEDITMODE-END\r\n*/',
      '/*EDITMODE-BEGINx*/',
      '/*EDITMODE-END',
      '"',
    ];
    let seed = 0x12345678;
    for (let sample = 0; sample < 96; sample++) {
      const pieces: string[] = [];
      for (let part = 0; part < 12; part++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        pieces.push(fragments[seed % fragments.length] ?? '');
      }
      const source = pieces.join('');
      expect(compiledSource(source), `sample ${sample}`).toBe(legacySmallInput(source));
    }
  });

  it('retains 50,000 repeated BEGIN markers when no END exists', () => {
    // Do not run the old cross-body regexp here: this is its quadratic worst case.
    const source = `${BEGIN}body`.repeat(50_000);
    expect(compiledSource(source)).toBe(source);
  });

  it('retains an adversarial unmatched suffix after a valid block', () => {
    const suffix = `${BEGIN}body`.repeat(50_000);
    expect(compiledSource(`before${BEGIN}ok${END}${suffix}`)).toBe(`before${TOKENS}${suffix}`);
  });

  it('scans long allowed whitespace without changing token rules', () => {
    const whitespace = ' \t\r\n\u00a0\uFEFF'.repeat(10_000);
    const begin = `/*${whitespace}EDITMODE-BEGIN${whitespace}*/`;
    const end = `/*${whitespace}EDITMODE-END${whitespace}*/`;
    expect(compiledSource(`before${begin}body${end}after`)).toBe(`before${TOKENS}after`);
    expect(compiledSource(`${begin}body`)).toBe(`${begin}body`);
  });

  it('replaces many blocks without accumulating growing string prefixes', () => {
    const source = `${BEGIN}body${END}|`.repeat(10_000);
    expect(compiledSource(source)).toBe(`${TOKENS}|`.repeat(10_000));
  });

  it('leaves standalone export source untouched and scanner state isolated across builds', () => {
    const source = `const TWEAK_DEFAULTS = ${BEGIN}{"gap":12}${END};`;
    expect(compiledSource(source)).toBe(`const TWEAK_DEFAULTS = ${TOKENS};`);
    expect(compiledSource(source, true)).toBe(source);
    expect(compiledSource(`${BEGIN}unmatched`)).toBe(`${BEGIN}unmatched`);
    expect(compiledSource(source)).toBe(`const TWEAK_DEFAULTS = ${TOKENS};`);
  });
});
