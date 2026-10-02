import { findSystemChrome } from '@open-codesign/exporters';
import {
  buildInteractivePreviewDocument,
  INTERACTIVE_PREVIEW_SANDBOX,
} from '@open-codesign/runtime';
import puppeteer, { type Browser } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const chrome = await findSystemChrome().catch(() => null);

describe.skipIf(!chrome)('interactive preview screens in system Chrome', () => {
  let browser: Browser;

  beforeAll(async () => {
    if (!chrome) throw new Error('System Chrome unavailable');
    browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
  }, 30_000);

  it('hides grid/flex screens, preserves their layout and state, and handles later screens', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<iframe title="screens"></iframe>');
      await page.$eval(
        'iframe',
        (node, options) => {
          node.sandbox.value = options.sandbox;
          node.srcdoc = options.document;
        },
        {
          sandbox: INTERACTIVE_PREVIEW_SANDBOX,
          document: buildInteractivePreviewDocument(
            '<!doctype html><html><head><style>[data-oc-screen]{display:grid;gap:12px;}</style></head><body><nav><a href="#home">Home</a><a href="#pricing">Pricing</a></nav><section id="home" data-oc-screen="home"><input value="draft"></section><section id="pricing" data-oc-screen="pricing" style="display:flex;gap:8px;">Pricing<a id="back" href="#home">Back to home</a></section></body></html>',
            { path: 'index.html' },
          ),
        },
      );
      const frame = await (await page.$('iframe'))?.contentFrame();
      if (!frame) throw new Error('Missing screen preview frame');
      await frame.waitForSelector('#home', { visible: true });
      await frame.waitForSelector('#pricing', { hidden: true });
      expect(
        await frame.evaluate(() => document.documentElement.hasAttribute('data-oc-screen')),
      ).toBe(false);
      await frame.type('#home input', ' kept');
      await frame.click('a[href="#pricing"]');
      await frame.waitForSelector('#home', { hidden: true });
      expect(await frame.evaluate(() => document.activeElement?.getAttribute('href'))).toBe(
        '#pricing',
      );
      expect(await frame.$eval('#pricing', (node) => getComputedStyle(node).display)).toBe('flex');
      expect(
        await frame.$eval('nav', (node) => node.getBoundingClientRect().height),
      ).toBeGreaterThan(0);
      await frame.focus('#back');
      await page.keyboard.press('Enter');
      await frame.waitForSelector('#pricing', { hidden: true });
      expect(await frame.evaluate(() => document.activeElement?.id)).toBe('home');
      expect(await frame.$eval('#home', (node) => node.getAttribute('tabindex'))).toBe('-1');
      await frame.focus('nav a[href="#home"]');
      expect(await frame.$eval('#home', (node) => node.hasAttribute('tabindex'))).toBe(false);
      expect(await frame.$eval('#home', (node) => getComputedStyle(node).display)).toBe('grid');
      expect(
        await frame.$eval('#home input', (node) => (node as HTMLInputElement).value),
      ).toContain('kept');
      await frame.$eval('#home', (node) => node.setAttribute('tabindex', '0'));
      await frame.click('nav a[href="#pricing"]');
      await frame.focus('#back');
      await page.keyboard.press('Enter');
      expect(await frame.evaluate(() => document.activeElement?.id)).toBe('home');
      await frame.focus('nav a[href="#home"]');
      expect(await frame.$eval('#home', (node) => node.getAttribute('tabindex'))).toBe('0');
      await frame.evaluate(() => {
        const later = document.createElement('section');
        later.id = 'later';
        later.setAttribute('data-oc-screen', 'later');
        later.textContent = 'Later screen';
        document.body.appendChild(later);
      });
      await frame.waitForSelector('#later', { hidden: true });
      await frame.$eval('#home', (node) => node.remove());
      await frame.waitForSelector('#pricing', { visible: true });
      expect(await frame.evaluate(() => location.hash)).toBe('');
    } finally {
      await page.close();
    }
  }, 30_000);
});
