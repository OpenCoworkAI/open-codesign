/**
 * `runPreview` — host executor for the core `preview` tool.
 *
 * Separate from `done-verify.ts` on purpose: `done` renders agent JSX through
 * Electron's hidden BrowserWindow + `buildSrcdoc` (React+Babel wrapper), while
 * `preview` reads an already-standalone workspace artifact file, wraps JSX/TSX
 * through the same runtime builder used by the renderer, and loads the final
 * HTML in a puppeteer-core page. Keeping the two paths separate lets preview's
 * wire shape (screenshot + metrics) evolve without perturbing done's lint +
 * console contract.
 *
 * Reuses `findSystemChrome` from `@open-codesign/exporters` so we match the
 * PDF exporter's discovery rules (no bundled Chromium — PRINCIPLES §1).
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PreviewResult } from '@open-codesign/core';
import { findSystemChrome } from '@open-codesign/exporters';
import {
  buildPreviewDocument,
  findArtifactSourceReference,
  resolveArtifactSourceReferencePath,
} from '@open-codesign/runtime';
import type { Browser, ConsoleMessage, HTTPRequest, HTTPResponse, Page } from 'puppeteer-core';

export interface RunPreviewOptions {
  path: string;
  vision: boolean;
  workspaceRoot: string;
}

const LOAD_TIMEOUT_MS = 15_000;
const SETTLE_AFTER_LOAD_MS = 800;
const MAX_CONSOLE_ENTRIES = 50;
const MAX_ASSET_ERRORS = 20;
const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;

export async function runPreview(opts: RunPreviewOptions): Promise<PreviewResult> {
  const absWorkspace = resolve(opts.workspaceRoot);
  let source: string;
  let sourcePath = opts.path;
  try {
    source = await readPreviewSource(absWorkspace, opts.path);
    const reference = findArtifactSourceReference(source);
    const referencedPath =
      reference === null ? null : resolveArtifactSourceReferencePath(opts.path, reference);
    if (referencedPath !== null) {
      source = await readPreviewSource(absWorkspace, referencedPath);
      sourcePath = referencedPath;
    }
  } catch (err) {
    return emptyFail(err instanceof Error ? err.message : String(err));
  }

  let html: string;
  try {
    html = buildPreviewDocument(source, {
      path: sourcePath,
      baseHref: pathToFileURL(absWorkspace.endsWith(sep) ? absWorkspace : `${absWorkspace}${sep}`)
        .href,
    });
  } catch (err) {
    return emptyFail(err instanceof Error ? err.message : String(err));
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
  // Launch with an isolated, disposable user-data-dir. Without this puppeteer
  // tries to reuse the user's default Chrome profile; macOS's single-instance
  // handling then activates their running Chrome (bouncing the Dock icon)
  // instead of starting a headless worker. A per-call tmpdir plus
  // --headless=new keeps the launch invisible AND independent of whatever
  // Chrome windows the user has open.
  const userDataDir = await mkdtemp(join(tmpdir(), 'codesign-preview-'));
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      userDataDir,
      args: [
        '--headless=new',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        // Suppress "Chrome is not the default browser" and similar first-run
        // dialogs that would otherwise stall the launch handshake.
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    page = await browser.newPage();
    await page.setViewport(DEFAULT_VIEWPORT);

    page.on('console', (msg: ConsoleMessage) => {
      if (consoleErrors.length >= MAX_CONSOLE_ENTRIES) return;
      const message = msg.text();
      if (isRuntimeConsoleNoise(message)) return;
      const level = mapConsoleLevel(msg.type());
      if (level === null) return;
      consoleErrors.push({ level, message });
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

    const previewFilePath = join(userDataDir, 'preview.html');
    await writeFile(previewFilePath, html, 'utf8');
    await page.goto(pathToFileURL(previewFilePath).href, {
      waitUntil: 'domcontentloaded',
      timeout: LOAD_TIMEOUT_MS,
    });
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
    // Clean up the per-call profile dir — leaving it around would let the
    // tmpdir accumulate hundreds of MB across runs.
    try {
      await rm(userDataDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  }
}

function resolveWorkspaceChild(absWorkspace: string, relPath: string): string {
  const absPath = resolve(absWorkspace, relPath);
  // Path-escape guard: the agent passes workspace-relative paths, but a crafted
  // `../../etc/passwd` would otherwise resolve outside the sandbox and serve
  // whatever the main-process user can read.
  if (absPath !== absWorkspace && !absPath.startsWith(absWorkspace + sep)) {
    throw new Error(`path "${relPath}" escapes workspace root`);
  }
  return absPath;
}

async function readPreviewSource(absWorkspace: string, relPath: string): Promise<string> {
  let source: string;
  try {
    source = await readFile(resolveWorkspaceChild(absWorkspace, relPath), 'utf8');
  } catch (err) {
    throw new Error(`read failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (source.indexOf('\u0000') !== -1) {
    throw new Error(`binary file cannot be previewed: ${relPath}`);
  }
  return source;
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

function isRuntimeConsoleNoise(message: string): boolean {
  return message.startsWith('You are using the in-browser Babel transformer.');
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
