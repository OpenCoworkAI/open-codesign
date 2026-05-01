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
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import type { PreviewResult } from '@open-codesign/core';
import { findSystemChrome } from '@open-codesign/exporters';
import {
  buildPreviewDocument,
  findArtifactSourceReference,
  resolveArtifactSourceReferencePath,
} from '@open-codesign/runtime';
import type { Browser, ConsoleMessage, HTTPRequest, HTTPResponse, Page } from 'puppeteer-core';
import { resolveSafeWorkspaceChildPath } from './workspace-reader';

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
const RUNTIME_FONT_FAMILY_PREFIXES = [
  'Fraunces:',
  'DM Serif Display:',
  'DM Sans:',
  'JetBrains Mono:',
] as const;
const RUNTIME_FONT_PATH_PREFIXES = [
  '/s/fraunces/',
  '/s/dmsans/',
  '/s/dmserifdisplay/',
  '/s/jetbrainsmono/',
] as const;

export async function runPreview(opts: RunPreviewOptions): Promise<PreviewResult> {
  const absWorkspace = resolve(opts.workspaceRoot);
  let source: string;
  let sourcePath = opts.path;
  try {
    source = await readPreviewSource(absWorkspace, opts.path);
    if (isHtmlPreviewPath(opts.path)) {
      const reference = findArtifactSourceReference(source);
      const referencedPath =
        reference === null ? null : resolveArtifactSourceReferencePath(opts.path, reference);
      if (referencedPath !== null) {
        source = await readPreviewSource(absWorkspace, referencedPath);
        sourcePath = referencedPath;
      }
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
  const ignoreOptionalRuntimeFontFailures = previewIncludesRuntimeFontLinks(html);
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
      if (
        isRuntimeConsoleNoise(message, {
          ignoreOptionalRuntimeFontFailures,
          locationUrl: msg.location().url,
        })
      ) {
        return;
      }
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
      if (ignoreOptionalRuntimeFontFailures && isRuntimeOptionalFontUrl(req.url())) {
        return;
      }
      const type = req.resourceType();
      assetErrors.push({ url: req.url(), status: 0, ...(type ? { type } : {}) });
    });
    page.on('response', (res: HTTPResponse) => {
      const status = res.status();
      if (status < 400 || assetErrors.length >= MAX_ASSET_ERRORS) return;
      if (ignoreOptionalRuntimeFontFailures && isRuntimeOptionalFontUrl(res.url())) {
        return;
      }
      const type = res.request().resourceType();
      assetErrors.push({ url: res.url(), status, ...(type ? { type } : {}) });
    });

    const previewFilePath = join(userDataDir, 'preview.html');
    await writeFile(previewFilePath, html, 'utf8');
    await page.setRequestInterception(true);
    page.on('request', (req: HTTPRequest) => {
      void handlePreviewRequest(req, absWorkspace, previewFilePath);
    });
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

function isHtmlPreviewPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.html') || lower.endsWith('.htm');
}

async function readPreviewSource(absWorkspace: string, relPath: string): Promise<string> {
  let source: string;
  try {
    source = await readFile(await resolveSafeWorkspaceChildPath(absWorkspace, relPath), 'utf8');
  } catch (err) {
    throw new Error(`read failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (source.indexOf('\u0000') !== -1) {
    throw new Error(`binary file cannot be previewed: ${relPath}`);
  }
  return source;
}

export async function isPreviewFileUrlAllowed(
  rawUrl: string,
  absWorkspace: string,
  previewFilePath: string,
): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'file:') return true;
  let filePath: string;
  try {
    filePath = fileURLToPath(url);
  } catch {
    return false;
  }
  if (filePath === previewFilePath) return true;

  const relPath = relative(absWorkspace, filePath);
  if (relPath.length === 0 || relPath.startsWith('..') || resolve(relPath) === relPath) {
    return false;
  }
  try {
    await resolveSafeWorkspaceChildPath(absWorkspace, relPath);
    return true;
  } catch {
    return false;
  }
}

async function handlePreviewRequest(
  req: HTTPRequest,
  absWorkspace: string,
  previewFilePath: string,
): Promise<void> {
  try {
    if (!(await isPreviewFileUrlAllowed(req.url(), absWorkspace, previewFilePath))) {
      await req.abort('blockedbyclient');
      return;
    }
    await req.continue();
  } catch {
    try {
      await req.abort('failed');
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

interface RuntimeConsoleNoiseOptions {
  ignoreOptionalRuntimeFontFailures?: boolean | undefined;
  locationUrl?: string | undefined;
}

export function isRuntimeOptionalFontUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.hostname === 'fonts.googleapis.com') {
    if (url.pathname !== '/css2') return false;
    return url.searchParams
      .getAll('family')
      .some((family) => RUNTIME_FONT_FAMILY_PREFIXES.some((prefix) => family.startsWith(prefix)));
  }
  if (url.hostname !== 'fonts.gstatic.com') return false;
  return RUNTIME_FONT_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

export function isRuntimeConsoleNoise(
  message: string,
  opts: RuntimeConsoleNoiseOptions = {},
): boolean {
  if (message.startsWith('You are using the in-browser Babel transformer.')) {
    return true;
  }
  if (!opts.ignoreOptionalRuntimeFontFailures) return false;
  if (!message.startsWith('Failed to load resource:')) return false;
  if (opts.locationUrl && isRuntimeOptionalFontUrl(opts.locationUrl)) return true;
  return /https:\/\/fonts\.(?:googleapis|gstatic)\.com\//.test(message);
}

function previewIncludesRuntimeFontLinks(html: string): boolean {
  return (
    html.includes('<!-- AGENT_BODY_BEGIN -->') &&
    html.includes('https://fonts.googleapis.com/css2?family=Fraunces:')
  );
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
