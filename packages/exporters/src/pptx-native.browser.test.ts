import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extract } from 'zip-lib';
import { jpeg } from '../fixtures/native-image';
import { findSystemChrome } from './chrome-discovery';
import { exportPptx } from './pptx';
import { renderNativeSlides } from './pptx-native';

const chromePath = await findSystemChrome().catch(() => undefined);
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const options = {
  ...(chromePath ? { chromePath } : {}),
  injectTailwind: false,
  renderTimeoutMs: 15_000,
};
const html = (body: string, css = '') => `<!doctype html><html><head><style>
  * { box-sizing: border-box; } body { margin:0; }
  .slide { width:1280px;height:720px;background:#fff;position:relative;padding:48px; }
  h1 { font: bold 48px/1.2 Arial; margin:0 0 24px; }
  p { font:24px/1.4 Arial; margin:0; }
  ${css}
</style></head><body>${body}</body></html>`;

describe.skipIf(!chromePath)('native PPTX in system Chromium', () => {
  let directory: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'pptx-native-browser-'));
  });
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it.each([
    ['JPG', jpeg.replace('image/jpeg', 'image/jpg'), 'jpeg'],
    ['JPEG', jpeg.replace('image/jpeg', 'image/JPEG'), 'jpeg'],
    ['PNG', `data:image/PNG;base64,${png}`, 'png'],
  ])(
    'exports %s data URLs as independent images alongside editable text',
    async (name, data, extension) => {
      const destination = join(directory, `mime-${name}.pptx`);
      const result = await exportPptx(
        html(
          `<section class="slide"><p>Editable foreground</p><img src="${data}" style="width:96px;height:96px" /></section>`,
        ),
        destination,
        { ...options, sourcePath: 'deck.html', renderMode: 'native' },
      );
      expect(result.warnings?.some((warning) => warning.includes('rasterized')) ?? false).toBe(
        false,
      );
      const unpacked = join(directory, `mime-${name}-unpacked`);
      await extract(destination, unpacked);
      const parser = new DOMParser();
      const slide = parser.parseFromString(
        await readFile(join(unpacked, 'ppt/slides/slide1.xml'), 'utf8'),
        'application/xml',
      );
      expect(slide.getElementsByTagName('p:pic')).toHaveLength(1);
      expect(slide.getElementsByTagName('a:t')[0]?.textContent).toBe('Editable foreground');
      const rels = parser.parseFromString(
        await readFile(join(unpacked, 'ppt/slides/_rels/slide1.xml.rels'), 'utf8'),
        'application/xml',
      );
      const imageRel = Array.from(rels.getElementsByTagName('Relationship')).find((entry) =>
        entry.getAttribute('Type')?.endsWith('/image'),
      );
      const target = imageRel?.getAttribute('Target') ?? '';
      expect(posix.extname(target)).toBe(`.${extension}`);
      expect(await readFile(join(unpacked, 'ppt/slides', target))).toEqual(
        Buffer.from(data?.split(',')[1] ?? '', 'base64'),
      );
    },
    30_000,
  );

  it('extracts grid cards, CJK rich text, shapes and independent local images', async () => {
    await writeFile(join(directory, 'sample.png'), Buffer.from(png, 'base64'));
    const source = html(
      `<section class="slide"><h1>季度报告</h1>
      <div class="cards"><div class="card"><p>收入 <strong>增长 32%</strong></p></div><div class="card"><p>客户 120 家</p></div></div>
      <div class="circle"></div><div class="line"></div><img src="sample.png" style="width:96px;height:96px" />
    </section>`,
      `.cards{display:grid;grid-template-columns:1fr 1fr;gap:24px}.card{padding:20px;background:#e2e8f0;border-radius:12px}.circle{width:48px;height:48px;border-radius:50%;background:#123456}.line{width:240px;height:2px;background:#334455}`,
    );
    const models = await renderNativeSlides(source, {
      ...options,
      sourcePath: 'deck.html',
      assetBasePath: directory,
      assetRootPath: directory,
    });
    expect(models).toHaveLength(1);
    const model = models[0];
    expect(model?.warnings.some((warning) => warning.includes('rasterized'))).toBe(false);
    const texts = model?.elements.filter((el) => el.type === 'text') ?? [];
    expect(texts.flatMap((el) => el.runs.map((run) => run.text)).join('')).toBe(
      '季度报告收入 增长 32%客户 120 家',
    );
    expect(texts[1]?.runs.some((run) => run.bold && run.text === '增长 32%')).toBe(true);
    expect(model?.elements.filter((el) => el.type === 'image')).toHaveLength(1);
    expect(model?.elements.some((el) => el.type === 'shape' && el.shape === 'ellipse')).toBe(true);
    expect(texts[2]?.x).toBeGreaterThan(texts[1]?.x ?? 0);
    expect(texts[2]?.y).toBe(texts[1]?.y);
  }, 30_000);

  it('executes JSX props and maps before exporting actual text to PPTX XML', async () => {
    const source = `const title = '真实标题'; const values = ['第一项', '第二项'];
      function App() { return <section data-pptx-slide style={{width:1280,height:720,padding:48,background:'#fff'}}><h1 style={{fontSize:48}}>{title}</h1>{values.map(value => <p key={value} style={{fontSize:24}}>{value}</p>)}</section>; }`;
    const destination = join(directory, 'jsx.pptx');
    const result = await exportPptx(source, destination, {
      ...options,
      sourcePath: 'App.jsx',
      renderMode: 'native',
    });
    expect(result.warnings?.some((warning) => warning.includes('rasterized')) ?? false).toBe(false);
    const unpacked = join(directory, 'jsx-unpacked');
    await extract(destination, unpacked);
    const xml = await readFile(join(unpacked, 'ppt/slides/slide1.xml'), 'utf8');
    expect(xml).toContain('<a:t>真实标题</a:t>');
    expect(xml).toContain('<a:t>第一项</a:t>');
    expect(xml).toContain('<a:t>第二项</a:t>');
    expect(xml).not.toContain('{title}');
    expect(xml).not.toContain('<p:pic>');
  }, 30_000);

  it('exports inactive slides and does not count nested sections as extra pages', async () => {
    const source = html(
      `<div class="slide active"><section><h1>One</h1></section></div><div class="slide"><section><h1>Two</h1></section></div>`,
      '.slide{display:none}.slide.active{display:block}',
    );
    const models = await renderNativeSlides(source, options);
    expect(models).toHaveLength(2);
    expect(
      models.map((model) =>
        model.elements
          .filter((el) => el.type === 'text')
          .flatMap((el) => el.runs.map((run) => run.text))
          .join(''),
      ),
    ).toEqual(['One', 'Two']);
  }, 30_000);

  it('rasterizes gradient decoration while retaining its native text', async () => {
    const source = html(
      `<section class="slide"><h1>Editable heading</h1><div style="background:linear-gradient(red,blue);width:400px;height:100px"><p>Raster text</p></div></section>`,
    );
    const models = await renderNativeSlides(source, options);
    const model = models[0];
    expect(model?.warnings.join(' ')).toContain('gradient');
    expect(model?.elements.filter((el) => el.type === 'image')).toHaveLength(1);
    expect(
      model?.elements
        .filter((el) => el.type === 'text')
        .flatMap((el) => el.runs.map((run) => run.text)),
    ).toEqual(['Editable heading', 'Raster text']);
    const result = await exportPptx(source, join(directory, 'fallback.pptx'), {
      ...options,
      renderMode: 'native',
    });
    expect(result.warnings?.[0]).toContain('Slide 1:');
  }, 30_000);

  it('fits unstructured pages and still reports broken images and explicit selector errors', async () => {
    const fallback = await renderNativeSlides(html('<main><h1>No slides</h1></main>'), options);
    expect(fallback).toHaveLength(1);
    expect(fallback[0]?.warnings.join(' ')).toContain('No explicit slide containers');
    expect(
      fallback[0]?.elements.some(
        (el) => el.type === 'text' && el.runs.some((run) => run.text === 'No slides'),
      ),
    ).toBe(true);
    await expect(
      renderNativeSlides(html('<main>Content</main>'), { ...options, slideSelector: '.missing' }),
    ).rejects.toThrow('slideSelector');
    await expect(
      renderNativeSlides(
        html('<section class="slide"><img src="data:image/png;base64,broken" /></section>'),
        options,
      ),
    ).rejects.toThrow('image failed to load');
  }, 30_000);

  it('measures hidden content-box slides after activation without shrinking their padding', async () => {
    const models = await renderNativeSlides(
      html(
        '<div class="slide active"><h1>One</h1></div><div class="slide"><h1>Two</h1></div>',
        '.slide{display:none;box-sizing:content-box;width:1000px;height:500px;padding:40px;border:10px solid black}.slide.active{display:block}',
      ),
      options,
    );
    expect(models.map((model) => [model.width, model.height])).toEqual([
      [1100, 600],
      [1100, 600],
    ]);
  }, 30_000);

  it('preserves aligned anonymous text, clipped text and image backgrounds using local fallback', async () => {
    const models = await renderNativeSlides(
      html(
        `<section class="slide"><h1>Native heading</h1><div style="display:flex;align-items:center;justify-content:center;width:400px;height:120px">Centered text</div><p style="width:80px;height:20px;overflow:hidden;white-space:nowrap">Long clipped text must not become a complete native paragraph</p><img style="width:96px;height:96px;background:#ff0000" src="data:image/png;base64,${png}" /></section>`,
      ),
      options,
    );
    const model = models[0];
    expect(
      model?.elements
        .filter((el) => el.type === 'text')
        .flatMap((el) => el.runs.map((run) => run.text)),
    ).toEqual(['Native heading', 'Centered text']);
    expect(model?.elements.filter((el) => el.type === 'image')).toHaveLength(2);
    expect(model?.warnings.join(' ')).toContain('clipped text');
    expect(model?.warnings.join(' ')).toContain('image crop or format');
  }, 30_000);

  it('keeps text editable beside shadows and overlapping decoration captures', async () => {
    const models = await renderNativeSlides(
      html(
        '<section class="slide"><h1>Shadow heading</h1><div style="width:400px;height:100px;background:red;box-shadow:12px 12px 8px black"><p>Shadow card</p></div></section><section class="slide"><div style="width:400px;height:100px;background:linear-gradient(red,blue)"></div><p style="position:absolute;left:60px;top:60px">Overlapping foreground</p></section>',
      ),
      options,
    );
    expect(models).toHaveLength(2);
    for (const model of models) {
      expect(model.elements.some((el) => el.type === 'text')).toBe(true);
      expect(model.elements.filter((el) => el.type === 'image')).toHaveLength(1);
      expect(
        model.elements.some((el) => el.type === 'image' && el.width === 1280 && el.height === 720),
      ).toBe(false);
      expect(model.warnings.join(' ')).not.toContain('whole-slide fallback');
    }
  }, 30_000);

  it('finds all four pages in the bundled JSX slide pattern', async () => {
    const source = await readFile(
      new URL(
        '../../../apps/desktop/resources/templates/design-skills/slide-deck.jsx',
        import.meta.url,
      ),
      'utf8',
    );
    // Keep this resource smoke test offline without changing its layout or dynamic slide content.
    const offline = source.replace(/Fraunces|DM Serif Display|DM Sans|JetBrains Mono/g, 'Arial');
    const models = await renderNativeSlides(offline, { ...options, sourcePath: 'App.jsx' });
    expect(models).toHaveLength(4);
    expect(
      models[0]?.elements
        .filter((el) => el.type === 'text')
        .flatMap((el) => el.runs.map((run) => run.text))
        .join(' '),
    ).toContain('The slow practice of seeing.');
    expect(models.every((model) => model.elements.some((el) => el.type === 'text'))).toBe(true);
  }, 30_000);

  it('normalizes nested preview scales for geometry, typography, padding and pill radii', async () => {
    const snapshots = [];
    for (const scale of [0.5, 530 / 720, 1, 1.15]) {
      const models = await renderNativeSlides(
        html(
          `<div style="transform:scale(${scale});overflow:hidden;width:600px;height:300px"><div style="transform:translate(14px,20px)"><section class="slide"><h1 style="font-size:38px">Stable heading</h1><p style="padding:8px;border:1px solid black;border-radius:999px;width:260px">Pill label</p></section></div></div>`,
        ),
        options,
      );
      const m = models[0];
      expect([m?.width, m?.height]).toEqual([1280, 720]);
      expect(
        m?.elements.filter((e) => e.type === 'shape').every((e) => e.shape !== 'ellipse'),
      ).toBe(true);
      expect(m?.elements.find((e) => e.type === 'text')?.runs[0]?.fontSize).toBe(38);
      snapshots.push(
        m?.elements.map((e) => ({
          type: e.type,
          x: e.x,
          y: e.y,
          width: e.width,
          height: e.height,
          ...(e.type === 'text' ? { runs: e.runs } : {}),
        })),
      );
    }
    for (const snapshot of snapshots.slice(1)) expect(snapshot).toEqual(snapshots[0]);
  }, 60_000);

  it('retains cover and card text with generated decorations and nonuniform borders', async () => {
    const models = await renderNativeSlides(
      html(
        `<section class="slide cover"><h1>Cover remains editable</h1><p>Ordinary cover text</p></section><section class="slide"><div class="card"><p class="bullet">Editable bullet text</p></div></section>`,
        `.cover::after{content:"";position:absolute;inset:0;background:linear-gradient(transparent,rgba(0,0,255,.2));pointer-events:none}.cover h1,.cover p{position:relative;z-index:2}.card{width:500px;padding:20px;border:1px solid gray;border-left:5px solid green;border-radius:12px}.bullet{position:relative;padding-left:16px}.bullet::before{content:"";position:absolute;left:0;top:10px;width:5px;height:5px;background:green;border-radius:50%}`,
      ),
      options,
    );
    expect(
      models.map((m) =>
        m.elements
          .filter((e) => e.type === 'text')
          .flatMap((e) => e.runs.map((r) => r.text))
          .join(' '),
      ),
    ).toEqual(['Cover remains editable Ordinary cover text', 'Editable bullet text']);
    expect(models[1]?.elements.some((e) => e.type === 'shape' && e.shape === 'ellipse')).toBe(true);
    expect(models.every((m) => !m.warnings.some((w) => w.includes('contents rasterized')))).toBe(
      true,
    );
  }, 30_000);

  it('writes measured lines for wrapping and mixed font sizes without automatic shrink', async () => {
    const models = await renderNativeSlides(
      html(
        '<section class="slide"><p style="width:220px;font-size:24px;line-height:1.6">Several words wrap into multiple separate lines.</p><p>Small <b style="font-size:32px">BIG</b> text</p></section>',
      ),
      options,
    );
    const texts = models[0]?.elements.filter((e) => e.type === 'text') ?? [];
    expect(texts.length).toBeGreaterThan(2);
    expect(texts.every((e) => e.layout === 'lines' && e.lineHeight === 1)).toBe(true);
    expect(texts.map((e) => e.runs.map((r) => r.text).join('')).join(' ')).toBe(
      'Several words wrap into multiple separate lines. Small BIG text',
    );
    expect(texts.some((e) => e.runs.some((r) => r.fontSize === 32))).toBe(true);
  }, 30_000);

  it('supports portrait dimensions without stretching and ignores explicitly excluded controls', async () => {
    const models = await renderNativeSlides(
      html(
        '<section class="slide" style="width:720px;height:1280px"><h1>Portrait</h1><button data-pptx-ignore>Next</button></section>',
      ),
      options,
    );
    expect(models[0]?.width).toBe(720);
    expect(models[0]?.height).toBe(1280);
    expect(models[0]?.warnings).toContain(
      'Non-16:9 slide fitted with whitespace; content was not stretched.',
    );
    expect(
      models[0]?.elements
        .filter((el) => el.type === 'text')
        .flatMap((el) => el.runs.map((run) => run.text)),
    ).toEqual(['Portrait']);
  }, 30_000);
});
