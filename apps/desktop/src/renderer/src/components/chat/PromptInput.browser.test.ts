import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { findSystemChrome } from '@open-codesign/exporters';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { build, type PreviewServer, preview } from 'vite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {} from './__fixtures__/active-message-browser';

const chrome = await findSystemChrome().catch(() => null);

describe.skipIf(!chrome)('active composer fake gate in system Chrome', () => {
  let browser: Browser;
  let server: PreviewServer;
  let page: Page;
  let endpoint: string;
  let directory: string;
  const fixture = 'src/renderer/src/components/chat/__fixtures__/active-message-browser.html';
  const externalRequests: string[] = [];
  const browserErrors: string[] = [];

  beforeAll(async () => {
    if (!chrome) throw new Error('System Chrome unavailable');
    directory = await mkdtemp(join(tmpdir(), 'codesign-active-composer-'));
    const outDir = join(directory, 'site');
    // Build before navigation so cold dev-server optimization cannot invalidate
    // an in-flight dependency and leave the first page unmounted.
    await build({
      configFile: false,
      root: process.cwd(),
      logLevel: 'error',
      esbuild: { jsx: 'automatic' },
      build: { outDir, target: 'esnext', rollupOptions: { input: resolve(fixture) } },
    });
    server = await preview({
      configFile: false,
      root: process.cwd(),
      logLevel: 'error',
      build: { outDir },
      preview: { host: '127.0.0.1', port: 0 },
      plugins: [
        {
          name: 'active-message-component-fixture',
          configurePreviewServer(vite) {
            vite.middlewares.use((req, res, next) => {
              if (req.url !== '/favicon.ico') return next();
              res.statusCode = 204;
              res.end();
            });
          },
        },
      ],
    });
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server unavailable');
    endpoint = `http://127.0.0.1:${address.port}/${fixture}`;
    expect((await fetch(endpoint)).ok).toBe(true);
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      userDataDir: join(directory, 'profile'),
    });
  }, 60_000);

  beforeEach(async () => {
    externalRequests.length = 0;
    browserErrors.length = 0;
    page = await browser.newPage();
    page.on('pageerror', (error) => browserErrors.push(String(error)));
    const diagnostics: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') diagnostics.push(message.text());
    });
    page.on('requestfailed', (request) => {
      diagnostics.push(`${request.url()}: ${request.failure()?.errorText}`);
    });
    page.on('response', (response) => {
      if (response.status() >= 400)
        diagnostics.push(`${response.status()} ${response.statusText()}: ${response.url()}`);
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (new URL(request.url()).origin === new URL(endpoint).origin) {
        void request.continue();
      } else {
        externalRequests.push(request.url());
        void request.abort();
      }
    });
    try {
      await page.goto(endpoint);
      await page.waitForSelector('textarea');
    } catch (cause) {
      throw new Error(
        `Composer fixture failed to mount:\n${[...browserErrors, ...diagnostics].join('\n')}`,
        { cause },
      );
    }
  }, 60_000);

  afterEach(async () => {
    await page?.close();
    expect(externalRequests).toEqual([]);
    expect(browserErrors).toEqual([]);
  });

  afterAll(async () => {
    try {
      await browser?.close();
    } finally {
      try {
        await server?.close();
      } finally {
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    }
  }, 30_000);

  async function snapshot() {
    return page.evaluate(() => window.activeMessageFixture.snapshot());
  }
  async function clickButton(text: string) {
    for (const button of await page.$$('button')) {
      if (
        (await button.evaluate((node) => node.getAttribute('aria-label') ?? node.textContent)) ===
        text
      ) {
        await button.click();
        return;
      }
    }
    throw new Error(`Missing button: ${text}`);
  }

  it.each([
    'en',
    'zh-CN',
    'es',
    'pt-BR',
  ])('keeps %s running controls compact with production CSS at narrow widths', async (locale) => {
    for (const width of [260, 300]) {
      await page.setViewport({ width, height: 540, deviceScaleFactor: 1.5 });
      await page.goto(`${endpoint}?locale=${locale}`);
      await page.waitForSelector('textarea');
      const emptyHeight = await page.$eval('form', (node) => node.getBoundingClientRect().height);
      expect(emptyHeight).toBeLessThanOrEqual(130);
      expect(await page.$('.codesign-active-message-actions')).toBeNull();
      expect(await page.$('.codesign-active-message-help')).toBeNull();
      expect(await page.$eval('textarea', (node) => node.value)).toBe('');
      expect(await page.$('form button[type="button"]')).not.toBeNull();
      await page.type('textarea', ' ');
      expect(await page.$('.codesign-active-message-actions')).toBeNull();
      await page.type('textarea', 'Additional instruction');
      await page.waitForSelector('.codesign-active-message-actions');
      const geometry = await page.evaluate(() => {
        const form = document.querySelector('form');
        const textarea = document.querySelector('textarea');
        const help = document.querySelector<HTMLDetailsElement>('.codesign-active-message-help');
        if (!form || !textarea || !help) throw new Error('Missing composer');
        return {
          height: form.getBoundingClientRect().height,
          width: form.getBoundingClientRect().width,
          scrollWidth: form.scrollWidth,
          font: getComputedStyle(textarea).fontSize,
          helpOpen: help.open,
          helpHeight: help.querySelector('summary')?.getBoundingClientRect().height,
          buttons: [...document.querySelectorAll('.codesign-active-message-button')].map(
            (button) => ({
              height: button.getBoundingClientRect().height,
              right: button.getBoundingClientRect().right,
              font: getComputedStyle(button).fontSize,
            }),
          ),
        };
      });
      expect(geometry.height).toBeLessThanOrEqual(180);
      expect(geometry.scrollWidth).toBeLessThanOrEqual(Math.ceil(geometry.width));
      expect(geometry.font).toBe('15px');
      expect(geometry.helpOpen).toBe(false);
      expect(geometry.helpHeight).toBe(32);
      expect(
        await page.$eval('.codesign-active-message-help-panel', (node) => node.checkVisibility()),
      ).toBe(false);
      expect(geometry.buttons).toHaveLength(2);
      for (const button of geometry.buttons) {
        expect(button.height).toBe(40);
        expect(button.right).toBeLessThanOrEqual(width);
        expect(button.font).toBe('13px');
      }
      await page.focus('.codesign-active-message-help > summary');
      await page.keyboard.press('Enter');
      expect(
        await page.$eval('.codesign-active-message-help', (node) => node.hasAttribute('open')),
      ).toBe(true);
      const expanded = await page.evaluate(() => ({
        formHeight: document.querySelector('form')?.getBoundingClientRect().height,
        panelHeight: document
          .querySelector('.codesign-active-message-help-panel')
          ?.getBoundingClientRect().height,
      }));
      expect(expanded.formHeight).toBe(geometry.height);
      expect(expanded.panelHeight).toBeLessThanOrEqual(216);
      await page.focus('.codesign-active-message-help-panel');
      await page.keyboard.press('Escape');
      expect(
        await page.$eval('.codesign-active-message-help', (node) => node.hasAttribute('open')),
      ).toBe(false);
      expect(
        await page.$eval(
          '.codesign-active-message-help > summary',
          (node) => document.activeElement === node,
        ),
      ).toBe(true);
      await page.focus('textarea');
      await page.keyboard.down('Control');
      await page.keyboard.press('A');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await page.waitForSelector('.codesign-active-message-actions', { hidden: true });
      expect(await page.$('.codesign-active-message-help')).toBeNull();
      expect(await page.$eval('form', (node) => node.getBoundingClientRect().height)).toBe(
        emptyHeight,
      );
      expect(await page.$eval('textarea', (node) => document.activeElement === node)).toBe(true);
      expect((await snapshot()).calls).toHaveLength(0);
      expect((await snapshot()).draft).toBe('');
    }
  }, 30_000);

  it('normal Send clears the selected draft and enters a compact empty running state', async () => {
    await page.goto(`${endpoint}?idle=1`);
    await page.waitForSelector('textarea');
    await page.evaluate(() => window.activeMessageFixture.switchDesign('other-design'));
    await page.type('textarea', 'Keep the other design draft');
    await page.evaluate(() => window.activeMessageFixture.switchDesign('browser-design'));
    await page.type('textarea', '  Original prompt  ');
    await page.click('button[type="submit"]');
    await page.waitForSelector('button[aria-label^="Stop"]');
    const state = await snapshot();
    expect(state.generateCalls).toBe(1);
    expect(state.generatedPrompts).toEqual(['Original prompt']);
    expect(state.draft).toBe('');
    expect(state.drafts['other-design']).toBe('Keep the other design draft');
    expect(state.calls).toHaveLength(0);
    expect(state.rows).toHaveLength(0);
    expect(await page.$('.codesign-active-message-actions')).toBeNull();
    expect(await page.$('.codesign-active-message-help')).toBeNull();
    expect(
      await page.$eval('form', (node) => node.getBoundingClientRect().height),
    ).toBeLessThanOrEqual(130);
  });

  it.each([
    'Queue follow-up',
    'Steer next step',
  ])('restores textarea focus when accepted %s removes the focused control', async (label) => {
    await page.type('textarea', 'Explicit additional message');
    await clickButton(label);
    await page.waitForFunction(() => window.activeMessageFixture.snapshot().calls.length === 1);
    await page.evaluate(() => window.activeMessageFixture.accept(0));
    await page.waitForSelector('.codesign-active-message-actions', { hidden: true });
    expect((await snapshot()).draft).toBe('');
    expect(await page.$eval('textarea', (node) => document.activeElement === node)).toBe(true);
    await page.keyboard.type('Next instruction');
    expect((await snapshot()).draft).toBe('Next instruction');
    expect(await page.$('.codesign-active-message-help')).not.toBeNull();
    expect(
      await page.$eval('.codesign-active-message-help', (node) => node.hasAttribute('open')),
    ).toBe(false);
  });

  it('does not steal focus after the user moves elsewhere before acceptance', async () => {
    await page.type('textarea', 'Explicit additional message');
    await clickButton('Steer next step');
    await page.waitForFunction(() => window.activeMessageFixture.snapshot().calls.length === 1);
    await page.type('input[aria-label="Other field"]', 'Unrelated edit');
    await page.evaluate(() => window.activeMessageFixture.accept(0));
    await page.waitForSelector('.codesign-active-message-actions', { hidden: true });
    expect(await page.$eval('input', (node) => document.activeElement === node)).toBe(true);
    expect(await page.$eval('input', (node) => node.value)).toBe('Unrelated edit');
  });

  it('isolates design drafts and never focuses the new composer on a late ACK', async () => {
    await page.type('textarea', 'Message for the original design');
    await clickButton('Steer next step');
    await page.waitForFunction(() => window.activeMessageFixture.snapshot().calls.length === 1);
    await page.focus('input[aria-label="Other field"]');
    await page.evaluate(() => window.activeMessageFixture.switchDesign('other-design'));
    await page.waitForSelector('.codesign-active-message-actions', { hidden: true });
    expect(await page.$eval('textarea', (node) => document.activeElement === node)).toBe(false);
    await page.type('textarea', 'New design draft');
    await page.type('input[aria-label="Other field"]', 'Independent focus');
    await page.evaluate(() => window.activeMessageFixture.accept(0));
    await page.waitForFunction(() => window.activeMessageFixture.snapshot().draft === '');
    expect((await snapshot()).drafts['other-design']).toBe('New design draft');
    expect(await page.$eval('textarea', (node) => node.value)).toBe('New design draft');
    expect(await page.$eval('input', (node) => document.activeElement === node)).toBe(true);
  });

  it('keeps full validation arguments behind a bounded keyboard-accessible disclosure', async () => {
    await page.setViewport({ width: 300, height: 540 });
    await page.goto(`${endpoint}?diagnostic=1`);
    await page.waitForSelector('.codesign-error-details');
    expect(await page.$eval('.codesign-error-details', (node) => node.hasAttribute('open'))).toBe(
      false,
    );
    expect(
      await page.$eval('.codesign-error-details summary', (node) => node.textContent),
    ).toContain('must not have more than 16 items');
    expect(
      await page.$eval('.codesign-error-details summary', (node) => node.textContent),
    ).not.toContain('Received arguments:');
    await page.focus('.codesign-error-details summary');
    await page.keyboard.press('Enter');
    const detail = await page.$eval('.codesign-error-details pre', (node) => ({
      height: node.getBoundingClientRect().height,
      text: node.textContent,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
    }));
    expect(detail.height).toBeLessThanOrEqual(162);
    expect(detail.text).toContain('#check-16');
    expect(detail.scrollHeight).toBeGreaterThan(detail.clientHeight);
    await page.focus('.codesign-error-details pre');
    await page.keyboard.press('End');
    await page.waitForFunction(
      () => (document.querySelector('.codesign-error-details pre')?.scrollTop ?? 0) > 0,
    );
    expect((await snapshot()).calls).toHaveLength(0);
  });

  it('queues Enter, steers with the secondary control, and leaves Stop independent', async () => {
    await page.type('textarea', 'Queued from real Chrome');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.activeMessageFixture.snapshot().calls.length === 1);
    expect((await snapshot()).calls[0]).toMatchObject({
      mode: 'follow-up',
      designId: 'browser-design',
      generationId: 'browser-run',
      text: 'Queued from real Chrome',
    });
    await page.evaluate(() => window.activeMessageFixture.accept(0));
    await page.waitForFunction(() => window.activeMessageFixture.snapshot().draft === '');
    await page.type('textarea', 'Steer the next step');
    await clickButton('Steer next step');
    await page.waitForFunction(() => window.activeMessageFixture.snapshot().calls.length === 2);
    expect((await snapshot()).calls[1]?.mode).toBe('steer');
    await page.evaluate(() => window.activeMessageFixture.accept(1));
    await page.waitForFunction(() => window.activeMessageFixture.snapshot().draft === '');
    await page.click('button[aria-label^="Stop"]');
    await page.waitForFunction(() =>
      window.activeMessageFixture.snapshot().rows.every((row) => row.status === 'not-delivered'),
    );
    expect((await snapshot()).cancelCalls).toBe(1);
    expect((await snapshot()).generateCalls).toBe(0);
  });

  it('preserves IME and Shift+Enter, then queues Ctrl+Enter without a normal generation', async () => {
    await page.type('textarea', 'Composition');
    await page.$eval('textarea', (node) =>
      node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })),
    );
    await page.keyboard.press('Enter');
    await page.$eval('textarea', (node) =>
      node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })),
    );
    await page.keyboard.down('Shift');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Shift');
    expect((await snapshot()).calls).toHaveLength(0);
    expect(await page.$eval('textarea', (node) => node.value)).toContain('\n');
    await page.keyboard.down('Control');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Control');
    await page.waitForFunction(() => window.activeMessageFixture.snapshot().calls.length === 1);
    expect((await snapshot()).calls[0]?.mode).toBe('follow-up');
    expect((await snapshot()).generateCalls).toBe(0);
  });

  it('retains concurrent edits on acceptance and exposes rejection without losing the draft', async () => {
    await page.type('textarea', 'Original');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.activeMessageFixture.snapshot().calls.length === 1);
    await page.type('textarea', ' plus newer edit');
    await page.evaluate(() => window.activeMessageFixture.accept(0));
    await page.waitForFunction(
      () => !document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled,
    );
    expect((await snapshot()).draft).toBe('Original plus newer edit');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.activeMessageFixture.snapshot().calls.length === 2);
    await page.evaluate(() => window.activeMessageFixture.reject(1));
    await page.waitForFunction(() =>
      document.querySelector('output')?.textContent?.includes('Fake gate'),
    );
    expect((await snapshot()).draft).toBe('Original plus newer edit');
    expect((await snapshot()).generateCalls).toBe(0);
  });

  it.each([
    false,
    true,
  ])('preserves the draft on not-delivered outcome (event before ACK: %s)', async (eventBeforeAck) => {
    await page.type('textarea', 'Never discard an undelivered draft');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.activeMessageFixture.snapshot().calls.length === 1);
    await page.evaluate(
      (eventBeforeAck) => window.activeMessageFixture.settleUndelivered(0, eventBeforeAck),
      eventBeforeAck,
    );
    await page.waitForFunction(() =>
      document.querySelector('output')?.textContent?.includes('stopped before delivery'),
    );
    const state = await snapshot();
    expect(state.draft).toBe('Never discard an undelivered draft');
    expect(state.rows[0]?.status).toBe('not-delivered');
    expect(state.calls).toHaveLength(1);
    expect(state.generateCalls).toBe(0);
  });

  it.each(['file', 'comment', 'url'] as const)('never silently sends %s context', async (kind) => {
    await page.evaluate((kind) => window.activeMessageFixture.setContext(kind), kind);
    await page.type('textarea', 'Keep my context and draft');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() =>
      document.querySelector('output')?.textContent?.includes('text-only'),
    );
    const state = await snapshot();
    expect(state.calls).toHaveLength(0);
    expect(state.generateCalls).toBe(0);
    expect(state.draft).toBe('Keep my context and draft');
    if (kind === 'file') expect(state.files).toHaveLength(1);
    if (kind === 'comment') expect(state.comments).toEqual(['pending-comment']);
  });
});
