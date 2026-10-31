import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer, { type Browser, type HTTPRequest, type Page } from 'puppeteer-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { findSystemChrome } from './chrome-discovery';
import { setExportPageContent } from './rendered-html';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('export network-idle compatibility', () => {
  let browser: Browser;
  let page: Page;
  let directory: string;
  let pending: HTTPRequest[];

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'codesign-export-wait-'));
    browser = await puppeteer.launch({
      executablePath: await findSystemChrome(),
      headless: true,
      userDataDir: directory,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  }, 30_000);

  beforeEach(async () => {
    pending = [];
    page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (request) => pending.push(request));
  });

  afterEach(async () => {
    await Promise.allSettled(
      pending
        .filter((request) => !request.isInterceptResolutionHandled())
        .map((request) => request.abort()),
    );
    await page.close();
  });

  afterAll(async () => {
    await browser?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it.each([
    'networkidle0',
    'networkidle2',
  ] as const)('honors %s when DOM readiness precedes outstanding image requests', async (waitUntil) => {
    let complete = false;
    const loading = setExportPageContent(
      page,
      '<!doctype html><img src="https://assets.invalid/one.png"><img src="https://assets.invalid/two.png"><img src="https://assets.invalid/three.png">',
      { waitUntil, renderTimeoutMs: 5_000 },
    ).then(() => {
      complete = true;
    });
    await expect.poll(() => pending.length).toBe(3);
    expect(complete).toBe(false);
    const count = waitUntil === 'networkidle0' ? 3 : 1;
    await Promise.all(
      pending
        .slice(0, count)
        .map((request) => request.respond({ status: 200, contentType: 'image/png', body: png })),
    );
    await loading;
    expect(complete).toBe(true);
    expect(pending.filter((request) => !request.isInterceptResolutionHandled())).toHaveLength(
      waitUntil === 'networkidle0' ? 0 : 2,
    );
  }, 10_000);
});
