import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { findSystemChrome } from '@open-codesign/exporters';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';

/** The system Chrome the browser tests drive, or null when there is none and they skip. */
export const chrome = await findSystemChrome().catch(() => null);

export const DESKTOP = { width: 1280, height: 800 } as const;

/**
 * One browser for the tests in a `describe`, and a fresh page at desktop size
 * for each of them, with every request aborted so the page is only what the test sets.
 */
export function useChromePage(name: string): {
  page: () => Page;
  mount: (markup: string) => Promise<void>;
} {
  let browser: Browser;
  let page: Page;
  let profile: string;

  beforeAll(async () => {
    if (!chrome) throw new Error('System Chrome unavailable');
    profile = resolve(`.${name}-${randomUUID()}`);
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

  return {
    page: () => page,
    mount: (markup) =>
      page.setContent(
        `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}</style></head><body>${markup}</body></html>`,
      ),
  };
}
