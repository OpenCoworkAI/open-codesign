import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
import type { ExportResult } from './index';
import { type BrowserRenderOptions, buildExportHtmlDocument } from './rendered-html';

export type ExportPngOptions = BrowserRenderOptions;

const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;
// 2x keeps text sharp when the image is pasted into chat, docs, or slides.
const DEVICE_SCALE_FACTOR = 2;

export async function exportPng(
  artifactSource: string,
  destinationPath: string,
  opts: ExportPngOptions = {},
): Promise<ExportResult> {
  const { findSystemChrome } = await import('./chrome-discovery');
  const puppeteer = (await import('puppeteer-core')).default;
  const executablePath = opts.chromePath ?? (await findSystemChrome());
  const userDataDir = await mkdtemp(join(tmpdir(), 'codesign-png-'));
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      userDataDir,
      args: [
        '--headless=new',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    const page = await browser.newPage();
    await page.setViewport({
      ...(opts.viewport ?? DEFAULT_VIEWPORT),
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
    });
    await page.setContent(await buildExportHtmlDocument(artifactSource, opts), {
      waitUntil: opts.waitUntil ?? 'load',
      timeout: opts.renderTimeoutMs ?? 45_000,
    });
    await page.evaluate('document.fonts?.ready ?? Promise.resolve()');
    if (opts.settleMs && opts.settleMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, opts.settleMs));
    }
    const png = await page.screenshot({ type: 'png', fullPage: true });
    await writeFile(destinationPath, png);
    return { bytes: (await stat(destinationPath)).size, path: destinationPath };
  } catch (err) {
    if (err instanceof CodesignError) throw err;
    throw new CodesignError(
      `PNG export failed: ${err instanceof Error ? err.message : String(err)}`,
      ERROR_CODES.EXPORTER_PNG_FAILED,
      { cause: err },
    );
  } finally {
    if (browser) await browser.close();
    // The export result does not depend on removing Chrome's temporary profile.
    try {
      await rm(userDataDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  }
}
