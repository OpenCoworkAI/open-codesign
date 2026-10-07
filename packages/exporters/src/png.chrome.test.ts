import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findSystemChrome } from './chrome-discovery';
import { EXPAND_DECK_SCRIPT, exportPng } from './png';

let tempDir = '';

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'codesign-png-chrome-test-'));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

async function layoutInChrome(html: string) {
  const browser = await puppeteer.launch({
    executablePath: await findSystemChrome(),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setContent(html, { waitUntil: 'load' });
    const laidOut = await page.evaluate(EXPAND_DECK_SCRIPT);
    const tops = await page.$$eval('section', (sections) =>
      sections
        .filter((section) => section.getBoundingClientRect().height > 0)
        .map((section) => section.getBoundingClientRect().top + window.scrollY),
    );
    return { laidOut, tops };
  } finally {
    await browser.close();
  }
}

describe.runIf(process.env['CODESIGN_EXPORT_BROWSER_TESTS'] === '1')(
  'PNG deck layout in system Chrome',
  () => {
    it('stacks every slide of the built-in 16:9 deck scaffold', async () => {
      const scaffold = readFileSync(
        new URL(
          '../../../apps/desktop/resources/templates/scaffolds/decks/slide-16-9.html',
          import.meta.url,
        ),
        'utf8',
      );

      const { laidOut, tops } = await layoutInChrome(scaffold);

      expect(laidOut).toBe(2);
      expect(tops).toHaveLength(2);
      expect(tops[0]).toBeGreaterThanOrEqual(0);
      expect(tops[1]).toBeGreaterThan(tops[0] ?? 0);
    }, 60_000);

    it('leaves pages whose sections are all visible unchanged', async () => {
      const page = `<main>${'<section style="height:160px">Task</section>'.repeat(3)}</main>`;

      const { laidOut, tops } = await layoutInChrome(page);

      expect(laidOut).toBe(0);
      expect(tops).toHaveLength(3);
    }, 60_000);

    it('captures the full height of a long stacked deck', async () => {
      const slides = Array.from(
        { length: 20 },
        (_, i) =>
          `<section class="slide"${i === 0 ? ' data-active="true"' : ''}>${i + 1}</section>`,
      ).join('');
      const html = `<!doctype html><html><head><style>
        body { margin: 0; display: grid; place-items: center; height: 100%; }
        .deck { width: 1200px; aspect-ratio: 16 / 9; position: relative; }
        .slide { position: absolute; inset: 0; display: none; }
        .slide[data-active="true"] { display: block; }
      </style></head><body><main class="deck">${slides}</main></body></html>`;
      const dest = join(tempDir, 'long-deck.png');

      await exportPng(html, dest, { sourcePath: 'deck.html' });

      // 24px top padding, then 20 slides of 675px each followed by a 24px gap, at 2x.
      expect(readFileSync(dest).readUInt32BE(20)).toBe((24 + 20 * (675 + 24)) * 2);
    }, 120_000);
  },
);
