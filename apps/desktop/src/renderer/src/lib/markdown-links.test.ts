import { describe, expect, it } from 'vitest';
import { classifyMarkdownHref } from './markdown-links';

describe('classifyMarkdownHref', () => {
  it('keeps in-document anchors clickable', () => {
    expect(classifyMarkdownHref('#details')).toEqual({ kind: 'anchor', href: '#details' });
  });

  it('routes https URLs through the safe external-open path', () => {
    expect(
      classifyMarkdownHref('https://github.com/OpenCoworkAI/open-codesign/issues/339'),
    ).toEqual({
      kind: 'external',
      url: 'https://github.com/OpenCoworkAI/open-codesign/issues/339',
    });
  });

  it('normalizes surrounding whitespace on external URLs', () => {
    expect(
      classifyMarkdownHref('  https://github.com/OpenCoworkAI/open-codesign/releases  '),
    ).toEqual({
      kind: 'external',
      url: 'https://github.com/OpenCoworkAI/open-codesign/releases',
    });
  });

  it('blocks relative links that would otherwise navigate the app document', () => {
    expect(classifyMarkdownHref('./other.md')).toEqual({ kind: 'blocked' });
    expect(classifyMarkdownHref('/absolute/path')).toEqual({ kind: 'blocked' });
  });

  it('blocks unsafe protocols', () => {
    expect(classifyMarkdownHref('javascript:alert(1)')).toEqual({ kind: 'blocked' });
    expect(classifyMarkdownHref('file:///Users/user/.ssh/id_rsa')).toEqual({ kind: 'blocked' });
    expect(classifyMarkdownHref('http://example.com')).toEqual({ kind: 'blocked' });
  });
});
