import { describe, expect, it } from 'vitest';
import { aggregateTweaks, parseTweakBlocks } from './tweaks';

describe('parseTweakBlocks', () => {
  it('extracts key/value pairs from a single block', () => {
    const sources = [
      {
        file: 'landing.html',
        contents: `body { color: red; }
/* EDITMODE
hero-title: Welcome
accent-color: #ff0066
EDITMODE_END */
.foo { display: block; }`,
      },
    ];
    const blocks = parseTweakBlocks(sources);
    expect(blocks.length).toBe(1);
    expect(blocks[0]?.file).toBe('landing.html');
    expect(blocks[0]?.keys).toEqual([
      { name: 'hero-title', value: 'Welcome' },
      { name: 'accent-color', value: '#ff0066' },
    ]);
  });

  it('handles multiple blocks across files', () => {
    const sources = [
      {
        file: 'a.css',
        contents: '/* EDITMODE\nfoo: 1\nEDITMODE_END */',
      },
      {
        file: 'b.jsx',
        contents: '/* EDITMODE\nbar: hi\nbaz: 2\nEDITMODE_END */',
      },
    ];
    const blocks = parseTweakBlocks(sources);
    const merged = aggregateTweaks(blocks);
    expect(merged.get('a.css')?.length).toBe(1);
    expect(merged.get('b.jsx')?.length).toBe(2);
  });

  it('ignores empty blocks', () => {
    expect(parseTweakBlocks([{ file: 'x', contents: '/* EDITMODE\n\nEDITMODE_END */' }])).toEqual(
      [],
    );
  });

  it('skips files without EDITMODE markers', () => {
    expect(parseTweakBlocks([{ file: 'x', contents: 'plain content' }])).toEqual([]);
  });
});
