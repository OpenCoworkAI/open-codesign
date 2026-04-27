import { describe, expect, it } from 'vitest';
import {
  ensureEditmodeMarkers,
  parseEditmodeBlock,
  parseTweakSchema,
  replaceEditmodeBlock,
  replaceTweakSchema,
} from './editmode';

describe('parseEditmodeBlock', () => {
  it('extracts a JSON object between markers', () => {
    const src = `const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{"accent":"#CC785C","weight":500}/*EDITMODE-END*/;`;
    expect(parseEditmodeBlock(src)).toEqual({
      tokens: { accent: '#CC785C', weight: 500 },
      raw: '{"accent":"#CC785C","weight":500}',
      source: 'marked',
    });
  });

  it('handles whitespace and multiline JSON', () => {
    const src = `/*EDITMODE-BEGIN*/\n{\n  "a": true,\n  "b": [1,2]\n}\n/*EDITMODE-END*/`;
    const out = parseEditmodeBlock(src);
    expect(out?.tokens).toEqual({ a: true, b: [1, 2] });
  });

  it('returns null when no marker present', () => {
    expect(parseEditmodeBlock('const x = 1;')).toBeNull();
  });

  it('throws on invalid JSON inside a marked block', () => {
    expect(() => parseEditmodeBlock('/*EDITMODE-BEGIN*/{"a":}/*EDITMODE-END*/')).toThrow(
      /EDITMODE block contains invalid JSON/,
    );
  });

  it('throws when marked inner JSON is not an object', () => {
    expect(() => parseEditmodeBlock('/*EDITMODE-BEGIN*/[1,2,3]/*EDITMODE-END*/')).toThrow(
      /EDITMODE block must contain a JSON object/,
    );
  });

  it('treats empty inner as empty tokens', () => {
    expect(parseEditmodeBlock('/*EDITMODE-BEGIN*//*EDITMODE-END*/')).toEqual({
      tokens: {},
      raw: '',
      source: 'marked',
    });
  });

  it('does not infer bare const TWEAK_DEFAULTS when markers are absent', () => {
    const src = `const TWEAK_DEFAULTS = {"accent":"#CC785C","weight":500};`;
    expect(parseEditmodeBlock(src)).toBeNull();
  });
});

describe('ensureEditmodeMarkers', () => {
  it('returns source unchanged when markers already present', () => {
    const src = `/*EDITMODE-BEGIN*/{"a":1}/*EDITMODE-END*/`;
    expect(ensureEditmodeMarkers(src)).toBe(src);
  });

  it('does not repair a bare const TWEAK_DEFAULTS literal', () => {
    const src = `const TWEAK_DEFAULTS = {"a":1};`;
    expect(ensureEditmodeMarkers(src)).toBe(src);
  });

  it('returns source unchanged when no TWEAK_DEFAULTS to wrap', () => {
    expect(ensureEditmodeMarkers('const x = 1;')).toBe('const x = 1;');
  });
});

describe('replaceEditmodeBlock', () => {
  it('replaces inner JSON with new tokens', () => {
    const src = `const T = /*EDITMODE-BEGIN*/{"a":1}/*EDITMODE-END*/;`;
    const out = replaceEditmodeBlock(src, { a: 2, b: 'x' });
    const reparsed = parseEditmodeBlock(out);
    expect(reparsed?.tokens).toEqual({ a: 2, b: 'x' });
  });

  it('returns source untouched when no marker', () => {
    const src = 'no markers here';
    expect(replaceEditmodeBlock(src, { x: 1 })).toBe(src);
  });

  it('round-trips parse → replace → parse', () => {
    const src = `/*EDITMODE-BEGIN*/{"a":1}/*EDITMODE-END*/`;
    const parsed = parseEditmodeBlock(src);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    const next = { ...parsed.tokens, b: true };
    const out = replaceEditmodeBlock(src, next);
    expect(parseEditmodeBlock(out)?.tokens).toEqual({ a: 1, b: true });
  });
});

