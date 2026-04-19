import { describe, expect, it } from 'vitest';
import { buildSrcdoc } from './index';

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

  it('injects baseline into a full document with <head>', () => {
    const html = '<!doctype html><html><head><title>t</title></head><body>y</body></html>';
    const out = buildSrcdoc(html);
    expect(out).toContain('background:var(--color-artifact-bg, #ffffff)');
    expect(out.indexOf('background:var(--color-artifact-bg, #ffffff)')).toBeLessThan(
      out.indexOf('<title>t</title>'),
    );
  });
});
