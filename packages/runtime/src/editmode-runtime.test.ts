import { describe, expect, it } from 'vitest';
import { bindEditmodeTokensToRuntime } from './editmode-runtime';

const tokens = 'window.__codesign_tweaks__.tokens';

describe('linear EDITMODE runtime binding', () => {
  it('binds complete blocks with marker whitespace and leaves surrounding code intact', () => {
    expect(
      bindEditmodeTokensToRuntime(
        'const defaults = /* EDITMODE-BEGIN */ {"size": 12} /*\nEDITMODE-END\t*/; use(defaults);',
      ),
    ).toBe(`const defaults = ${tokens}; use(defaults);`);
  });
  it('replaces multiple complete blocks, not marker lookalikes or other comments', () => {
    const source =
      '/* documentation */ a=/*EDITMODE-BEGIN*/{}/*EDITMODE-END*/; /*EDITMODE-BEGIN-extra*/ b=/*EDITMODE-BEGIN*/false/*EDITMODE-END*/;';
    expect(bindEditmodeTokensToRuntime(source)).toBe(
      `/* documentation */ a=${tokens}; /*EDITMODE-BEGIN-extra*/ b=${tokens};`,
    );
  });
  it.each([
    'const defaults = {};',
    '/*EDITMODE-END*/ value',
    '/*EDITMODE-BEGIN*/ {"missingEnd":true}',
    '/* EDITMODE-BEGIN',
    '/*editmode-begin*/{}/*editmode-end*/',
  ])('preserves incomplete/unrecognized input: %s', (source) => {
    expect(bindEditmodeTokensToRuntime(source)).toBe(source);
  });
  it('keeps a trailing unmatched block after binding an earlier complete block', () => {
    const tail = '/*EDITMODE-BEGIN*/{"incomplete": true}';
    expect(bindEditmodeTokensToRuntime(`/*EDITMODE-BEGIN*/{}/*EDITMODE-END*/;${tail}`)).toBe(
      `${tokens};${tail}`,
    );
  });
  it('pairs the first BEGIN with the next END even when BEGIN repeats inside', () => {
    expect(
      bindEditmodeTokensToRuntime(
        'before;/*EDITMODE-BEGIN*/ /*EDITMODE-BEGIN*/ {} /*EDITMODE-END*/after;',
      ),
    ).toBe(`before;${tokens}after;`);
  });
  it('handles many unmatched BEGIN markers without repeated suffix scans', () => {
    const input = '/*EDITMODE-BEGIN*/'.repeat(50000);
    expect(bindEditmodeTokensToRuntime(input)).toBe(input);
    expect(bindEditmodeTokensToRuntime(`${input}/*EDITMODE-END*/tail`)).toBe(`${tokens}tail`);
  }, 2000);
});
