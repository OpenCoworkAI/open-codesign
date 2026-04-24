/**
 * `runPreview` — host executor for the core `preview` tool.
 *
 * Separate from `done-verify.ts` on purpose: `done` renders agent JSX through
 * Electron's hidden BrowserWindow + `buildSrcdoc` (React+Babel wrapper), while
 * `preview` loads an already-standalone workspace artifact file in a
 * puppeteer-core page. Keeping the two paths separate lets preview's wire
 * shape (screenshot + metrics) evolve without perturbing done's lint +
 * console contract.
 *
 * Reuses `findSystemChrome` from `@open-codesign/exporters` so we match the
 * PDF exporter's discovery rules (no bundled Chromium — PRINCIPLES §1).
 */

import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { PreviewResult } from '@open-codesign/core';
import { findSystemChrome } from '@open-codesign/exporters';
import type { Browser, ConsoleMessage, HTTPRequest, HTTPResponse, Page } from 'puppeteer-core';

export interface RunPreviewOptions {
  path: string;
  vision: boolean;
  workspaceRoot: string;
}

const LOAD_TIMEOUT_MS = 5000;
const SETTLE_AFTER_LOAD_MS = 800;
const MAX_CONSOLE_ENTRIES = 50;
const MAX_ASSET_ERRORS = 20;
const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;

export async function runPreview(opts: RunPreviewOptions): Promise<PreviewResult> {
  const absWorkspace = resolve(opts.workspaceRoot);
  const absPath = resolve(absWorkspace, opts.path);
  // Path-escape guard: the agent passes workspace-relative paths, but a crafted
  // `../../etc/passwd` would otherwise resolve outside the sandbox and serve
  // whatever the main-process user can read.
  if (absPath !== absWorkspace && !absPath.startsWith(absWorkspace + sep)) {
    return emptyFail(`path "${opts.path}" escapes workspace root`);
  }

  try {
    await readFile(absPath, 'utf8');
  } catch (err) {
    return emptyFail(`read failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  let executablePath: string;
  try {
    executablePath = await findSystemChrome();
  } catch (err) {
    return emptyFail(
      `system Chrome unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const puppeteer = (await import('puppeteer-core')).default;

  const consoleErrors: PreviewResult['consoleErrors'] = [];
  const assetErrors: PreviewResult['assetErrors'] = [];
  const startTs = Date.now();
  let browser: Browser | null = null;
  let page: Page | null = null;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    page = await browser.newPage();
    await page.setViewport(DEFAULT_VIEWPORT);

    page.on('console', (msg: ConsoleMessage) => {
      if (consoleErrors.length >= MAX_CONSOLE_ENTRIES) return;
      const level = mapConsoleLevel(msg.type());
      if (level === null) return;
      consoleErrors.push({ level, message: msg.text() });
    });
    page.on('pageerror', (err: unknown) => {
      if (consoleErrors.length >= MAX_CONSOLE_ENTRIES) return;
      const message = err instanceof Error ? err.message : String(err);
      consoleErrors.push({ level: 'error', message });
    });
    page.on('requestfailed', (req: HTTPRequest) => {
      if (assetErrors.length >= MAX_ASSET_ERRORS) return;
      const type = req.resourceType();
      assetErrors.push({ url: req.url(), status: 0, ...(type ? { type } : {}) });
    });
    page.on('response', (res: HTTPResponse) => {
      const status = res.status();
      if (status < 400 || assetErrors.length >= MAX_ASSET_ERRORS) return;
      const type = res.request().resourceType();
      assetErrors.push({ url: res.url(), status, ...(type ? { type } : {}) });
    });

    // file:// so relative asset references resolve against the workspace.
    const fileUrl = `file://${absPath}`;
    await page.goto(fileUrl, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS });
    await new Promise<void>((r) => setTimeout(r, SETTLE_AFTER_LOAD_MS));

    const metrics = await page.evaluate(() => {
      // Runs in the browser; DOM globals are defined at call time.
      // @ts-expect-error browser context
      const rect = document.documentElement.getBoundingClientRect();
      return {
        // @ts-expect-error browser context
        nodes: document.querySelectorAll('*').length,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    });

    const result: PreviewResult = {
      ok: consoleErrors.length === 0 && assetErrors.length === 0,
      consoleErrors,
      assetErrors,
      metrics: {
        nodes: metrics.nodes,
        width: metrics.width,
        height: metrics.height,
        loadMs: Date.now() - startTs,
      },
    };

    if (opts.vision) {
      const png = await page.screenshot({ type: 'png', encoding: 'base64' });
      result.screenshot = `data:image/png;base64,${png}`;
    } else {
      result.domOutline = await page.evaluate(() => {
        // Runs in the browser. Re-declare the minimal DOM surface we need
        // locally instead of depending on the DOM lib in the main-process
        // tsconfig.
        interface El {
          tagName: string;
          id: string;
          classList: { length: number } & Iterable<string>;
          children: Iterable<El>;
        }
        function outline(el: El, depth: number, maxDepth: number): string {
          const indent = '  '.repeat(depth);
          const tag = el.tagName.toLowerCase();
          const idPart = el.id ? `#${el.id}` : '';
          const clsPart =
            el.classList.length > 0 ? `.${Array.from(el.classList).slice(0, 2).join('.')}` : '';
          const self = `${indent}${tag}${idPart}${clsPart}`;
          if (depth >= maxDepth) return self;
          const kids = Array.from(el.children).slice(0, 20);
          const children = kids.map((c) => outline(c, depth + 1, maxDepth)).join('\n');
          return children.length > 0 ? `${self}\n${children}` : self;
        }
        // @ts-expect-error browser context
        return outline(document.documentElement as unknown as El, 0, 4);
      });
    }
    return result;
  } catch (err) {
    return {
      ok: false,
      consoleErrors,
      assetErrors,
      metrics: { nodes: 0, width: 0, height: 0, loadMs: Date.now() - startTs },
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    try {
      if (page) await page.close();
    } catch {
      /* noop */
    }
    try {
      if (browser) await browser.close();
    } catch {
      /* noop */
    }
  }
}

function mapConsoleLevel(raw: string): PreviewResult['consoleErrors'][number]['level'] | null {
  switch (raw) {
    case 'error':
      return 'error';
    case 'warning':
    case 'warn':
      return 'warn';
    case 'info':
      return 'info';
    case 'log':
      return 'log';
    default:
      return null;
  }
}

function emptyFail(reason: string): PreviewResult {
  return {
    ok: false,
    consoleErrors: [],
    assetErrors: [],
    metrics: { nodes: 0, width: 0, height: 0, loadMs: 0 },
    reason,
  };
}
