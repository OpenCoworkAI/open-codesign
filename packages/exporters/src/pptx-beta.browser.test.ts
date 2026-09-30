import { describe, expect, it } from 'vitest';
import { findSystemChrome } from './chrome-discovery';
import { renderNativeSlides } from './pptx-native';

const chromePath = await findSystemChrome().catch(() => undefined);
const html = (body: string) => `<!doctype html><html><head><style>
  *{box-sizing:border-box}body{margin:0;font-family:Arial}
  [data-pptx-slide]{position:relative;width:1280px;height:720px;padding:40px;background:white}
  h1{margin:0 0 24px;font-size:32px}p{margin:12px 0;font-size:20px}
</style></head><body><section data-pptx-slide><h1>Editable overview</h1>${body}<p>Editable caption</p></section></body></html>`;

async function render(body: string) {
  const [model] = await renderNativeSlides(html(body), {
    ...(chromePath ? { chromePath } : {}),
    injectTailwind: false,
    renderTimeoutMs: 20_000,
  });
  if (!model) throw new Error('Expected one slide');
  return model;
}

describe.skipIf(!chromePath)('representative native PPTX Beta boundaries', () => {
  it.each([
    [
      'SVG chart',
      '<svg width="240" height="140"><rect width="100" height="120" fill="green"/><text x="10" y="40">Local chart</text></svg>',
      'complex content',
    ],
    [
      'table',
      '<table style="width:240px;height:140px;border-collapse:collapse"><tbody><tr><th>Local table</th><th>Value</th></tr><tr><td>Metric</td><td>42</td></tr></tbody></table>',
      'complex content',
    ],
    [
      'transform',
      '<div style="width:240px;height:140px;transform:rotate(5deg);background:#eef"><p>Local transform</p></div>',
      'transform',
    ],
    [
      'clip path',
      '<div style="width:240px;height:140px;clip-path:inset(5px round 12px);background:#eef"><p>Local clip</p></div>',
      'CSS compositing',
    ],
    [
      'group opacity',
      '<div style="width:240px;height:140px;opacity:.6;background:#eef"><p>Local opacity</p></div>',
      'opacity',
    ],
  ])(
    'keeps surrounding text native when %s needs one local raster',
    async (_name, body, reason) => {
      const model = await render(body);
      const texts = model.elements
        .filter((e) => e.type === 'text')
        .flatMap((e) => e.runs.map((r) => r.text));
      expect(texts).toEqual(['Editable overview', 'Editable caption']);
      const images = model.elements.filter((e) => e.type === 'image');
      expect(images).toHaveLength(1);
      expect(images[0]?.width).toBeLessThan(model.width / 2);
      expect(images[0]?.height).toBeLessThan(model.height / 2);
      expect(model.warnings.join(' ')).toContain(reason);
      expect(model.warnings.join(' ')).toContain('not editable');
    },
    30_000,
  );

  it('resolves an unavailable requested font rather than writing its absent name', async () => {
    const missing = 'MissingBetaFixtureFont_7F57';
    const model = await render(
      `<p style="font-family:'${missing}',Arial,sans-serif">Font fallback remains editable</p>`,
    );
    const runs = model.elements.filter((e) => e.type === 'text').flatMap((e) => e.runs);
    expect(runs.some((r) => r.text === 'Font fallback remains editable')).toBe(true);
    expect(runs.every((r) => r.fontFace !== missing && r.fontFace.length > 0)).toBe(true);
    expect(model.warnings.join(' ')).toContain(`instead of ${missing}`);
    expect(model.elements.some((e) => e.type === 'image')).toBe(false);
  }, 30_000);

  it('excludes ignored interactive controls and their generated decorations', async () => {
    const model = await render(
      '<style>.control::after{content:"Ignored badge";visibility:visible;position:absolute;inset:0;background:red}</style><div data-pptx-ignore class="control" style="position:absolute;inset:0;z-index:999;opacity:.8"><button>Ignore this control</button></div><p>Visible content</p>',
    );
    const texts = model.elements
      .filter((e) => e.type === 'text')
      .flatMap((e) => e.runs.map((r) => r.text));
    expect(texts).toEqual(['Editable overview', 'Visible content', 'Editable caption']);
    expect(model.elements.some((e) => e.type === 'image')).toBe(false);
  }, 30_000);
});
