import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'puppeteer-core';
import { findSystemChrome } from './chrome-discovery';
import type { ExportPptxOptions } from './pptx';
import { extractNativeSlide } from './pptx-dom';
import type { NativeSlideModel } from './pptx-model';
import { buildExportHtmlDocument, shouldRenderForStaticDom } from './rendered-html';

const SLIDE_SELECTOR =
  '[data-pptx-slide], [data-slide], [data-slide-container], [data-slide-id], .slide';

async function waitForSlideAssets(page: Page, timeout: number): Promise<void> {
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete), {
    timeout,
  });
  await page.waitForFunction(() => document.fonts.status === 'loaded', { timeout });
  await page.evaluate(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

async function resolvePlatformFonts(page: Page): Promise<Record<string, string>> {
  const session = await page.createCDPSession();
  try {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const doc = await session.send('DOM.getDocument', { depth: -1 });
    const nodes: { nodeId: number; id: string }[] = [];
    const visit = (node: typeof doc.root) => {
      const attributes = node.attributes ?? [];
      const index = attributes.indexOf('data-codesign-pptx-node');
      const id = attributes[index + 1];
      if (
        index >= 0 &&
        id &&
        node.children?.some((child) => child.nodeType === 3 && child.nodeValue.trim())
      )
        nodes.push({ nodeId: node.nodeId, id });
      for (const child of node.children ?? []) visit(child);
    };
    visit(doc.root);
    const result: Record<string, string> = {};
    for (let index = 0; index < nodes.length; index += 16) {
      await Promise.all(
        nodes.slice(index, index + 16).map(async (node) => {
          const { fonts } = await session.send('CSS.getPlatformFontsForNode', {
            nodeId: node.nodeId,
          });
          const font = fonts.sort((a, b) => b.glyphCount - a.glyphCount)[0];
          if (font) result[node.id] = font.familyName;
        }),
      );
    }
    return result;
  } finally {
    await session.detach();
  }
}

/** Visibility changes preserve layout while ensuring local captures contain no sibling/native text. */
async function isolateCapture(
  page: Page,
  selector: string,
  mode: 'subtree' | 'decoration' | 'before' | 'after',
) {
  await page.evaluate(
    (input) => {
      const target = document.querySelector(input.selector);
      if (!(target instanceof Element)) throw new Error('PPTX capture source disappeared.');
      const all = Array.from(document.querySelectorAll<HTMLElement | SVGElement>('*'));
      const original = all.map((el) => ({
        el,
        style: el.getAttribute('style'),
        visible: getComputedStyle(el).visibility === 'visible',
        pseudos: ['before', 'after'].filter(
          (name) => getComputedStyle(el, `::${name}`).visibility === 'visible',
        ),
      }));
      const stylesheet = document.createElement('style');
      const state = window as unknown as { __pptxRestoreCapture?: () => void };
      state.__pptxRestoreCapture = () => {
        stylesheet.remove();
        for (const { el, style } of original) {
          if (style === null) el.removeAttribute('style');
          else el.setAttribute('style', style);
        }
        delete state.__pptxRestoreCapture;
      };
      for (const { el } of original) el.style.setProperty('visibility', 'hidden', 'important');
      // The HTML/body canvas background can paint even when visibility is hidden.
      for (const el of [document.documentElement, document.body]) {
        if (el !== target && !target.contains(el))
          el.style.setProperty('background', 'transparent', 'important');
      }
      const current = target as HTMLElement | SVGElement;
      stylesheet.textContent = '*::before,*::after{visibility:hidden!important}';
      if (input.mode === 'subtree') {
        for (const { el, visible, pseudos } of original)
          if (visible && (el === target || target.contains(el))) {
            el.style.setProperty('visibility', 'visible', 'important');
            const id = el.getAttribute('data-codesign-pptx-node');
            if (id)
              for (const name of pseudos)
                stylesheet.textContent += `[data-codesign-pptx-node="${id}"]::${name}{visibility:visible!important}`;
          }
      } else if (input.mode === 'decoration') {
        current.style.setProperty('visibility', 'visible', 'important');
        current.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
        current.style.setProperty('text-shadow', 'none', 'important');
        current.style.setProperty('text-decoration-color', 'transparent', 'important');
        stylesheet.textContent += `${input.selector}::before,${input.selector}::after{visibility:hidden!important}`;
      } else {
        stylesheet.textContent += `${input.selector}::${input.mode}{visibility:visible!important}`;
      }
      document.head.appendChild(stylesheet);
    },
    { selector, mode },
  );
}

export async function renderNativeSlides(
  artifactSource: string,
  opts: ExportPptxOptions,
): Promise<NativeSlideModel[]> {
  const puppeteer = (await import('puppeteer-core')).default;
  const executablePath = opts.chromePath ?? (await findSystemChrome());
  const html = await buildExportHtmlDocument(artifactSource, opts);
  const timeout = opts.renderTimeoutMs ?? 45_000;
  const viewport = opts.viewport ?? { width: 1280, height: 720 };
  if (![viewport.width, viewport.height].every((value) => Number.isInteger(value) && value > 0))
    throw new Error('PPTX viewport dimensions must be positive integers.');
  const userDataDir = await mkdtemp(join(tmpdir(), 'codesign-pptx-native-'));
  let browser: Browser | undefined;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      userDataDir,
      args: [
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(timeout);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await page.setViewport({ ...viewport, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'load', timeout });
    if (shouldRenderForStaticDom(artifactSource, opts))
      await page.waitForFunction(
        () => (document.getElementById('root')?.childElementCount ?? 0) > 0,
      );
    await page.addStyleTag({
      content: `
      *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
      [data-pptx-ignore] { display: none !important; }
      html, body { margin: 0 !important; scroll-behavior: auto !important; }
    `,
    });
    await page.evaluate(() => {
      for (const image of document.images) image.loading = 'eager';
    });
    await waitForSlideAssets(page, timeout);
    if (pageErrors.length) throw new Error(`Slide runtime error: ${pageErrors[0]}`);
    const metadata = await page.evaluate(
      (input) => {
        for (const el of document.querySelectorAll(
          '[data-codesign-pptx-page], [data-codesign-pptx-node]',
        )) {
          el.removeAttribute('data-codesign-pptx-page');
          el.removeAttribute('data-codesign-pptx-node');
        }
        let candidates = Array.from(document.querySelectorAll(input.selector));
        let poster = false;
        if (!candidates.length && !input.custom) {
          const posters = Array.from(
            document.querySelectorAll('[data-pptx-poster], [class]'),
          ).filter((el) => {
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            if (
              style.display === 'none' ||
              style.visibility !== 'visible' ||
              rect.width <= 0 ||
              rect.height <= 0 ||
              el.closest('[data-pptx-ignore]')
            )
              return false;
            return (
              el.hasAttribute('data-pptx-poster') ||
              (Array.from(el.classList).some((name) => /(^|[-_])poster$/i.test(name)) &&
                style.aspectRatio !== 'auto' &&
                rect.height > rect.width)
            );
          });
          const outerPosters = posters.filter(
            (el) => !posters.some((other) => other !== el && other.contains(el)),
          );
          // A unique, explicitly proportioned poster is safer than guessing among arbitrary cards/articles.
          if (outerPosters.length === 1) {
            candidates = outerPosters;
            poster = true;
          }
        }
        if (!candidates.length && !input.custom)
          candidates = Array.from(document.querySelectorAll('section'));
        let fallback = false;
        if (!candidates.length && !input.custom) {
          candidates = [document.getElementById('root') ?? document.body];
          fallback = true;
        }
        const slides = candidates.filter(
          (el) => !candidates.some((other) => other !== el && other.contains(el)),
        );
        const ancestors = new Set<HTMLElement>();
        for (const [index, el] of slides.entries()) {
          el.setAttribute('data-codesign-pptx-page', String(index));
          let parent = el.parentElement;
          while (parent) {
            ancestors.add(parent);
            parent = parent.parentElement;
          }
        }
        const state = window as unknown as { __pptxRestorePage?: () => void };
        const original = [...ancestors, ...slides].map((el) => ({
          el,
          style: el.getAttribute('style'),
          className: el.getAttribute('class'),
        }));
        state.__pptxRestorePage = () => {
          for (const { el, style, className } of original) {
            if (style === null) el.removeAttribute('style');
            else el.setAttribute('style', style);
            if (className === null) el.removeAttribute('class');
            else el.setAttribute('class', className);
          }
        };
        return { count: slides.length, fallback, poster };
      },
      { selector: opts.slideSelector ?? SLIDE_SELECTOR, custom: !!opts.slideSelector },
    );
    if (!metadata.count) throw new Error('No slides matched the supplied PPTX slideSelector.');
    const models: NativeSlideModel[] = [];
    for (let index = 0; index < metadata.count; index++) {
      await page.evaluate(
        (input) => {
          const state = window as unknown as { __pptxRestorePage?: () => void };
          state.__pptxRestorePage?.();
          const el = document.querySelector<HTMLElement>(
            `[data-codesign-pptx-page="${input.index}"]`,
          );
          if (!(el instanceof HTMLElement))
            throw new Error('PPTX slide container changed or is not an HTML element.');
          for (const other of document.querySelectorAll<HTMLElement>('[data-codesign-pptx-page]'))
            if (other !== el) other.style.setProperty('display', 'none', 'important');
          // The export document is private. Remove preview-only ancestor transforms, not design transforms inside a slide.
          for (let parent = el.parentElement; parent; parent = parent.parentElement) {
            for (const property of [
              'transform',
              'rotate',
              'scale',
              'translate',
              'perspective',
              'filter',
              'backdrop-filter',
              'contain',
              'clip-path',
              'mask-image',
            ])
              parent.style.setProperty(property, 'none', 'important');
            parent.style.setProperty('zoom', '1', 'important');
            parent.style.setProperty('overflow', 'visible', 'important');
            parent.style.setProperty('clip', 'auto', 'important');
            parent.style.setProperty('opacity', '1', 'important');
            if (getComputedStyle(parent).display === 'none')
              parent.style.setProperty('display', 'block', 'important');
          }
          if (getComputedStyle(el).display === 'none') el.classList.add('active');
          if (getComputedStyle(el).display === 'none')
            el.style.setProperty('display', 'block', 'important');
          const s = getComputedStyle(el);
          const px = (value: string) => Number.parseFloat(value) || 0;
          const contentBox = s.boxSizing !== 'border-box';
          let width =
            px(s.width) +
            (contentBox
              ? px(s.paddingLeft) +
                px(s.paddingRight) +
                px(s.borderLeftWidth) +
                px(s.borderRightWidth)
              : 0);
          let height =
            px(s.height) +
            (contentBox
              ? px(s.paddingTop) +
                px(s.paddingBottom) +
                px(s.borderTopWidth) +
                px(s.borderBottomWidth)
              : 0);
          if (input.fallback) {
            width = Math.max(width, el.scrollWidth);
            height = Math.max(height, el.scrollHeight);
          }
          el.style.setProperty('position', 'fixed', 'important');
          el.style.setProperty('left', '0', 'important');
          el.style.setProperty('top', '0', 'important');
          el.style.setProperty('right', 'auto', 'important');
          el.style.setProperty('bottom', 'auto', 'important');
          el.style.setProperty('margin', '0', 'important');
          el.style.setProperty('visibility', 'visible', 'important');
          el.style.setProperty('width', `${width || input.viewport.width}px`, 'important');
          el.style.setProperty('height', `${height || input.viewport.height}px`, 'important');
          el.style.setProperty('box-sizing', 'border-box', 'important');
          window.scrollTo(0, 0);
          for (const [nodeIndex, node] of [el, ...el.querySelectorAll('*')].entries())
            node.setAttribute('data-codesign-pptx-node', `${input.index}-${nodeIndex}`);
        },
        { index, viewport, fallback: metadata.fallback },
      );
      await waitForSlideAssets(page, timeout);
      if (pageErrors.length) throw new Error(`Slide runtime error: ${pageErrors[0]}`);
      const fonts = await resolvePlatformFonts(page);
      const handle = await page.$(`[data-codesign-pptx-page="${index}"]`);
      if (!handle) throw new Error('Slide container disappeared during export.');
      const model = await handle.evaluate(extractNativeSlide, fonts);
      if (model.width <= 0 || model.height <= 0)
        throw new Error(`Slide ${index + 1} has no visible dimensions.`);
      if (metadata.fallback)
        model.warnings.push(
          'No explicit slide containers; exported the complete document as one fitted slide. Add slide markers to paginate long pages.',
        );
      if (metadata.poster) {
        model.pageLayout = 'source';
        model.warnings.push(
          'Single poster artboard detected; exported at its source aspect ratio without the preview stage.',
        );
      } else if (Math.abs(model.width / model.height - 16 / 9) > 0.01)
        model.warnings.push('Non-16:9 slide fitted with whitespace; content was not stretched.');
      for (const [nodeIndex, node] of model.elements.entries()) {
        if (node.type !== 'raster') continue;
        try {
          if (node.selector) await isolateCapture(page, node.selector, node.capture ?? 'subtree');
          const image = await page.screenshot({
            type: 'png',
            clip: node.clip,
            omitBackground: true,
          });
          model.elements[nodeIndex] = {
            type: 'image',
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
            data: `data:image/png;base64,${Buffer.from(image).toString('base64')}`,
          };
        } finally {
          await page.evaluate(() => {
            (window as unknown as { __pptxRestoreCapture?: () => void }).__pptxRestoreCapture?.();
          });
        }
      }
      models.push(model);
      await handle.dispose();
    }
    return models;
  } finally {
    try {
      await browser?.close();
    } finally {
      await rm(userDataDir, { recursive: true, force: true });
    }
  }
}
