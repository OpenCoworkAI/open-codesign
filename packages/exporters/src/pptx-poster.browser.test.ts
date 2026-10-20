import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extract } from 'zip-lib';
import { findSystemChrome } from './chrome-discovery';
import { exportPptx } from './pptx';
import { renderNativeSlides } from './pptx-native';

const chromePath = await findSystemChrome().catch(() => undefined);
const options = {
  ...(chromePath ? { chromePath } : {}),
  injectTailwind: false,
  renderTimeoutMs: 15_000,
};
const html = (body: string) => `<!doctype html><html><head><style>
  *{box-sizing:border-box}body{margin:0;font-family:Arial}.stage{min-height:100vh;display:grid;place-items:center;padding:3vmin;background:#111}
  .exhibit-poster{position:relative;width:min(92vw,62vh,680px);aspect-ratio:1/1.4142;container-type:size;overflow:hidden;background:#fff}
  .grid{position:absolute;inset:0;opacity:.4;pointer-events:none;background:repeating-linear-gradient(transparent 0 20px,#777 21px 22px)}
  .inner{position:relative;padding:6cqw}.inner h1{font-size:10cqw;margin:0}.inner p{font-size:4cqw}
</style></head><body>${body}</body></html>`;
const poster =
  '<article class="exhibit-poster"><div class="grid"></div><div class="inner"><section><h1>Poster headline</h1><p>Editable body</p></section></div></article>';

describe.skipIf(!chromePath)('poster artboard export in system Chromium', () => {
  it('selects the unique proportioned poster instead of its stage or nested sections', async () => {
    const [model] = await renderNativeSlides(html(`<main class="stage">${poster}</main>`), options);
    expect(model?.pageLayout).toBe('source');
    expect(model?.width).toBeCloseTo(720 * 0.62, 1);
    expect((model?.height ?? 0) / (model?.width ?? 1)).toBeCloseTo(Math.SQRT2, 3);
    expect(model?.warnings.join(' ')).toContain('poster artboard');
    expect(model?.warnings.join(' ')).not.toContain('fitted with whitespace');
    const elements = model?.elements ?? [];
    const gridIndex = elements.findIndex((e) => e.type === 'image');
    const textIndex = elements.findIndex((e) => e.type === 'text');
    expect(gridIndex).toBeGreaterThan(-1);
    expect(textIndex).toBeGreaterThan(gridIndex);
    expect(
      elements.filter((e) => e.type === 'text').map((e) => e.runs.map((r) => r.text).join('')),
    ).toEqual(['Poster headline', 'Editable body']);
  }, 30_000);

  it('writes a portrait PPTX page through the public exporter', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pptx-poster-'));
    try {
      const outputPath = join(dir, 'poster.pptx');
      await exportPptx(html(`<main class="stage">${poster}</main>`), outputPath, {
        ...options,
        renderMode: 'native',
      });
      const unpacked = join(dir, 'unpacked');
      await extract(outputPath, unpacked);
      const xml = await readFile(join(unpacked, 'ppt', 'presentation.xml'), 'utf8');
      const size = xml.match(/<p:sldSz\s+cx="(\d+)"\s+cy="(\d+)"/);
      expect(size).not.toBeNull();
      expect(Number(size?.[2]) / Number(size?.[1])).toBeCloseTo(Math.SQRT2, 3);
      const slide = await readFile(join(unpacked, 'ppt', 'slides', 'slide1.xml'), 'utf8');
      expect(slide).toContain('<a:t>Poster headline</a:t>');
      expect(slide.indexOf('<p:pic>')).toBeLessThan(slide.indexOf('<p:txBody>'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('accepts an explicit poster marker without requiring a naming convention', async () => {
    const [model] = await renderNativeSlides(
      html(
        '<main class="stage"><div data-pptx-poster style="width:400px;height:600px;background:white"><p>Explicit poster</p></div></main>',
      ),
      options,
    );
    expect(model).toMatchObject({ pageLayout: 'source', width: 400, height: 600 });
  }, 30_000);

  it('does not guess among multiple posters or turn ordinary portrait cards into pages', async () => {
    for (const body of [
      '<div class="exhibit-poster"><p>First</p></div><div class="exhibit-poster"><p>Second</p></div>',
      '<article style="width:200px;aspect-ratio:2/3"><p>Card</p></article>',
    ]) {
      const models = await renderNativeSlides(html(body), options);
      expect(models).toHaveLength(1);
      expect(models[0]?.pageLayout).toBeUndefined();
      expect(models[0]?.warnings.join(' ')).toContain('complete document');
    }
  }, 45_000);

  it('keeps explicit slide markers and custom selectors ahead of poster inference', async () => {
    const [model] = await renderNativeSlides(
      html(
        `<main class="stage">${poster}</main><section data-pptx-slide style="width:1280px;height:720px"><p>Slide wins</p></section>`,
      ),
      options,
    );
    expect(model?.pageLayout).toBeUndefined();
    expect([model?.width, model?.height]).toEqual([1280, 720]);
    await expect(
      renderNativeSlides(html(poster), { ...options, slideSelector: '.missing' }),
    ).rejects.toThrow('slideSelector');
  }, 45_000);
});
