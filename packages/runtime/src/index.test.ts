import { describe, expect, it } from 'vitest';
import { buildSrcdoc } from './index';

const BODY_OPEN_RE = /<body[^>]*>/i;

describe('buildSrcdoc', () => {
  it('wraps a fragment in a full document', () => {
    const out = buildSrcdoc('<div>hi</div>');
    expect(out).toContain('<!doctype html>');
    expect(out).toContain('<div>hi</div>');
    expect(out).toContain('ELEMENT_SELECTED');
  });

  it('injects overlay before </body> in a full document', () => {
    const html = '<html><body><p>x</p></body></html>';
    const out = buildSrcdoc(html);
    expect(out).toContain('<p>x</p>');
    expect(out.indexOf('ELEMENT_SELECTED')).toBeLessThan(out.indexOf('</body>'));
  });

  it('strips CSP meta tags', () => {
    const html =
      '<html><head><meta http-equiv="Content-Security-Policy" content="default-src none"></head><body></body></html>';
    const out = buildSrcdoc(html);
    expect(out).not.toContain('Content-Security-Policy');
  });

  it('injects baseline artifact-bg token before artifact head styles so artifact dark body bg wins', () => {
    const html =
      '<html><head><style>body { background: #0a0a0a; color: white; }</style></head><body><div>dark</div></body></html>';
    const out = buildSrcdoc(html);
    const baselineIdx = out.indexOf('background:var(--color-artifact-bg, #ffffff)');
    const artifactIdx = out.indexOf('background: #0a0a0a');
    expect(baselineIdx).toBeGreaterThanOrEqual(0);
    expect(artifactIdx).toBeGreaterThanOrEqual(0);
    expect(baselineIdx).toBeLessThan(artifactIdx);
  });

  it('injects baseline bg into a fragment template', () => {
    const out = buildSrcdoc('<div>hi</div>');
    expect(out).toContain('background:var(--color-artifact-bg, #ffffff)');
  });

  it('synthesises a head when artifact has <html> but no <head>', () => {
    const html = '<html><body><style>body { background: #000 }</style>x</body></html>';
    const out = buildSrcdoc(html);
    expect(out).toContain('background:var(--color-artifact-bg, #ffffff)');
    expect(out.indexOf('background:var(--color-artifact-bg, #ffffff)')).toBeLessThan(
      out.indexOf('background: #000'),
    );
  });

  it('wraps a body-only document (no <html>/<head>) and injects baseline', () => {
    const html = '<body><style>body { background: #111 }</style><p>x</p></body>';
    const out = buildSrcdoc(html);
    expect(out).toContain('background:var(--color-artifact-bg, #ffffff)');
    expect(out).toContain('<p>x</p>');
    expect(out).toContain('ELEMENT_SELECTED');
    expect(out.indexOf('background:var(--color-artifact-bg, #ffffff)')).toBeLessThan(
      out.indexOf('background: #111'),
    );
    // overlay script must land inside the body, before </body>
    expect(out.indexOf('ELEMENT_SELECTED')).toBeLessThan(out.indexOf('</body>'));
  });

  it('wraps a plain fragment with no html/head/body and injects baseline', () => {
    const out = buildSrcdoc('<div>plain</div>');
    expect(out).toContain('<!doctype html>');
    expect(out).toContain('background:var(--color-artifact-bg, #ffffff)');
    expect(out).toContain('<div>plain</div>');
    expect(out).toContain('ELEMENT_SELECTED');
  });

  describe('body tag shape normalization', () => {
    it('shape 1: leaves matched <body>...</body> intact', () => {
      const html = '<html><head></head><body><p>both</p></body></html>';
      const out = buildSrcdoc(html);
      expect(out).toContain('<p>both</p>');
      expect(out.match(/<body[^>]*>/gi)?.length).toBe(1);
      expect(out.match(/<\/body\s*>/gi)?.length).toBe(1);
      expect(out.indexOf('<body')).toBeLessThan(out.indexOf('<p>both</p>'));
      expect(out.indexOf('<p>both</p>')).toBeLessThan(out.indexOf('</body>'));
    });

    it('shape 2: appends </body> when only opener is present', () => {
      const html = '<html><head></head><body><p>open only</p>';
      const out = buildSrcdoc(html);
      expect(out.match(/<body[^>]*>/gi)?.length).toBe(1);
      expect(out.match(/<\/body\s*>/gi)?.length).toBe(1);
      expect(out.indexOf('<p>open only</p>')).toBeLessThan(out.indexOf('</body>'));
      expect(out.indexOf('ELEMENT_SELECTED')).toBeLessThan(out.indexOf('</body>'));
    });

    it('shape 3: injects <body> opener before content when only </body> is present', () => {
      const html = '<p>close only</p></body>';
      const out = buildSrcdoc(html);
      const bodyOpen = out.search(BODY_OPEN_RE);
      const contentIdx = out.indexOf('<p>close only</p>');
      const bodyClose = out.indexOf('</body>');
      expect(bodyOpen).toBeGreaterThanOrEqual(0);
      expect(bodyOpen).toBeLessThan(contentIdx);
      expect(contentIdx).toBeLessThan(bodyClose);
      expect(out.match(/<body[^>]*>/gi)?.length).toBe(1);
      expect(out.match(/<\/body\s*>/gi)?.length).toBe(1);
    });

    it('shape 3: injects <body> after <head> when </body> present without opener', () => {
      const html = '<html><head><title>t</title></head><p>x</p></body></html>';
      const out = buildSrcdoc(html);
      const headClose = out.indexOf('</head>');
      const bodyOpen = out.search(BODY_OPEN_RE);
      const contentIdx = out.indexOf('<p>x</p>');
      expect(headClose).toBeGreaterThanOrEqual(0);
      expect(bodyOpen).toBeGreaterThan(headClose);
      expect(bodyOpen).toBeLessThan(contentIdx);
    });

    it('shape 4: wraps content in <body>...</body> when neither tag is present', () => {
      const out = buildSrcdoc('<div>none</div>');
      expect(out).toContain('<body>');
      expect(out).toContain('</body>');
      expect(out.indexOf('<body>')).toBeLessThan(out.indexOf('<div>none</div>'));
      expect(out.indexOf('<div>none</div>')).toBeLessThan(out.indexOf('</body>'));
    });
  });

  it('injects baseline into a full document with <head>', () => {
    const html = '<!doctype html><html><head><title>t</title></head><body>y</body></html>';
    const out = buildSrcdoc(html);
    expect(out).toContain('background:var(--color-artifact-bg, #ffffff)');
    expect(out.indexOf('background:var(--color-artifact-bg, #ffffff)')).toBeLessThan(
      out.indexOf('<title>t</title>'),
    );
  });
});