describe('parseTweakSchema', () => {
  it('parses each kind of entry', () => {
    const src = `const TWEAK_SCHEMA = /*TWEAK-SCHEMA-BEGIN*/{
      "accentColor": { "kind": "color" },
      "radius": { "kind": "number", "min": 0, "max": 32, "step": 2, "unit": "px" },
      "density": { "kind": "enum", "options": ["compact", "comfortable"] },
      "showFooter": { "kind": "boolean" },
      "caption": { "kind": "string", "placeholder": "Footer line" }
    }/*TWEAK-SCHEMA-END*/;`;
    expect(parseTweakSchema(src)).toEqual({
      accentColor: { kind: 'color' },
      radius: { kind: 'number', min: 0, max: 32, step: 2, unit: 'px' },
      density: { kind: 'enum', options: ['compact', 'comfortable'] },
      showFooter: { kind: 'boolean' },
      caption: { kind: 'string', placeholder: 'Footer line' },
    });
  });

  it('returns null when no marker block is present', () => {
    expect(parseTweakSchema('const x = 1;')).toBeNull();
  });

  it('returns empty schema for empty inner', () => {
    expect(parseTweakSchema('/*TWEAK-SCHEMA-BEGIN*//*TWEAK-SCHEMA-END*/')).toEqual({});
  });

  it('throws on invalid JSON', () => {
    expect(() => parseTweakSchema('/*TWEAK-SCHEMA-BEGIN*/{not json}/*TWEAK-SCHEMA-END*/')).toThrow(
      /TWEAK_SCHEMA block contains invalid JSON/,
    );
  });

  it('throws for entries without a recognized kind', () => {
    const src = `/*TWEAK-SCHEMA-BEGIN*/{
      "good": { "kind": "color" },
      "missing": { "label": "no kind" },
      "unknown": { "kind": "rainbow" }
    }/*TWEAK-SCHEMA-END*/`;
    expect(() => parseTweakSchema(src)).toThrow(/TWEAK_SCHEMA entry "missing" is invalid/);
  });

  it('throws for enum without options', () => {
    const src = `/*TWEAK-SCHEMA-BEGIN*/{ "x": { "kind": "enum" } }/*TWEAK-SCHEMA-END*/`;
    expect(() => parseTweakSchema(src)).toThrow(/TWEAK_SCHEMA entry "x" is invalid/);
  });

  it('throws for enum with empty options array', () => {
    const src = `/*TWEAK-SCHEMA-BEGIN*/{ "x": { "kind": "enum", "options": [] } }/*TWEAK-SCHEMA-END*/`;
    expect(() => parseTweakSchema(src)).toThrow(/TWEAK_SCHEMA entry "x" is invalid/);
  });

  it('throws for enum with non-string options', () => {
    const src = `/*TWEAK-SCHEMA-BEGIN*/{ "x": { "kind": "enum", "options": ["a", 1] } }/*TWEAK-SCHEMA-END*/`;
    expect(() => parseTweakSchema(src)).toThrow(/TWEAK_SCHEMA entry "x" is invalid/);
  });

  it('throws when optional schema fields have the wrong type', () => {
    const src = `/*TWEAK-SCHEMA-BEGIN*/{
      "radius": { "kind": "number", "min": "0" },
      "label": { "kind": "string", "placeholder": 42 }
    }/*TWEAK-SCHEMA-END*/`;
    expect(() => parseTweakSchema(src)).toThrow(/TWEAK_SCHEMA entry "radius" is invalid/);
  });
});

describe('replaceTweakSchema', () => {
  it('inserts after a marked TWEAK_DEFAULTS block when no schema yet', () => {
    const src = `const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{"a":1}/*EDITMODE-END*/;\nfunction App(){}`;
    const out = replaceTweakSchema(src, { a: { kind: 'number', min: 0, max: 10 } });
    expect(out).toContain('/*TWEAK-SCHEMA-BEGIN*/');
    expect(out).toContain('/*TWEAK-SCHEMA-END*/');
    expect(parseTweakSchema(out)).toEqual({ a: { kind: 'number', min: 0, max: 10 } });
    // Original EDITMODE block is preserved.
    expect(parseEditmodeBlock(out)?.tokens).toEqual({ a: 1 });
  });

  it('overwrites an existing schema block', () => {
    const src = `const T = /*EDITMODE-BEGIN*/{"a":1}/*EDITMODE-END*/;\nconst TWEAK_SCHEMA = /*TWEAK-SCHEMA-BEGIN*/{"a":{"kind":"color"}}/*TWEAK-SCHEMA-END*/;`;
    const out = replaceTweakSchema(src, { a: { kind: 'boolean' } });
    expect(parseTweakSchema(out)).toEqual({ a: { kind: 'boolean' } });
    // Only one schema block remains.
    expect(out.match(/TWEAK-SCHEMA-BEGIN/g)?.length).toBe(1);
  });

  it('does not insert after a bare TWEAK_DEFAULTS when no markers present', () => {
    const src = `const TWEAK_DEFAULTS = {"a":1};`;
    const out = replaceTweakSchema(src, { a: { kind: 'color' } });
    expect(out).toBe(src);
  });

  it('returns source unchanged when there is no TWEAK_DEFAULTS to anchor to', () => {
    const src = 'function App(){}';
    expect(replaceTweakSchema(src, { a: { kind: 'color' } })).toBe(src);
  });
});
