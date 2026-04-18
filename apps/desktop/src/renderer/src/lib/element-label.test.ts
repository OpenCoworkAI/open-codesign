import { describe, expect, it } from 'vitest';
import { getElementLabel } from './element-label';

describe('getElementLabel', () => {
  it('maps HTML tags to friendly roles', () => {
    expect(
      getElementLabel({ tag: 'H1', outerHTML: '<h1>Welcome</h1>' }).role,
    ).toBe('heading');
    expect(
      getElementLabel({ tag: 'p', outerHTML: '<p>Hi there</p>' }).role,
    ).toBe('paragraph');
    expect(
      getElementLabel({ tag: 'BUTTON', outerHTML: '<button>Go</button>' }).role,
    ).toBe('button');
    expect(
      getElementLabel({ tag: 'svg', outerHTML: '<svg></svg>' }).role,
    ).toBe('icon');
  });

  it('falls back to the lowercased tag for unknown elements', () => {
    expect(
      getElementLabel({ tag: 'CUSTOM-WIDGET', outerHTML: '<custom-widget />' }).role,
    ).toBe('custom-widget');
  });

  it('strips inner tags and collapses whitespace from the preview text', () => {
    const label = getElementLabel({
      tag: 'div',
      outerHTML: '<div><strong>Hello</strong>\n   <em>world</em></div>',
    });
    expect(label.text).toBe('Hello world');
  });

  it('truncates text longer than 30 chars with an ellipsis', () => {
    const long = 'a'.repeat(60);
    const label = getElementLabel({ tag: 'p', outerHTML: `<p>${long}</p>` });
    expect(label.text.length).toBeLessThanOrEqual(30);
    expect(label.text.endsWith('\u2026')).toBe(true);
  });

  it('omits the quoted text in the display when the element has no text', () => {
    const label = getElementLabel({ tag: 'img', outerHTML: '<img src="x.png" alt="" />' });
    expect(label.display).toBe('image');
    expect(label.text).toBe('');
  });

  it('builds the combined display when both role and text are available', () => {
    const label = getElementLabel({ tag: 'h2', outerHTML: '<h2>Pricing</h2>' });
    expect(label.display).toBe('heading \u00b7 \u201cPricing\u201d');
  });
});
