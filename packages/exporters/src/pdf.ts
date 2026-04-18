import { CodesignError } from '@open-codesign/shared';
import type { ExportResult } from './index';

export interface ExportPdfOptions {
  /** Override the discovered Chrome binary path. Useful for tests / CI. */
  chromePath?: string;
  /**
   * Page format. Defaults to 'Letter'. Pass 'auto' to render the page as
   * a single tall sheet (no pagination) which is what Claude Design does
   * for HTML prototypes that aren't paginated.
   */
  format?: 'Letter' | 'A4' | 'auto';
}

const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;

/**
 * Render an HTML string to PDF via the user's installed Chrome.
 *
 * Tier 1: no header/footer, no font embedding, no PDF tagging. We deliberately
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
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setViewport(DEFAULT_VIEWPORT);
    await page.setContent(htmlContent, { waitUntil: 'networkidle0', timeout: 30_000 });

    const format = opts.format ?? 'Letter';
    const pdfBuf =
      format === 'auto'
        ? await page.pdf({
            printBackground: true,
            width: `${DEFAULT_VIEWPORT.width}px`,
            height: `${await page.evaluate('document.documentElement.scrollHeight')}px`,
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
          })
        : await page.pdf({ printBackground: true, format, preferCSSPageSize: true });

    await fs.writeFile(destinationPath, pdfBuf);
    const stat = await fs.stat(destinationPath);
    return { bytes: stat.size, path: destinationPath };
  } catch (err) {
    if (err instanceof CodesignError) throw err;
    throw new CodesignError(
      `PDF export failed: ${err instanceof Error ? err.message : String(err)}`,
      'EXPORTER_PDF_FAILED',
      { cause: err },
    );
  } finally {
    if (browser) await browser.close();
  }
}
