import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
import { inlineLocalAssetsInHtml, type LocalAssetOptions } from './assets';
import { buildHtmlDocument } from './html';
import type { ExportResult } from './index';

export interface ExportPptxOptions extends LocalAssetOptions {
  /** Slide title shown in PowerPoint's outline view. */
  deckTitle?: string;
  /**
   * `image` preserves visual fidelity by rendering HTML with system Chrome.
   * `editable` keeps the legacy title/bullet extraction path.
   */
  renderMode?: 'image' | 'editable';
  /** Override the discovered Chrome binary path for image rendering. */
  chromePath?: string;
  /** setContent timeout in milliseconds. Defaults to 45 seconds. */
  renderTimeoutMs?: number;
  /** Viewport used when rasterizing slides. */
  viewport?: { width: number; height: number };
}

interface SlideContent {
  title: string;
  bullets: string[];
}

/**
 * Render an HTML artifact to PPTX using pptxgenjs.
 *
 * Default strategy: render the artifact with system Chrome and embed screenshots
 * so visual layout, images, tables, and CSS survive the PPTX export. The
 * `editable` mode keeps the title/bullet extraction path. We do NOT use
 * dom-to-pptx in tier 1 — the package is unmaintained and only adds
 * editability for pure-text slides we already cover.
 *
 * CJK fix: per research/04, the dom-to-pptx wrap bug is sidestepped by
 * keeping pptxgenjs' default `wrap=square` and explicitly enabling
 * `fit: 'shrink'` (emits `normAutofit`). Verified with PowerPoint Mac.
 */
export async function exportPptx(
  htmlContent: string,
  destinationPath: string,
  opts: ExportPptxOptions = {},
): Promise<ExportResult> {
  const fs = await import('node:fs/promises');
  const PptxGenJS = (await import('pptxgenjs')).default;

  try {
    const pres = new PptxGenJS();
    pres.layout = 'LAYOUT_WIDE';
    if (opts.deckTitle) pres.title = opts.deckTitle;

    if ((opts.renderMode ?? 'image') === 'image') {
      const screenshots = await renderSlideScreenshots(htmlContent, opts);
      for (const screenshot of screenshots) {
        const slide = pres.addSlide();
        slide.background = { color: 'FFFFFF' };
        slide.addImage({
          data: `data:image/png;base64,${Buffer.from(screenshot).toString('base64')}`,
          x: 0,
          y: 0,
          w: 13.333,
          h: 7.5,
        });
      }
    } else {
      const slides = extractSlides(htmlContent);
      for (const s of slides) {
        const slide = pres.addSlide();
        slide.background = { color: 'FFFFFF' };
        if (s.title) {
          slide.addText(s.title, {
            x: 0.5,
            y: 0.4,
            w: 12,
            h: 1,
            fontSize: 32,
            bold: true,
            color: '111111',
            fontFace: 'Helvetica',
            wrap: true,
            fit: 'shrink',
          });
        }
        if (s.bullets.length > 0) {
          slide.addText(
            s.bullets.map((b) => ({ text: b, options: { bullet: true } })),
            {
              x: 0.5,
              y: 1.6,
              w: 12,
              h: 5.5,
              fontSize: 18,
              color: '333333',
              fontFace: 'Helvetica',
              wrap: true,
              fit: 'shrink',
              valign: 'top',
              paraSpaceAfter: 8,
            },
          );
        }
      }
    }

    await pres.writeFile({ fileName: destinationPath });
    const stat = await fs.stat(destinationPath);
    return { bytes: stat.size, path: destinationPath };
  } catch (err) {
    throw new CodesignError(
      `PPTX export failed: ${err instanceof Error ? err.message : String(err)}`,
      ERROR_CODES.EXPORTER_PPTX_FAILED,
      { cause: err },
    );
  }
}

async function renderSlideScreenshots(
  htmlContent: string,
  opts: ExportPptxOptions,
): Promise<Buffer[]> {
  const { findSystemChrome } = await import('./chrome-discovery');
  const puppeteer = (await import('puppeteer-core')).default;

  const viewport = opts.viewport ?? { width: 1280, height: 720 };
  const executablePath = opts.chromePath ?? (await findSystemChrome());
  let html = buildHtmlDocument(htmlContent, { prettify: false });
  html = await inlineLocalAssetsInHtml(html, opts);

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--headless=new',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ ...viewport, deviceScaleFactor: 2 });
    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: opts.renderTimeoutMs ?? 45_000,
    });
    await page.evaluate('document.fonts?.ready ?? Promise.resolve()');

    const sectionHandles = await page.$$('section');
    const screenshots: Buffer[] = [];
    if (sectionHandles.length > 0) {
      for (const section of sectionHandles) {
        const box = await section.boundingBox();
        if (!box || box.width <= 0 || box.height <= 0) continue;
        const image = await page.screenshot({
          type: 'png',
          clip: {
            x: Math.max(0, box.x),
            y: Math.max(0, box.y),
            width: Math.max(1, box.width),
            height: Math.max(1, box.height),
          },
        });
        screenshots.push(Buffer.from(image));
      }
    }
    if (screenshots.length === 0) {
      const image = await page.screenshot({ type: 'png', fullPage: true });
      screenshots.push(Buffer.from(image));
    }
    return screenshots;
  } finally {
    await browser.close();
  }
}

const SECTION_RE = /<section\b[^>]*>([\s\S]*?)<\/section>/gi;
const TAG_RE = /<[^>]+>/g;
const HEADING_RE = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i;
const LIST_ITEM_RE = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
const PARAGRAPH_RE = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;

export function extractSlides(html: string): SlideContent[] {
  const sections: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = SECTION_RE.exec(html)) !== null) sections.push(m[1] ?? '');
  if (sections.length === 0) sections.push(html);
  return sections.map(parseSlide);
}

function parseSlide(fragment: string): SlideContent {
  const headingMatch = HEADING_RE.exec(fragment);
  const title = headingMatch ? stripHtml(headingMatch[1] ?? '') : '';

  const bullets: string[] = [];
  let li: RegExpExecArray | null;
  while ((li = LIST_ITEM_RE.exec(fragment)) !== null) {
    const text = stripHtml(li[1] ?? '');
    if (text) bullets.push(text);
  }
  if (bullets.length === 0) {
    let p: RegExpExecArray | null;
    while ((p = PARAGRAPH_RE.exec(fragment)) !== null) {
      const text = stripHtml(p[1] ?? '');
      if (text) bullets.push(text);
    }
  }
  if (bullets.length === 0 && !title) {
    const text = stripHtml(fragment);
    if (text) bullets.push(text);
  }
  return { title, bullets };
}

function stripHtml(s: string): string {
  return s
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(TAG_RE, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
