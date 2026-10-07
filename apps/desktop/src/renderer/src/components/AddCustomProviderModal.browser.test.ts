import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { findSystemChrome } from '@open-codesign/exporters';
import { PROVIDER_SHORTLIST } from '@open-codesign/shared';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {} from './__fixtures__/api-route-browser';

const chrome = await findSystemChrome().catch(() => null);

describe.skipIf(!chrome)('API Route renderer save flow in system Chrome', () => {
  let browser: Browser;
  let server: ViteDevServer;
  let page: Page;
  let endpoint: string;
  const profile = resolve(tmpdir(), `codesign-api-route-${randomUUID()}`);
  const errors: string[] = [];
  const externalRequests: string[] = [];

  beforeAll(async () => {
    if (!chrome) throw new Error('System Chrome unavailable');
    server = await createServer({
      configFile: false,
      root: process.cwd(),
      logLevel: 'error',
      esbuild: { jsx: 'automatic' },
      server: { host: '127.0.0.1', port: 0 },
      plugins: [
        {
          name: 'api-route-save-fixture',
          configureServer(vite) {
            vite.middlewares.use((req, res, next) => {
              if (req.url?.split('?')[0] !== '/api-route-fixture') return next();
              res.setHeader('Content-Type', 'text/html');
              res.end(
                '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/renderer/src/components/__fixtures__/api-route-browser.tsx"></script></body></html>',
              );
            });
          },
        },
      ],
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server unavailable');
    endpoint = `http://127.0.0.1:${address.port}/api-route-fixture`;
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      userDataDir: profile,
    });
  }, 60_000);

  beforeEach(async () => {
    errors.length = 0;
    externalRequests.length = 0;
    page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (new URL(request.url()).origin === new URL(endpoint).origin) void request.continue();
      else {
        externalRequests.push(request.url());
        void request.abort();
      }
    });
  });

  afterEach(async () => {
    await page?.close();
    expect(errors).toEqual([]);
    expect(externalRequests).toEqual([]);
  });

  afterAll(async () => {
    try {
      await browser?.close();
    } finally {
      await server?.close();
      await rm(profile, { recursive: true, force: true });
    }
  });

  async function clickButton(text: string) {
    for (const button of await page.$$('button')) {
      if ((await button.evaluate((node) => node.textContent?.trim())) === text) {
        await button.click();
        return;
      }
    }
    throw new Error(`Missing button: ${text}`);
  }

  it.each([
    true,
    false,
  ])('saves the builtin through %s menu mode with exact model ID', async (menu) => {
    await page.goto(`${endpoint}${menu ? '?menu' : ''}`);
    if (menu) {
      await page.waitForFunction(() =>
        [...document.querySelectorAll('button')].some(
          (button) => button.textContent?.trim() === 'Add provider',
        ),
      );
      await clickButton('Add provider');
      await page.waitForSelector('[role="menuitem"]');
      for (const button of await page.$$('[role="menuitem"]')) {
        const label = await button.$eval('span', (node) => node.textContent?.trim());
        if (label === PROVIDER_SHORTLIST['api-route'].label) {
          const helpUrl = await button.$eval('span:last-child', (node) => node.textContent?.trim());
          expect(helpUrl).toBe(PROVIDER_SHORTLIST['api-route'].keyHelpUrl);
          await button.click();
          break;
        }
      }
    }
    await page.waitForSelector('[role="dialog"] input[type="password"]');
    expect(
      await page.$eval('[role="dialog"] input[type="text"][disabled]', (node) => node.value),
    ).toBe('API Route');
    await page.type('[role="dialog"] input[type="password"]', '  fixture-key  ');
    const modelInput = '[role="dialog"] input[type="text"]:not([disabled])';
    await page.click(modelInput, { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type(modelInput, 'deepseek-v4.1-flash');
    await clickButton('Save & continue');
    await page.waitForFunction(() => window.apiRouteFixture.snapshot().saves.length === 1);
    const result = await page.evaluate(() => window.apiRouteFixture.snapshot());
    expect(result.saves).toEqual([
      {
        provider: 'api-route',
        apiKey: 'fixture-key',
        modelPrimary: 'deepseek-v4.1-flash',
        baseUrl: 'https://global.api-route.com/v1',
        setAsActive: menu,
      },
    ]);
    expect(result.customSaves).toBe(0);
    if (!menu) expect(result.onSaveCalls).toBe(1);
  }, 60_000);
});
