import { createHash } from 'node:crypto';
import type { ResearchSlide } from '@open-codesign/shared';
import { type BrowserRenderOptions, renderArtifactBodyHtml } from './rendered-html';

export const RESEARCH_SLIDES_SCRIPT = `(() => {
  const sections = Array.from(document.querySelectorAll('section'));
  const slides = sections.length ? sections : Array.from(document.querySelectorAll('[data-slide], [data-pptx-slide], [data-slide-container], .slide'));
  if (!slides.length && document.getElementById('root')?.childElementCount === 0) throw new Error('Research deck did not render. Repair preview/runtime errors before linking or exporting sources.');
  const ids = new Set();
  return JSON.stringify(slides.map(el => {
    const id = el.getAttribute('data-slide-id');
    if (!id || ids.has(id)) throw new Error('Every research slide needs a unique stable data-slide-id.');
    ids.add(id);
    if (el.querySelector('canvas, iframe, video')) throw new Error('Research slides require inspectable text/SVG charts, not canvas/iframe/video.');
    const copy = el.cloneNode(true);
    copy.querySelectorAll('script, style').forEach(node => node.remove());
    const text = (copy.textContent || '').replace(/\\s+/g, ' ').trim();
    const semantics = Array.from(copy.querySelectorAll('*')).flatMap(node => {
      const values = [];
      for (const attr of node.attributes) {
        if (/^(data-(?:research|value|series)|aria-label|alt$|src$|d$|points$|x[12]?$|y[12]?$|cx$|cy$|r$|width$|height$)/.test(attr.name)) values.push([attr.name, attr.value]);
      }
      return values.length ? [[node.tagName, values]] : [];
    });
    return { id, title: (el.querySelector('h1,h2,h3')?.textContent || '').trim(), semantic: JSON.stringify([text, semantics]) };
  }));
})()`;

export async function readResearchSlides(
  source: string,
  opts: BrowserRenderOptions = {},
): Promise<ResearchSlide[]> {
  const rows: Array<{ id: string; title: string; semantic: string }> = JSON.parse(
    await renderArtifactBodyHtml(source, opts, RESEARCH_SLIDES_SCRIPT),
  );
  return rows.map(({ id, title, semantic }) => ({
    id,
    title,
    fingerprint: createHash('sha256').update(semantic).digest('hex'),
  }));
}
