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
    await page.evaluate(EXPAND_DECK_SCRIPT);
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
    // Cleanup must not replace the export result or the original error. When
    // close() rejects, puppeteer has already fallen back to killing Chrome.
    try {
      await browser?.close();
    } catch {
      /* noop */
    }
    try {
      await rm(userDataDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  }
}

// Decks that show one <section> slide at a time (the built-in 16:9 scaffold
// hides inactive slides with display: none) would otherwise export only the
// visible slide. Each slide gets its own copy of the deck container, showing
// that slide alone, and the copies replace the page body in slide order, as
// PDF export does for decks. Uses the same slide-size checks as PDF export.
// Returns the number of slides laid out, or 0 when the page is left as is.
export const EXPAND_DECK_SCRIPT = `(() => {
  const parents = new Set(Array.from(document.querySelectorAll('section'), (el) => el.parentElement));
  for (const parent of parents) {
    if (!parent || parent === document.body) continue;
    const slides = Array.from(parent.children).filter((el) => el.tagName === 'SECTION');
    const visible = slides.filter((el) => getComputedStyle(el).display !== 'none');
    if (slides.length < 2 || visible.length !== 1) continue;
    const active = visible[0];
    const rect = active.getBoundingClientRect();
    const ratio = rect.width / Math.max(1, rect.height);
    if (rect.width < 480 || rect.height < 270 || ratio < 1.5 || ratio > 1.95) continue;
    const display = getComputedStyle(active).display;
    // The shown slide is marked by what only it carries (a class such as
    // "active", data-active="true", no aria-hidden). Each copy moves those marks
    // to its own slide, so styles tied to them, not just display, apply there.
    const others = slides.filter((el) => el !== active);
    const activeClasses = Array.from(active.classList).filter((name) =>
      others.every((el) => !el.classList.contains(name)),
    );
    const otherClasses = Array.from(others[0].classList).filter(
      (name) => !active.classList.contains(name) && others.every((el) => el.classList.contains(name)),
    );
    const marks = Array.from(new Set(slides.flatMap((el) => el.getAttributeNames())))
      .filter((name) => name !== 'class' && name !== 'style')
      .map((name) => ({ name, shown: active.getAttribute(name), other: others[0].getAttribute(name) }))
      .filter((mark) => mark.shown !== mark.other && others.every((el) => el.getAttribute(mark.name) === mark.other));
    const frames = slides.map((_, index) => {
      const frame = parent.cloneNode(true);
      const copies = Array.from(frame.children).filter((el) => el.tagName === 'SECTION');
      copies.forEach((el, i) => {
        const shown = i === index;
        el.classList.remove(...(shown ? otherClasses : activeClasses));
        el.classList.add(...(shown ? activeClasses : otherClasses));
        for (const mark of marks) {
          const value = shown ? mark.shown : mark.other;
          if (value === null) el.removeAttribute(mark.name);
          else el.setAttribute(mark.name, value);
        }
        el.style.display = shown ? display : 'none';
      });
      frame.style.margin = '0 auto 24px';
      return frame;
    });
    const body = document.body;
    for (const node of Array.from(body.querySelectorAll('style, link[rel="stylesheet"]'))) {
      document.head.appendChild(node.cloneNode(true));
    }
    body.replaceChildren(...frames);
    document.documentElement.style.height = 'auto';
    body.style.height = 'auto';
    body.style.display = 'block';
    body.style.padding = '24px 0 0';
    // Force layout now: without it the full-page capture can measure the page
    // before the stacked slides are laid out and clip the image to the viewport.
    void document.documentElement.scrollHeight;
    return frames.length;
  }
  return 0;
})()`;
