import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { findSystemChrome } from '@open-codesign/exporters';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { inspectLayout, MAX_PROBE_ELEMENTS, PHONE_VIEWPORT } from './layout-probe';

const chrome = await findSystemChrome().catch(() => null);
const DESKTOP = { width: 1280, height: 800 };
const LONG_TEXT = 'Long text that wraps over several lines and is cut off by its box. '.repeat(6);

describe.skipIf(!chrome)('layout checks in system Chrome', () => {
  let browser: Browser;
  let page: Page;
  let profile: string;

  beforeAll(async () => {
    if (!chrome) throw new Error('System Chrome unavailable');
    profile = resolve(`.layout-probe-browser-${randomUUID()}`);
    mkdirSync(profile);
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      userDataDir: profile,
      args: ['--disable-background-networking'],
    });
  }, 30_000);

  afterAll(async () => {
    try {
      await browser?.close();
    } finally {
      if (profile) rmSync(profile, { recursive: true, force: true });
    }
  }, 30_000);

  beforeEach(async () => {
    page = await browser.newPage();
    await page.setViewport(DESKTOP);
    await page.setRequestInterception(true);
    page.on('request', (request) => void request.abort());
  });

  afterEach(async () => {
    await page?.close();
  });

  const mount = (body: string, head = '') =>
    page.setContent(
      `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}${head}</style></head><body>${body}</body></html>`,
    );

  describe('horizontal overflow', () => {
    it('names the element that scrolls the page sideways, at phone width only', async () => {
      await mount(
        '<main><table id="prices" style="width:800px"><tr><td>Plan</td><td>Price</td></tr></table></main>',
      );

      const { issues, notes } = await inspectLayout(page);

      expect(notes).toEqual([]);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        check: 'horizontal-overflow',
        viewportWidth: PHONE_VIEWPORT.width,
        selector: 'table#prices',
        measured: 800,
        limit: PHONE_VIEWPORT.width,
      });
      expect(issues[0]?.message).toContain('table#prices reaches 800 px');
    });

    it('puts the viewport back after measuring', async () => {
      await mount('<main>Hello</main>');

      await inspectLayout(page);

      expect(page.viewport()).toMatchObject(DESKTOP);
    });

    it('reports nothing for a page that reflows to fit', async () => {
      await mount(
        '<div class="row"><div class="card">One</div><div class="card">Two</div><div class="card">Three</div></div>',
        '.row{display:flex;flex-wrap:wrap}.card{width:200px;height:80px}',
      );

      expect((await inspectLayout(page)).issues).toEqual([]);
    });

    it('does not blame content inside a container that scrolls on its own', async () => {
      await mount(
        '<div style="overflow-x:auto"><div style="width:1200px;height:20px">Wide strip</div></div>',
      );

      expect((await inspectLayout(page)).issues).toEqual([]);
    });

    it('names the element that really overflows, not a wider one inside a scroller', async () => {
      await mount(
        `<div style="overflow-x:auto"><div id="strip" style="width:1200px;height:20px">Wide strip</div></div>
         <div id="banner" style="width:800px;height:20px">Banner</div>`,
      );

      const { issues } = await inspectLayout(page);

      expect(issues.map((issue) => issue.selector)).toEqual(['div#banner']);
    });

    it('does not report overflow the page hides from the user', async () => {
      await mount('<div style="width:800px;height:20px">Wide</div>', 'body{overflow-x:hidden}');

      expect((await inspectLayout(page)).issues).toEqual([]);
    });

    it('ignores a fixed-position element, which cannot scroll the page', async () => {
      await mount(
        `<div style="position:fixed;left:0;width:2000px;height:10px"></div>
         <div id="banner" style="width:800px;height:20px">Banner</div>`,
      );

      const { issues } = await inspectLayout(page);

      expect(issues.map((issue) => issue.selector)).toEqual(['div#banner']);
    });

    it('names at most three elements and keeps the widest first', async () => {
      const boxes = [500, 900, 600, 700, 800]
        .map((width) => `<div id="w${width}" style="width:${width}px;height:10px"></div>`)
        .join('');
      await mount(`<main>${boxes}</main>`);

      const { issues } = await inspectLayout(page);

      expect(issues.map((issue) => issue.measured)).toEqual([900, 800, 700]);
    });
  });

  describe('clipped text', () => {
    const clippedAt = async (markup: string, head = '') => {
      await mount(markup, head);
      return (await inspectLayout(page)).issues.filter((issue) => issue.check === 'clipped-text');
    };

    it('reports text that a fixed-height box cuts off, with a path to the element', async () => {
      const issues = await clippedAt(
        `<section><div class="note highlighted extra" style="width:100px;height:20px;overflow:hidden">${LONG_TEXT}</div></section>`,
      );

      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]).toMatchObject({
        check: 'clipped-text',
        viewportWidth: DESKTOP.width,
        selector: 'section > div.note.highlighted',
      });
      expect(issues[0]?.measured).toBeGreaterThan(issues[0]?.limit ?? Number.POSITIVE_INFINITY);
    });

    it('ends the path at an element with an id and otherwise keeps three levels', async () => {
      const issues = await clippedAt(
        `<div><div><div><p id="deep" style="width:100px;height:20px;overflow:hidden">${LONG_TEXT}</p></div></div></div>`,
      );

      expect(issues[0]?.selector).toBe('p#deep');
      const unnamed = await clippedAt(
        `<div><div><div><div><p style="width:100px;height:20px;overflow:hidden">${LONG_TEXT}</p></div></div></div></div>`,
      );
      expect(unnamed[0]?.selector).toBe('… > div > div > p');
    });

    it('leaves text alone that fits its box', async () => {
      expect(
        await clippedAt('<div style="width:300px;height:40px;overflow:hidden">Short</div>'),
      ).toEqual([]);
    });

    it.each([
      [
        'an ellipsis',
        `<div style="width:80px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${LONG_TEXT}</div>`,
      ],
      [
        'a line clamp',
        `<p style="width:200px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${LONG_TEXT}</p>`,
      ],
      ['a collapsed panel', '<div style="height:0;overflow:hidden">Answer behind a toggle</div>'],
      [
        'a running animation',
        `<div style="width:100px;white-space:nowrap;overflow:hidden;animation:slide 5s linear infinite">${LONG_TEXT}</div>`,
      ],
    ])('treats %s as intended', async (_label, markup) => {
      expect(
        await clippedAt(
          markup,
          '@keyframes slide{from{transform:translateX(0)}to{transform:translateX(-100px)}}',
        ),
      ).toEqual([]);
    });

    it('names at most five clipped texts per viewport', async () => {
      const boxes = Array.from(
        { length: 8 },
        (_, index) =>
          `<div id="box${index}" style="width:100px;height:20px;overflow:hidden">${LONG_TEXT}</div>`,
      ).join('');

      const issues = await clippedAt(boxes);

      // Five at each of the two widths.
      expect(issues).toHaveLength(10);
      expect(issues.filter((issue) => issue.viewportWidth === DESKTOP.width)).toHaveLength(5);
    });
  });

  it('says so when the page has more elements than it measures', async () => {
    await mount(Array.from({ length: MAX_PROBE_ELEMENTS + 100 }, () => '<i></i>').join(''));

    const { notes } = await inspectLayout(page);

    expect(notes).toEqual([
      `Layout checks stopped after ${MAX_PROBE_ELEMENTS.toLocaleString('en-US')} elements; the rest of the page was not measured.`,
    ]);
  });
});
