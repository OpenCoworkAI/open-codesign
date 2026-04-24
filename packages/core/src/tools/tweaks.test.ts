import { describe, expect, it } from 'vitest';
import {
  type TweakFileInput,
  aggregateTweaks,
  makeTweaksTool,
  parseTweakBlocks,
} from './tweaks.js';

const blockFile = (file: string, json: string): TweakFileInput => ({
  file,
  contents: `const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/${json}/*EDITMODE-END*/;`,
});

describe('parseTweakBlocks', () => {
  it('returns empty array when no files have EDITMODE blocks', () => {
    expect(parseTweakBlocks([])).toEqual([]);
    expect(parseTweakBlocks([{ file: 'a.css', contents: 'body{}' }])).toEqual([]);
  });

  it('collects one block per file with markers', () => {
    const blocks = parseTweakBlocks([
      blockFile('a.jsx', '{"accent":"#CC785C"}'),
      { file: 'ignored.txt', contents: 'no markers here' },
      blockFile('b.css', '{"radius":8,"dense":true}'),
    ]);
    expect(blocks).toEqual([
      { file: 'a.jsx', tokens: { accent: '#CC785C' } },
      { file: 'b.css', tokens: { radius: 8, dense: true } },
    ]);
  });
});

describe('aggregateTweaks', () => {
  it('flattens per-file tokens into triples', () => {
    const entries = aggregateTweaks([
      blockFile('a.jsx', '{"accent":"#CC785C","radius":8}'),
      blockFile('b.css', '{"dense":true}'),
    ]);
    expect(entries).toEqual([
      { file: 'a.jsx', key: 'accent', value: '#CC785C' },
      { file: 'a.jsx', key: 'radius', value: 8 },
      { file: 'b.css', key: 'dense', value: true },
    ]);
  });
});

describe('tweaks tool', () => {
  it('returns empty details when reader yields no files', async () => {
    const tool = makeTweaksTool(async () => []);
    const res = await tool.execute('id', {});
    expect(res.details).toEqual({ blocks: [], fileCount: 0 });
    expect(res.content).toEqual([{ type: 'text', text: 'no files matched' }]);
  });

  it('aggregates a single file with one tweakable key', async () => {
    const tool = makeTweaksTool(async () => [blockFile('a.css', '{"foo":1}')]);
    const res = await tool.execute('id', {});
    expect(res.details.blocks).toHaveLength(1);
    expect(res.details.blocks[0]).toEqual({ file: 'a.css', tokens: { foo: 1 } });
    expect(res.details.fileCount).toBe(1);
    expect(res.content[0]).toEqual({
      type: 'text',
      text: 'found 1 tweakable value(s) across 1 file(s)',
    });
  });

  it('forwards user patterns when supplied', async () => {
    let captured: string[] | undefined;
    const tool = makeTweaksTool(async (patterns) => {
      captured = patterns;
      return [];
    });
    await tool.execute('id', { patterns: ['src/**/*.tsx'] });
    expect(captured).toEqual(['src/**/*.tsx']);
  });

  it('defaults patterns to html/jsx/css/js when omitted', async () => {
    let captured: string[] | undefined;
    const tool = makeTweaksTool(async (patterns) => {
      captured = patterns;
      return [];
    });
    await tool.execute('id', {});
    expect(captured).toEqual(['**/*.html', '**/*.jsx', '**/*.css', '**/*.js']);
  });
});
