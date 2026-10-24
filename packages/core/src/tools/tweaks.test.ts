import { describe, expect, it, vi } from 'vitest';
import {
  aggregateTweaks,
  makeTweaksTool,
  parseTweakBlocks,
  type TweakFileInput,
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
  it('never falls back to glob scanning when native literal reader is unavailable', async () => {
    const scan = vi.fn(async () => []);
    const tool = makeTweaksTool(scan, {
      source: {
        schemaVersion: 1,
        path: 'pages/[z-a].htm',
        format: 'html',
        runtimeMode: 'native-html',
      },
    });
    await expect(tool.execute('no-reader', {})).rejects.toThrow(/literal workspace file reader/);
    expect(scan).not.toHaveBeenCalled();
    const missing = makeTweaksTool(scan, {
      source: {
        schemaVersion: 1,
        path: 'pages/missing.htm',
        format: 'html',
        runtimeMode: 'native-html',
      },
      readWorkspaceFile: async () => null,
    });
    expect((await missing.execute('missing', {})).details.scannedFileCount).toBe(0);
    expect(scan).not.toHaveBeenCalled();
  });
  it('does not treat glob-like primary filenames as requests for other files', async () => {
    const files = [
      blockFile('pages/[main].htm', '{"density":1}'),
      blockFile('pages/m.htm', '{"density":2}'),
    ];
    const tool = makeTweaksTool(async () => files, {
      readWorkspaceFile: async (file) => files.find((entry) => entry.file === file) ?? null,
      source: {
        schemaVersion: 1,
        path: 'pages/[main].htm',
        format: 'html',
        runtimeMode: 'native-html',
      },
    });
    expect((await tool.execute('exact', {})).details.blocks).toEqual([
      { file: 'pages/[main].htm', tokens: { density: 1 } },
    ]);
    expect((await tool.execute('explicit', { patterns: ['pages/*.htm'] })).details.fileCount).toBe(
      2,
    );
  });
  it('discovers the exact native .htm entry by default and preserves explicit auxiliary patterns', async () => {
    let captured: string[] | undefined;
    const tool = makeTweaksTool(
      async (patterns) => {
        captured = patterns;
        return patterns?.includes('pages/main.htm')
          ? [blockFile('pages/main.htm', '{"density":1}')]
          : [];
      },
      {
        readWorkspaceFile: async (file) => blockFile(file, '{"density":1}'),
        source: {
          schemaVersion: 1,
          path: 'pages/main.htm',
          format: 'html',
          runtimeMode: 'native-html',
        },
      },
    );
    expect((await tool.execute('native', {})).details.blocks).toEqual([
      { file: 'pages/main.htm', tokens: { density: 1 } },
    ]);
    expect(captured).toBeUndefined();
    expect(tool.description).toContain('authored bindings');
    await tool.execute('aux', { patterns: ['styles/*.css'] });
    expect(captured).toEqual(['styles/*.css']);
  });
  it('returns empty details when reader yields no files', async () => {
    const tool = makeTweaksTool(async () => []);
    const res = await tool.execute('id', {});
    expect(res.details).toEqual({
      blocks: [],
      fileCount: 0,
      scannedFileCount: 0,
      missingFiles: [],
      invalidFiles: [],
    });
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
      text: 'scanned 1 file(s); found 1 declared value(s) across 1 file(s): a.css. Missing declarations: none. Invalid declarations: none. The panel reads the active preview source; verify its rendered bindings separately.',
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

  it('does not imply that unrelated starter controls are available in App.jsx', async () => {
    const tool = makeTweaksTool(async () => [
      { file: 'App.jsx', contents: 'function App() { return <main>Hello</main>; }' },
      blockFile('starters/shell.jsx', '{"accent":"#27634c"}'),
    ]);
    const result = await tool.execute('id', {});
    expect(result.details.blocks.map((block) => block.file)).toEqual(['starters/shell.jsx']);
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining('starters/shell.jsx'),
    });
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining('active preview source'),
    });
  });

  it('reports missing declarations rather than implying a successful registration', async () => {
    const tool = makeTweaksTool(async () => [{ file: 'App.jsx', contents: 'const css = "";' }]);
    const result = await tool.execute('id', {});
    expect(result.details).toEqual({
      blocks: [],
      fileCount: 0,
      scannedFileCount: 1,
      missingFiles: ['App.jsx'],
      invalidFiles: [],
    });
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining('No EDITMODE declarations found'),
    });
  });
  it('reports invalid files without losing valid declarations from other files', async () => {
    const tool = makeTweaksTool(async () => [
      blockFile('App.jsx', '{accent:"red"}'),
      blockFile('Details.jsx', '{"radius":16}'),
      { file: 'Empty.jsx', contents: '/*EDITMODE-BEGIN*/{}/*EDITMODE-END*/' },
    ]);
    const result = await tool.execute('id', {});
    expect(result.details).toMatchObject({
      scannedFileCount: 3,
      fileCount: 2,
      blocks: [
        { file: 'Details.jsx', tokens: { radius: 16 } },
        { file: 'Empty.jsx', tokens: {} },
      ],
      invalidFiles: [{ file: 'App.jsx', error: 'EDITMODE block contains invalid JSON' }],
    });
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
