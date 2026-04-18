import { CodesignError } from '@open-codesign/shared';
import type { ExportResult } from './index';

export interface ExportPptxOptions {
  /** Slide title shown in PowerPoint's outline view. */
  deckTitle?: string;
}

interface SlideContent {
  title: string;
  bullets: string[];
}

/**
 * Render an HTML artifact to PPTX using pptxgenjs.
 *
 * Tier 1 strategy: walk top-level `<section>` elements (one slide each); if
 * none exist, the whole document becomes a single slide. We do NOT use
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
    const slides = extractSlides(htmlContent);
    const pres = new PptxGenJS();
    pres.layout = 'LAYOUT_WIDE';
    if (opts.deckTitle) pres.title = opts.deckTitle;

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

    await pres.writeFile({ fileName: destinationPath });
    const stat = await fs.stat(destinationPath);
    return { bytes: stat.size, path: destinationPath };
  } catch (err) {
    throw new CodesignError(
      `PPTX export failed: ${err instanceof Error ? err.message : String(err)}`,
      'EXPORTER_PPTX_FAILED',
      { cause: err },
    );
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
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
  while ((m = SECTION_RE.exec(html)) !== null) sections.push(m[1] ?? '');
  if (sections.length === 0) sections.push(html);
  return sections.map(parseSlide);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: HTML-to-slide extraction is a small state machine; splitting hides the priority order (heading → li → p → fallback)
function parseSlide(fragment: string): SlideContent {
  const headingMatch = HEADING_RE.exec(fragment);
  const title = headingMatch ? stripHtml(headingMatch[1] ?? '') : '';

  const bullets: string[] = [];
  let li: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
  while ((li = LIST_ITEM_RE.exec(fragment)) !== null) {
    const text = stripHtml(li[1] ?? '');
    if (text) bullets.push(text);
  }
  if (bullets.length === 0) {
    let p: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
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
