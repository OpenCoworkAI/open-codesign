import { describe, expect, it } from 'vitest';
import { buildAnchor, formatAnchorForPrompt } from './comment-anchor';

describe('comment-anchor', () => {
  it('builds a minimal anchor from a path', () => {
    const a = buildAnchor({ path: ['html', 'body', 'main', 'h1:nth-of-type(1)'] });
    expect(a.domPath.length).toBe(4);
    expect(a.innerText).toBeUndefined();
  });

  it('truncates long text with ellipsis', () => {
    const longText = 'lorem ipsum '.repeat(20);
    const a = buildAnchor({ path: ['p'], text: longText });
    expect(a.innerText?.length).toBe(80);
    expect(a.innerText?.endsWith('…')).toBe(true);
  });

  it('caps domPath length to 12', () => {
    const path = Array.from({ length: 20 }, (_, i) => `n${i}`);
    expect(buildAnchor({ path }).domPath.length).toBe(12);
  });

  it('only keeps tracked styles', () => {
    const a = buildAnchor({
      path: ['p'],
      styles: { color: '#fff', visibility: 'visible', 'font-size': '14px' },
    });
    expect(a.computedStyles).toEqual({ color: '#fff', 'font-size': '14px' });
  });

  it('formatAnchorForPrompt renders self-closing markers', () => {
    const a = buildAnchor({
      path: ['html', 'body', 'h1'],
      text: 'Hello',
      rect: { x: 10, y: 20, width: 200, height: 40 },
    });
    const out = formatAnchorForPrompt(a);
    expect(out.startsWith('<comment-anchor>')).toBe(true);
    expect(out.endsWith('</comment-anchor>')).toBe(true);
    expect(out).toContain('text: "Hello"');
    expect(out).toContain('rect: x=10 y=20 w=200 h=40');
  });
});
