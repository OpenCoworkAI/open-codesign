import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
import type { ExportResult } from './index';
import { type BrowserWaitUntil, buildExportHtmlDocument } from './rendered-html';

export interface ExportPdfOptions {
  /** Workspace-relative source path used to classify JSX vs TSX and anchor relative assets. */
  sourcePath?: string | undefined;
  /** Directory used to resolve relative HTML references. */
  assetBasePath?: string | undefined;
  /** Workspace/root directory used for root-relative references and containment. */
  assetRootPath?: string | undefined;
  /** Override the discovered Chrome binary path. Useful for tests / CI. */
  chromePath?: string;
  /**
   * Page format. Defaults to 'Letter'. Pass 'auto' to render the page as
   * a single tall sheet (no pagination) which is what Claude Design does
   * for HTML prototypes that aren't paginated.
   */
  format?: 'Letter' | 'A4' | 'auto';
  /** Puppeteer navigation wait strategy. Defaults to load. */
  waitUntil?: BrowserWaitUntil;
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
  /** Inject Tailwind CDN into standalone HTML before browser rendering. Defaults to true. */
  injectTailwind?: boolean;
  /** Auto-detect slide decks and export one landscape PDF page per slide. Defaults to true. */
  slideDeck?: boolean;
}

const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;

/**
 * Render a design source artifact to PDF via the user's installed Chrome.
 * JSX sources are first wrapped into a standalone web document by the runtime.
 * Local workspace assets are inlined before rendering when the caller provides
 * asset paths; optional header/footer templates are passed through to Chrome.
 *
 * The remaining limitations are font embedding and PDF tagging. We deliberately
 * avoid Puppeteer's full distribution (~150 MB Chromium download) — `puppeteer-core`
 * connects to the system Chrome we discover at runtime. PRINCIPLES §1 + §10.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: existing complexity, see #118
export async function exportPdf(
  artifactSource: string,
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
    const exportHtml = await buildExportHtmlDocument(artifactSource, opts);
    await page.setContent(exportHtml, {
      waitUntil: opts.waitUntil ?? 'load',
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
    const slideDeck =
      opts.slideDeck !== false && opts.format === undefined && !displayHeaderFooter
        ? await prepareSlideDeckPdf(page)
        : null;
    const pdfBuf = slideDeck
      ? await page.pdf({
          ...sharedPdfOptions,
          width: `${slideDeck.width}px`,
          height: `${slideDeck.height}px`,
          margin: { top: '0', right: '0', bottom: '0', left: '0' },
          preferCSSPageSize: false,
        })
      : format === 'auto'
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

interface SlideDeckPdfLayout {
  pageCount: number;
  width: number;
  height: number;
}

async function prepareSlideDeckPdf(page: {
  evaluate: (script: string) => Promise<unknown>;
}): Promise<SlideDeckPdfLayout | null> {
  const raw = await page.evaluate(SLIDE_DECK_PDF_SCRIPT);
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const pageCount = value['pageCount'];
  const width = value['width'];
  const height = value['height'];
  if (
    typeof pageCount !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isFinite(pageCount) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    pageCount < 2 ||
    width < 480 ||
    height < 270
  ) {
    return null;
  }
  return {
    pageCount: Math.round(pageCount),
    width: Math.round(width),
    height: Math.round(height),
  };
}

const SLIDE_DECK_PDF_SCRIPT = `(() => {
  const slides = Array.from(document.querySelectorAll('section'))
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .filter(({ rect }) => {
      const ratio = rect.width / Math.max(1, rect.height);
      return rect.width >= 480 && rect.height >= 270 && ratio >= 1.5 && ratio <= 1.95;
    });
  if (slides.length < 2) return null;

  const width = Math.round(slides[0].rect.width);
  const height = Math.round(slides[0].rect.height);
  for (const { rect } of slides) {
    if (Math.abs(rect.width - width) > 8 || Math.abs(rect.height - height) > 8) return null;
  }

  const head = document.head;
  for (const node of Array.from(document.body.querySelectorAll('style, link[rel="stylesheet"]'))) {
    head.appendChild(node.cloneNode(true));
  }

  const body = document.body;
  body.replaceChildren();
  body.style.margin = '0';
  body.style.padding = '0';
  body.style.background = '#fff';
  body.style.width = width + 'px';

  for (const { el } of slides) {
    const clone = el.cloneNode(true);
    if (clone instanceof HTMLElement) {
      clone.style.width = width + 'px';
      clone.style.height = height + 'px';
      clone.style.maxWidth = 'none';
      clone.style.margin = '0';
      clone.style.borderRadius = '0';
      clone.style.boxShadow = 'none';
      clone.style.breakAfter = 'page';
      clone.style.pageBreakAfter = 'always';
      clone.style.overflow = 'hidden';
    }
    body.appendChild(clone);
  }

  const style = document.createElement('style');
  style.textContent = [
    '@page { size: ' + width + 'px ' + height + 'px; margin: 0; }',
    'html, body { margin: 0 !important; padding: 0 !important; width: ' + width + 'px !important; background: #fff !important; }',
    'body > section { width: ' + width + 'px !important; height: ' + height + 'px !important; min-height: 0 !important; max-width: none !important; margin: 0 !important; border-radius: 0 !important; box-shadow: none !important; break-after: page; page-break-after: always; overflow: hidden !important; }',
    'body > section:last-of-type { break-after: auto; page-break-after: auto; }'
  ].join('\\n');
  head.appendChild(style);
  return { pageCount: slides.length, width, height };
})()`;
