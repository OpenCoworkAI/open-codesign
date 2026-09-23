/**
 * Hidden runtime verifier for the agent's `done` tool.
 *
 * The agent emits a JSX module (TWEAK_DEFAULTS + App + ReactDOM.createRoot).
 * We wrap it via `@open-codesign/runtime`'s `buildSrcdoc` (same path the
 * preview iframe uses), write the srcdoc to a temporary HTML file, load it with
 * the same system Chrome/Puppeteer engine used by `preview`, and capture
 * console/page errors for a short settle window. The collected errors flow
 * back through the `done` tool so the agent can self-heal.
 *
 * Browser execution is integration-heavy, so the fast unit tests cover the
 * small pure helpers. Manual verification path: run `pnpm dev`, send a prompt
 * that provokes a ReferenceError (e.g. unbound identifier inside `App`), and
 * confirm the next `done` tool result lists the error.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import type { DoneError, DoneRuntimeVerifier } from '@open-codesign/core';
import { findSystemChrome } from '@open-codesign/exporters';
import { buildSrcdoc } from '@open-codesign/runtime';
import type { Browser, ConsoleMessage, HTTPRequest, Page } from 'puppeteer-core';
import { boundedPreview } from './preview-interactions';
import { buildWorkspacePreviewDocument, isPreviewFileUrlAllowed } from './preview-runtime';

const VERIFY_LOAD_TIMEOUT_MS = 15_000;
const SETTLE_AFTER_LOAD_MS = 1200;

function redactRuntimeUrl(rawUrl: string): string {
  if (rawUrl.startsWith('data:')) {
    const comma = rawUrl.indexOf(',');
    const prefix = comma >= 0 ? rawUrl.slice(0, comma + 1) : 'data:';
    return `${prefix}...truncated`;
  }
  return rawUrl;
}

function redactRuntimeLoadMessage(message: string): string {
  return message.replace(/data:[^\s'")\]]+/g, (url) => redactRuntimeUrl(url));
}

export function formatRuntimeLoadError(kind: string, description: string, url?: string): string {
  const safeDescription = redactRuntimeLoadMessage(description);
  if (url === undefined || url.length === 0) return `${kind}: ${safeDescription}`;
  return `${kind}: ${safeDescription} [${redactRuntimeUrl(url)}]`;
}

export function isRuntimeVerifierConsoleNoise(message: string): boolean {
  return (
    (message.includes('Electron Security Warning') &&
      message.includes('Insecure Content-Security-Policy')) ||
    message.startsWith('You are using the in-browser Babel transformer.')
  );
}

export function isDoneVerifierRequestAllowed(rawUrl: string, verifyFilePath: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  switch (url.protocol) {
    case 'about:':
    case 'blob:':
    case 'data:':
    case 'http:':
    case 'https:':
      return true;
    case 'file:':
      try {
        return fileURLToPath(url) === verifyFilePath;
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function mapConsoleSource(raw: string): string | null {
  switch (raw) {
    case 'error':
      return 'console.error';
    case 'warning':
    case 'warn':
      return 'console.warning';
    default:
      return null;
  }
}

async function handleVerifierRequest(
  req: HTTPRequest,
  verifyFilePath: string,
  workspaceRoot?: string,
): Promise<void> {
  try {
    const allowed =
      workspaceRoot !== undefined && req.url().startsWith('file:')
        ? await isPreviewFileUrlAllowed(req.url(), workspaceRoot, verifyFilePath)
        : isDoneVerifierRequestAllowed(req.url(), verifyFilePath);
    if (!allowed) {
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

async function closePage(page: Page | null): Promise<void> {
  if (page === null) return;
  try {
    await page.close();
  } catch {
    /* noop */
  }
}

async function closeBrowser(browser: Browser | null): Promise<void> {
  if (browser === null) return;
  try {
    await browser.close();
  } catch {
    /* noop */
  }
}

function consoleLine(msg: ConsoleMessage): number | undefined {
  const line = msg.location().lineNumber ?? 0;
  return line > 0 ? line : undefined;
}

