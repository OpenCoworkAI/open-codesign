import type { Browser, Page } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findSystemChrome } from './chrome-discovery';
import type { NativeSlideElement, NativeSlideModel } from './pptx-model';
import { renderNativeSlides } from './pptx-native';

const chromePath = await findSystemChrome().catch(() => undefined);
const html = (body: string, css = '') => `<!doctype html><html><head><style>
  body{margin:0}.slide{position:relative;width:1280px;height:720px;box-sizing:border-box;padding:60px;background:white}
  p{margin:0;font:32px/1.2 Arial}${css}
</style></head><body><section class="slide">${body}</section></body></html>`;

async function render(body: string, css = '') {
  const models = await renderNativeSlides(html(body, css), {
    ...(chromePath ? { chromePath } : {}),
    injectTailwind: false,
    renderTimeoutMs: 15_000,
  });
  const model = models[0];
  if (!model) throw new Error('Expected one rendered slide');
  return model;
}

function texts(model: NativeSlideModel) {
  return model.elements
    .filter((element) => element.type === 'text')
    .map((element) => ({
      ...element,
      text: element.runs.map((run) => run.text).join(''),
    }));
}

describe.skipIf(!chromePath)('native PPTX repair edge regressions in system Chromium', () => {
  let browser: Browser | undefined;
  let page: Page;
  beforeAll(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    if (!chromePath) throw new Error('System Chromium unavailable');
    browser = await puppeteer.launch({ executablePath: chromePath, headless: true });
    page = await browser.newPage();
  });
  afterAll(async () => {
    await browser?.close();
  });

  // These fixtures use only solid rectangles and PNGs: reconstruct their paint order independently.
  async function pixel(elements: NativeSlideElement[], x: number, y: number) {
    return page.evaluate(
      async (input) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        for (const element of input.elements) {
          if (element.type === 'shape') {
            context.globalAlpha = element.fill.opacity;
            context.fillStyle = `#${element.fill.hex}`;
            context.fillRect(element.x, element.y, element.width, element.height);
            context.globalAlpha = 1;
          } else if (element.type === 'image') {
            const image = new Image();
            image.src = element.data;
            await image.decode();
            context.drawImage(image, element.x, element.y, element.width, element.height);
          }
        }
        return Array.from(context.getImageData(input.x, input.y, 1, 1).data);
      },
      { elements, x, y },
    );
  }

  it.each([-1, 1])('does not duplicate static inline text with ignored z-index %s', async (z) => {
    const model = await render(`<p>A<span style="z-index:${z}">DUP</span>Z</p>`);
    expect(
      texts(model)
        .map((element) => element.text)
        .join(''),
    ).toBe('ADUPZ');
  }, 30_000);

  it('keeps direct text after a decorated inline child at its measured position', async () => {
    const model = await render('<p>A<span style="background:red">BBBB</span>Z</p>');
    const nodes = texts(model);
    const before = nodes.find((node) => node.text === 'A');
    const highlighted = nodes.find((node) => node.text === 'BBBB');
    const after = nodes.find((node) => node.text === 'Z');
    expect(before).toBeDefined();
    expect(highlighted).toBeDefined();
    expect(after).toBeDefined();
    expect(after?.x).toBeGreaterThan((highlighted?.x ?? 0) + (highlighted?.width ?? 0) - 2);
    expect(
      [...nodes]
        .sort((a, b) => a.x - b.x)
        .map((node) => node.text)
        .join(''),
    ).toBe('ABBBBZ');
  }, 30_000);

  it.each([
    ['BR', '<p style="line-height:0.2">FIRST<br>SECOND</p>'],
    ['pre newline', '<p style="white-space:pre;line-height:0.2">FIRST\nSECOND</p>'],
  ])(
    'preserves explicit %s breaks even when glyph rectangles overlap',
    async (_name, body) => {
      const nodes = texts(await render(body));
      expect(nodes.map((node) => node.text)).toEqual(['FIRST', 'SECOND']);
      expect(nodes[1]?.y).toBeGreaterThan(nodes[0]?.y ?? 0);
    },
    30_000,
  );

  it('groups baseline-aligned mixed font sizes but not the following explicit line', async () => {
    const nodes = texts(
      await render(
        '<p style="line-height:1"><span style="font-size:60px">Big</span><span style="font-size:12px">small</span><br>next</p>',
      ),
    );
    expect(nodes.map((node) => node.text)).toEqual(['Bigsmall', 'next']);
    expect(nodes[0]?.runs.map((run) => run.fontSize)).toEqual([60, 12]);
    expect(nodes.every((node) => node.layout === 'lines')).toBe(true);
  }, 30_000);

  it('keeps sibling pseudo decorations out of a separately captured background', async () => {
    const model = await render(
      '<div id="target"></div><div id="other"></div>',
      `
      #target{position:absolute;left:50px;top:50px;width:100px;height:100px;background:linear-gradient(red,red)}
      #other{position:absolute;left:50px;top:50px;width:100px;height:100px}
      #other::before{content:"";visibility:visible;position:absolute;left:0;top:0;width:100px;height:100px;background:lime;z-index:20}
    `,
    );
    const image = model.elements.find((element) => element.type === 'image');
    expect(image).toBeDefined();
    expect(await pixel(image ? [image] : [], 80, 80)).toEqual([255, 0, 0, 255]);
  }, 30_000);

  it('does not bake editable text decorations into a background-only capture', async () => {
    const model = await render(
      '<p id="target">UNDERLINE</p>',
      `
      #target{width:300px;height:80px;background:linear-gradient(red,red);color:blue;text-decoration:underline}
    `,
    );
    expect(texts(model).map((element) => element.text)).toEqual(['UNDERLINE']);
    const image = model.elements.find((element) => element.type === 'image');
    if (!image || image.type !== 'image') throw new Error('Expected isolated background image');
    const nonRedPixels = await page.evaluate(async (data) => {
      const image = new Image();
      image.src = data;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      context.drawImage(image, 0, 0);
      const rgba = context.getImageData(0, 0, image.width, image.height).data;
      let count = 0;
      for (let index = 0; index < rgba.length; index += 4) {
        if (
          (rgba[index + 3] ?? 0) > 0 &&
          ((rgba[index] ?? 0) < 250 || (rgba[index + 1] ?? 0) > 5 || (rgba[index + 2] ?? 0) > 5)
        )
          count++;
      }
      return count;
    }, image.data);
    expect(nonRedPixels).toBe(0);
  }, 30_000);

  it.each([
    'height:0',
    'height:200px',
  ])('preserves painted absolute descendants and global stacking through a non-stacking wrapper (%s)', async (height) => {
    const model = await render(
      '<div id="wrapper"><div id="red"></div></div><div id="blue"></div>',
      `
      #wrapper{${height};width:200px}
      #red,#blue{position:absolute;left:50px;top:50px;width:100px;height:100px}
      #red{z-index:10;background:red}#blue{z-index:1;background:blue}
    `,
    );
    expect(await pixel(model.elements, 80, 80)).toEqual([255, 0, 0, 255]);
  }, 30_000);

  it.each([
    false,
    true,
  ])('preserves DOM order between translucent decoration and z-index:auto content (overlay last: %s)', async (overlayLast) => {
    const grid = '<div id="grid"></div>';
    const inner = '<div id="inner"><p>Editable poster text</p></div>';
    const model = await render(
      overlayLast ? inner + grid : grid + inner,
      `
      #grid{position:absolute;left:60px;top:60px;width:240px;height:180px;opacity:.5;pointer-events:none;background:linear-gradient(red,red)}
      #inner{position:relative;width:240px;height:180px;background:blue}
    `,
    );
    const imageIndex = model.elements.findIndex((e) => e.type === 'image');
    const textIndex = model.elements.findIndex((e) => e.type === 'text');
    expect(
      texts(model)
        .map((e) => e.text)
        .join(' '),
    ).toBe('Editable poster text');
    expect(imageIndex).toBeGreaterThan(-1);
    expect(imageIndex > textIndex).toBe(overlayLast);
    const color = await pixel(model.elements, 80, 80);
    if (overlayLast) {
      expect(color[0]).toBeGreaterThan(120);
      expect(color[2]).toBeGreaterThan(120);
    } else expect(color).toEqual([0, 0, 255, 255]);
  }, 30_000);

  it('does not isolate high-z descendants inside a positioned z-index:auto wrapper', async () => {
    const model = await render(
      '<div id="wrapper"><div id="red"></div></div><div id="blue"></div>',
      `
      #wrapper{position:relative;width:200px;height:200px}
      #red,#blue{position:absolute;left:0;top:0;width:100px;height:100px}
      #red{background:red;z-index:10}#blue{left:60px;top:60px;background:blue;z-index:1}
    `,
    );
    expect(await pixel(model.elements, 80, 80)).toEqual([255, 0, 0, 255]);
  }, 30_000);

  it('retains the visible extent of a generated gradient outside its host border box', async () => {
    const model = await render(
      '<div id="host"></div>',
      `
      #host{position:absolute;left:100px;top:100px;width:100px;height:100px}
      #host::before{content:"";position:absolute;left:-20px;top:-20px;width:140px;height:140px;background:linear-gradient(red,red)}
    `,
    );
    expect(await pixel(model.elements, 85, 85)).toEqual([255, 0, 0, 255]);
    expect(await pixel(model.elements, 215, 215)).toEqual([255, 0, 0, 255]);
  }, 30_000);
});
