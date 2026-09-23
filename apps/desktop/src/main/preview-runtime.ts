/**
 * `runPreview` — host executor for the core `preview` tool.
 *
 * Reads workspace artifacts, wraps JSX/TSX through the renderer's runtime
 * builder, and loads the result in an isolated puppeteer-core page. Optional
 * declarative interactions run before the final screenshot/DOM report.
 * Separate from `done-verify.ts` so this wire shape can evolve without changing
 * done's lint + console contract.
 *
 * Reuses `findSystemChrome` from `@open-codesign/exporters` so we match the
 * PDF exporter's discovery rules (no bundled Chromium — PRINCIPLES §1).
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import {
  type RunPreviewOptions as CorePreviewOptions,
  type PreviewResult,
  validatePreviewInput,
} from '@open-codesign/core';
import { findSystemChrome } from '@open-codesign/exporters';
import {
  buildPreviewDocument,
  findArtifactSourceReference,
  resolveArtifactSourceReferencePath,
} from '@open-codesign/runtime';
import type { Browser, ConsoleMessage, HTTPRequest, HTTPResponse, Page } from 'puppeteer-core';
import { getLogger } from './logger';
import { boundedPreview, collectVisibleEvidence, runPreviewSteps } from './preview-interactions';
import { resolveSafeWorkspaceChildPath } from './workspace-reader';

export interface RunPreviewOptions extends CorePreviewOptions {
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
  try {
    validatePreviewInput(opts);
    if (opts.signal?.aborted) return emptyFail('Preview cancelled');
  } catch (err) {
    return emptyFail(err instanceof Error ? err.message : String(err));
  }
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
    html = await buildWorkspacePreviewDocument(source, absWorkspace, sourcePath);
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
  let steps: PreviewResult['steps'];
  let navigationFailure: string | undefined;
  let report: PreviewResult | undefined;
  const browserLifetime = new AbortController();
  const hasSteps = (opts.steps?.length ?? 0) > 0;
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
      ...(hasSteps ? { downloadBehavior: { policy: 'deny' as const } } : {}),
      signal: opts.signal
        ? AbortSignal.any([opts.signal, browserLifetime.signal])
        : browserLifetime.signal,
      args: [
        '--headless=new',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        // Suppress "Chrome is not the default browser" and similar first-run
        // dialogs that would otherwise stall the launch handshake.
        '--no-first-run',
        '--no-default-browser-check',
        // Chrome's zygote refuses to start as uid 0 without this. Containers,
        // dev VMs, and CI runners frequently run as root; gating to root keeps
        // the production launch path unchanged on macOS/Windows/user-mode Linux.
        ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      ],
    });
    if (opts.signal?.aborted) throw new Error('Preview cancelled');
    page = await browser.newPage();
    await page.setViewport(opts.viewport ?? DEFAULT_VIEWPORT);

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
    const previewUrl = pathToFileURL(previewFilePath).href;
    let initialNavigation = true;
    if (hasSteps) {
      await page.evaluateOnNewDocument(
        `window.open = () => { throw new Error('Preview interactions cannot open another document'); };`,
      );
    }
    await page.setRequestInterception(true);
    page.on('request', (req: HTTPRequest) => {
      if (hasSteps && req.isNavigationRequest()) {
        if (!initialNavigation || req.url() !== previewUrl) {
          navigationFailure = 'Navigation outside the current preview document is not allowed';
          // ERR_ABORTED keeps the source document instead of displaying Chrome's error page.
          void req.abort('aborted').catch((error: unknown) => {
            navigationFailure = `Navigation blocked: ${String(error)}`;
          });
          return;
        }
        initialNavigation = false;
      }
      void handlePreviewRequest(req, absWorkspace, previewFilePath);
    });
    await boundedPreview(
      page.goto(previewUrl, {
        waitUntil: 'domcontentloaded',
        timeout: LOAD_TIMEOUT_MS,
      }),
      LOAD_TIMEOUT_MS,
      opts.signal,
    );
    await boundedPreview(
      new Promise<void>((r) => setTimeout(r, SETTLE_AFTER_LOAD_MS)),
      SETTLE_AFTER_LOAD_MS + 100,
      opts.signal,
    );
    if (opts.steps !== undefined) {
      steps = await runPreviewSteps(page, opts.steps, opts.signal, () => navigationFailure);
    }

    const metrics = await boundedPreview(
      page.evaluate(() => {
        // Runs in the browser; DOM globals are defined at call time.
        // @ts-expect-error browser context
        const rect = document.documentElement.getBoundingClientRect();
        return {
          // @ts-expect-error browser context
          nodes: document.querySelectorAll('*').length,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }),
      2000,
      opts.signal,
    );
    const failedStep = steps?.find((step) => !step.ok);
    const reason = failedStep
      ? `Step ${failedStep.index + 1} (${failedStep.action} ${failedStep.selector}): ${failedStep.reason}`
      : navigationFailure;

    const result: PreviewResult = {
      ok: !reason && consoleErrors.length === 0 && assetErrors.length === 0,
      consoleErrors,
      assetErrors,
      metrics: {
        nodes: metrics.nodes,
        width: metrics.width,
        height: metrics.height,
        loadMs: Date.now() - startTs,
      },
      ...(steps !== undefined ? { steps } : {}),
      ...(reason ? { reason } : {}),
    };

    if (opts.vision) {
      const png = await boundedPreview(
        page.screenshot({ type: 'png', encoding: 'base64' }),
        2000,
        opts.signal,
      );
      result.screenshot = `data:image/png;base64,${png}`;
    } else {
      result.domOutline = await boundedPreview(
        page.evaluate(() => {
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
        }),
        2000,
        opts.signal,
      );
    }
    if (!opts.vision || hasSteps) {
      result.visibleText = await boundedPreview(
        page.evaluate(collectVisibleEvidence),
        2000,
        opts.signal,
      );
    }
    result.ok = result.ok && consoleErrors.length === 0 && assetErrors.length === 0;
    report = result;
    return result;
  } catch (err) {
    report = {
      ok: false,
      consoleErrors,
      assetErrors,
      metrics: { nodes: 0, width: 0, height: 0, loadMs: Date.now() - startTs },
      reason: err instanceof Error ? err.message : String(err),
      ...(steps !== undefined ? { steps } : {}),
    };
    return report;
  } finally {
    const cleanupFailed = (error: unknown) => {
      const message = `Preview cleanup failed: ${error instanceof Error ? error.message : String(error)}`;
      getLogger('preview').error('preview.cleanup.failed', { message });
      if (consoleErrors.length < MAX_CONSOLE_ENTRIES) {
        consoleErrors.push({ level: 'error', message });
      }
      if (report) {
        report.ok = false;
        report.reason ??= message;
      }
    };
    if (browser) {
      // Puppeteer's launch signal terminates this browser's process tree if graceful close stalls.
      const closing = browser.close();
      try {
        await boundedPreview(closing, 5000);
      } catch (error) {
        browserLifetime.abort();
        try {
          await boundedPreview(closing, 2000);
          if (report) {
            report.warnings = [
              `Graceful preview shutdown failed; isolated browser was terminated: ${error instanceof Error ? error.message : String(error)}`,
            ];
            getLogger('preview').warn('preview.cleanup.recovered', {
              message: report.warnings[0],
            });
          }
        } catch (terminationError) {
          cleanupFailed(terminationError);
        }
      }
    }
    // Clean up the per-call profile dir — leaving it around would let the
    // tmpdir accumulate hundreds of MB across runs.
    try {
      await rm(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (error) {
      cleanupFailed(error);
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

export async function buildWorkspacePreviewDocument(
  source: string,
  workspaceRoot: string,
  sourcePath: string,
): Promise<string> {
  const absoluteSource = await resolveSafeWorkspaceChildPath(workspaceRoot, sourcePath);
  return buildPreviewDocument(source, {
    path: sourcePath,
    baseHref: pathToFileURL(`${dirname(absoluteSource)}${sep}`).href,
  });
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

export function previewIncludesRuntimeFontLinks(html: string): boolean {
  if (/<link\b[^>]*\bdata-codesign-runtime-fonts\b/.test(html)) return true;
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
