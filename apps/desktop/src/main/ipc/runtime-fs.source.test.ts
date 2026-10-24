import { describe, expect, it, vi } from 'vitest';
import { createRuntimeTextEditorFs, resolveLocalAssetRefs } from './runtime-fs';

describe('runtime filesystem source identity', () => {
  const source = {
    schemaVersion: 1,
    path: 'pages/main.html',
    format: 'html',
    runtimeMode: 'native-html',
  } as const;
  const make = (initialFiles: Array<{ file: string; contents: string }> = []) => {
    const sendEvent = vi.fn();
    return {
      ...createRuntimeTextEditorFs({
        db: null,
        designId: 'design',
        generationId: 'run',
        previousSource: '<p>Stale renderer</p>',
        source,
        initialFiles,
        sendEvent,
        logger: { error: vi.fn() },
      }),
      sendEvent,
    };
  };
  it.each([
    ['App.jsx', 'assets/'],
    ['pages/main.html', '../assets/'],
  ])('expands srcset URL lists for %s without changing descriptors or unrelated substrings', (entryPath, prefix) => {
    const files = new Map([
      ['assets/photo.png', 'data:image/png;base64,AAAA'],
      ['assets/photo-2x.png', 'data:image/png;base64,BBBB'],
    ]);
    const raw = `<img srcset='${prefix}photo.png 1x, ${prefix}photo-2x.png 2x' src="${prefix}photo.png"><source srcset="  ${prefix}photo.png 400w,${prefix}photo-2x.png 800w"><img srcset="${prefix}photo.png.bak 1x, https://example.test/${prefix}photo.png 2x"><p>unrelated/${prefix}photo.png</p>`;
    const expected = `<img srcset='data:image/png;base64,AAAA 1x, data:image/png;base64,BBBB 2x' src="data:image/png;base64,AAAA"><source srcset="  data:image/png;base64,AAAA 400w,data:image/png;base64,BBBB 800w"><img srcset="${prefix}photo.png.bak 1x, https://example.test/${prefix}photo.png 2x"><p>unrelated/${prefix}photo.png</p>`;
    files.set(entryPath, raw);
    expect(resolveLocalAssetRefs(raw, files, entryPath)).toBe(expected);
    expect(files.get(entryPath)).toBe(raw);
  });
  it.each([
    ['App.jsx', 'assets/'],
    ['pages/main.html', '../assets/'],
  ])('preserves commas inside whole remote and data URL tokens in %s srcset', (entryPath, prefix) => {
    const files = new Map([['assets/photo.png', 'data:image/png;base64,AAAA']]);
    const remote = `https://example.test/images/photo,${prefix}photo.png`;
    const data = `data:image/svg+xml,example,${prefix}photo.png`;
    const raw = `<img srcset="${remote} 1x, ${data} 2x, ${prefix}photo.png 3x">`;
    expect(resolveLocalAssetRefs(raw, files, entryPath)).toBe(
      `<img srcset="${remote} 1x, ${data} 2x, data:image/png;base64,AAAA 3x">`,
    );
  });
  it.each([
    ['App.jsx', 'assets/'],
    ['pages/main.html', '../assets/'],
  ])('expands whole local URL tokens with and without descriptors in %s', (entryPath, prefix) => {
    const files = new Map([
      ['assets/photo.png', 'data:image/png;base64,AAAA'],
      ['assets/photo-2x.png', 'data:image/png;base64,BBBB'],
    ]);
    const raw = `<img srcset=" ${prefix}photo.png,\n\t${prefix}photo-2x.png "><img srcset='${prefix}photo.png 1x,${prefix}photo-2x.png 2x'><img srcset="${prefix}photo.png,${prefix}photo-2x.png">`;
    const expected = `<img srcset=" data:image/png;base64,AAAA,\n\tdata:image/png;base64,BBBB "><img srcset='data:image/png;base64,AAAA 1x,data:image/png;base64,BBBB 2x'><img srcset="${prefix}photo.png,${prefix}photo-2x.png">`;
    expect(resolveLocalAssetRefs(raw, files, entryPath)).toBe(expected);
  });
  it('retains raw nested srcset while emitting its expanded display source', async () => {
    const runtime = make([
      { file: 'assets/photo.png', contents: 'data:image/png;base64,AAAA' },
      { file: 'assets/photo-2x.png', contents: 'data:image/png;base64,BBBB' },
    ]);
    const raw = '<img srcset="../assets/photo.png 1x, ../assets/photo-2x.png 2x">';
    await runtime.fs.create(source.path, raw);
    expect(runtime.fs.view(source.path)?.content).toBe(raw);
    expect(runtime.sendEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: '<img srcset="data:image/png;base64,AAAA 1x, data:image/png;base64,BBBB 2x">',
      }),
    );
  });
  it('does not seed stale renderer source into App.jsx for a planned source', () => {
    const runtime = make();
    expect(runtime.fsMap.has('App.jsx')).toBe(false);
    expect(runtime.fs.view(source.path)).toBeNull();
  });
  it('keeps raw source and attaches identity only to primary source events', async () => {
    const runtime = make([
      {
        file: 'assets/photo.png',
        contents:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlLbsAAAAAASUVORK5CYII=',
      },
    ]);
    const content = '<img src="../assets/photo.png">';
    await runtime.fs.create(source.path, content);
    expect(runtime.fsMap.get(source.path)).toBe(content);
    expect(runtime.sendEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: source.path,
        source,
        content:
          '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlLbsAAAAAASUVORK5CYII=">',
      }),
    );
    await runtime.fs.create('other.html', '<p>Other</p>');
    expect(runtime.sendEvent.mock.lastCall?.[0]).not.toHaveProperty('source');
  });
  it('re-emits the declared nested entry on asset updates, not coexisting App.jsx', async () => {
    const runtime = make([
      { file: source.path, contents: '<img src="../assets/photo.png">' },
      { file: 'App.jsx', contents: '<p>Other</p>' },
    ]);
    await runtime.fs.create(
      'assets/photo.png',
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlLbsAAAAAASUVORK5CYII=',
    );
    expect(runtime.sendEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: source.path, source }),
    );
  });
});