async function settleAfterLoad(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, SETTLE_AFTER_LOAD_MS));
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function normalizeErrorForDedupe(message: string): string {
  return message.replace(/^(?:Uncaught\s+)?(?:ReferenceError|TypeError|SyntaxError|Error):\s*/, '');
}

function pushUniqueError(
  errors: DoneError[],
  seen: Set<string>,
  message: string,
  source: string,
  lineno?: number,
): void {
  const key = `${lineno ?? ''}|${normalizeErrorForDedupe(message)}`;
  if (seen.has(key)) return;
  seen.add(key);
  errors.push(lineno !== undefined ? { message, source, lineno } : { message, source });
}

async function verifyWithSystemChrome(
  verifyUrl: string,
  verifyPath: string,
  workspaceRoot?: string,
  signal?: AbortSignal,
): Promise<DoneError[]> {
  signal?.throwIfAborted();
  const executablePath = await findSystemChrome();
  const puppeteer = (await import('puppeteer-core')).default;
  const userDataDir = await mkdtemp(join(tmpdir(), 'codesign-done-chrome-'));
  const errors: DoneError[] = [];
  const seen = new Set<string>();
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    signal?.throwIfAborted();
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      userDataDir,
      ...(signal ? { signal } : {}),
      args: [
        '--headless=new',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    signal?.throwIfAborted();
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setRequestInterception(true);
    page.on('request', (req: HTTPRequest) => {
      void handleVerifierRequest(req, verifyPath, workspaceRoot);
    });
    page.on('console', (msg: ConsoleMessage) => {
      const source = mapConsoleSource(msg.type());
      if (source === null) return;
      const message = msg.text() ?? '';
      if (isRuntimeVerifierConsoleNoise(message)) return;
      pushUniqueError(errors, seen, message, source, consoleLine(msg));
    });
    page.on('pageerror', (err: unknown) => {
      pushUniqueError(errors, seen, toErrorMessage(err), 'pageerror');
    });
    page.on('requestfailed', (req: HTTPRequest) => {
      pushUniqueError(
        errors,
        seen,
        formatRuntimeLoadError(
          'resource failed',
          req.failure()?.errorText ?? 'unknown failure',
          req.url(),
        ),
        'requestfailed',
      );
    });

    await boundedPreview(
      page.goto(verifyUrl, {
        waitUntil: 'domcontentloaded',
        timeout: VERIFY_LOAD_TIMEOUT_MS,
      }),
      VERIFY_LOAD_TIMEOUT_MS,
      signal,
    );
    await boundedPreview(settleAfterLoad(), SETTLE_AFTER_LOAD_MS + 100, signal);
  } catch (err) {
    signal?.throwIfAborted();
    pushUniqueError(
      errors,
      seen,
      formatRuntimeLoadError('runtime verifier load failed', toErrorMessage(err), verifyUrl),
      'load',
    );
  } finally {
    await closePage(page);
    await closeBrowser(browser);
    await rm(userDataDir, { recursive: true, force: true });
  }

  return errors;
}

export function makeRuntimeVerifier(options?: { workspaceRoot: string }): DoneRuntimeVerifier {
  return async (artifactSource, context): Promise<DoneError[]> => {
    context?.signal?.throwIfAborted();
    const workspaceRoot = options ? resolve(options.workspaceRoot) : undefined;
    const srcdoc = workspaceRoot
      ? await buildWorkspacePreviewDocument(
          artifactSource,
          workspaceRoot,
          context?.path ?? 'App.jsx',
        )
      : buildSrcdoc(artifactSource);
    const tempDir = await mkdtemp(join(tmpdir(), 'codesign-done-verify-'));
    const verifyPath = join(tempDir, 'verify.html');
    await writeFile(verifyPath, srcdoc, 'utf8');
    const verifyUrl = pathToFileURL(verifyPath).href;

    try {
      return await verifyWithSystemChrome(verifyUrl, verifyPath, workspaceRoot, context?.signal);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  };
}
