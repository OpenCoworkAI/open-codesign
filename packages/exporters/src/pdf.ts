import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
import { inlineLocalAssetsInHtml, type LocalAssetOptions } from './assets';
import type { ExportResult } from './index';

export interface ExportPdfOptions extends LocalAssetOptions {
  /** Override the discovered Chrome binary path. Useful for tests / CI. */
  chromePath?: string;
  /**
   * Page format. Defaults to 'Letter'. Pass 'auto' to render the page as
   * a single tall sheet (no pagination) which is what Claude Design does
   * for HTML prototypes that aren't paginated.
   */
  format?: 'Letter' | 'A4' | 'auto';
  /** Puppeteer navigation wait strategy. Defaults to networkidle0. */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
  /** setContent timeout in milliseconds. Defaults to 45 seconds. */
  renderTimeoutMs?: number;
  /** Extra delay after fonts/layout settle, useful for lazy UI. Defaults to 0. */
  settleMs?: number;
  /** Enable Puppeteer's header/footer rendering. */
  displayHeaderFooter?: boolean;
  /** HTML template for the printed header. */
  headerTemplate?: string;
  /** HTML template for the printed footer. */
  footerTemplate?: string;
  /** PDF margins. Header/footer exports get a small default margin. */
  margin?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
  /** Inline local src/href/url() references as data URIs when assetBasePath is set. */
  inlineLocalAssets?: boolean;
}

const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;

/**
 * Render an HTML string to PDF via the user's installed Chrome.
 * Local workspace assets are inlined before rendering when the caller provides
 * asset paths; optional header/footer templates are passed through to Chrome.
 *
 * The remaining limitations are font embedding and PDF tagging. We deliberately
 * avoid Puppeteer's full distribution (~150 MB Chromium download) — `puppeteer-core`
 * connects to the system Chrome we discover at runtime. PRINCIPLES §1 + §10.
 */
export async function exportPdf(
  htmlContent: string,
  destinationPath: string,
  opts: ExportPdfOptions = {},
): Promise<ExportResult> {
  const fs = await import('node:fs/promises');
  const { findSystemChrome } = await import('./chrome-discovery');
  const puppeteer = (await import('puppeteer-core')).default;

  const executablePath = opts.chromePath ?? (await findSystemChrome());

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  // Isolate the user-data-dir to a disposable tmpdir so macOS's
  // single-instance handling doesn't activate the user's running Chrome
  // (bouncing the Dock icon) instead of starting a headless worker — same
  // fix as preview-runtime.ts.
  const userDataDir = await mkdtemp(join(tmpdir(), 'codesign-pdf-'));
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
    await page.setViewport(DEFAULT_VIEWPORT);
    const exportHtml =
      (opts.inlineLocalAssets ?? true)
        ? await inlineLocalAssetsInHtml(htmlContent, opts)
        : htmlContent;
    await page.setContent(exportHtml, {
      waitUntil: opts.waitUntil ?? 'networkidle0',
      timeout: opts.renderTimeoutMs ?? 45_000,
    });
    await page.evaluate('document.fonts?.ready ?? Promise.resolve()');
    if (opts.settleMs && opts.settleMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, opts.settleMs));
    }

    const format = opts.format ?? 'Letter';
    const displayHeaderFooter =
      opts.displayHeaderFooter ??
      (opts.headerTemplate !== undefined || opts.footerTemplate !== undefined);
    const margin =
      opts.margin ??
      (displayHeaderFooter
        ? { top: '0.45in', right: '0.35in', bottom: '0.45in', left: '0.35in' }
        : undefined);
    const sharedPdfOptions = {
      printBackground: true,
      displayHeaderFooter,
      headerTemplate: opts.headerTemplate ?? '<span></span>',
      footerTemplate: opts.footerTemplate ?? '<span></span>',
      ...(margin ? { margin } : {}),
    };
    const pdfBuf =
      format === 'auto'
        ? await page.pdf({
            ...sharedPdfOptions,
            width: `${DEFAULT_VIEWPORT.width}px`,
            height: `${await page.evaluate('document.documentElement.scrollHeight')}px`,
            margin: margin ?? { top: '0', right: '0', bottom: '0', left: '0' },
          })
        : await page.pdf({ ...sharedPdfOptions, format, preferCSSPageSize: true });

    await fs.writeFile(destinationPath, pdfBuf);
    const stat = await fs.stat(destinationPath);
    return { bytes: stat.size, path: destinationPath };
  } catch (err) {
    if (err instanceof CodesignError) throw err;
    throw new CodesignError(
      `PDF export failed: ${err instanceof Error ? err.message : String(err)}`,
      ERROR_CODES.EXPORTER_PDF_FAILED,
      { cause: err },
    );
  } finally {
    if (browser) await browser.close();
    try {
      await rm(userDataDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  }
}
