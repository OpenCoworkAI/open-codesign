import { describe, expect, it } from 'vitest';
import { inspectTweakSource } from './tweak-source';

describe('source-backed tweak diagnostics', () => {
  it('does not infer controls from CSS variables or unmarked JavaScript defaults', () => {
    expect(inspectTweakSource(':root{--accent:#27634c;--radius:16px}').status).toBe('missing');
    expect(inspectTweakSource('const TWEAK_DEFAULTS = { accent: "#27634c" };').status).toBe(
      'missing',
    );
  });

  it('distinguishes an intentionally empty declaration from missing controls', () => {
    expect(inspectTweakSource('/*EDITMODE-BEGIN*/{}/*EDITMODE-END*/').status).toBe('empty');
  });

  it('returns exact source-backed values and widget schema', () => {
    expect(
      inspectTweakSource(
        'const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{"radius":16}/*EDITMODE-END*/;' +
          'const TWEAK_SCHEMA = /*TWEAK-SCHEMA-BEGIN*/{"radius":{"kind":"number","min":8,"max":24}}/*TWEAK-SCHEMA-END*/;',
      ),
    ).toMatchObject({
      status: 'ready',
      block: { tokens: { radius: 16 } },
      schema: { radius: { kind: 'number', min: 8, max: 24 } },
    });
  });

  it.each([
    '/*EDITMODE-BEGIN*/{"radius":16}',
    '{"radius":16}/*EDITMODE-END*/',
    '/*EDITMODE-BEGIN*/{radius:16}/*EDITMODE-END*/',
    '/*EDITMODE-BEGIN*/{"radius":{}}/*EDITMODE-END*/',
    '/*EDITMODE-BEGIN*/{"radius":16}/*EDITMODE-END*/ /*TWEAK-SCHEMA-BEGIN*/{}',
    '/*EDITMODE-BEGIN*/{"radius":16}/*EDITMODE-END*/ /*TWEAK-SCHEMA-BEGIN*/{"radius":{"kind":"unknown"}}/*TWEAK-SCHEMA-END*/',
  ])('surfaces malformed declarations without throwing: %s', (source) => {
    expect(inspectTweakSource(source)).toMatchObject({
      status: 'invalid',
      block: null,
      schema: null,
      error: expect.any(String),
    });
  });

  it.each([
    ['"wide"', '{"kind":"number","min":8,"max":24}'],
    ['32', '{"kind":"number","min":8,"max":24}'],
    ['16', '{"kind":"number","step":0}'],
    ['"compact"', '{"kind":"enum","options":["comfortable"]}'],
    ['"false"', '{"kind":"boolean"}'],
  ])('rejects controls that would display a fabricated fallback: %s, %s', (value, schema) => {
    expect(
      inspectTweakSource(
        `/*EDITMODE-BEGIN*/{"value":${value}}/*EDITMODE-END*/` +
          `/*TWEAK-SCHEMA-BEGIN*/{"value":${schema}}/*TWEAK-SCHEMA-END*/`,
      ),
    ).toMatchObject({ status: 'invalid', block: null });
  });
});
