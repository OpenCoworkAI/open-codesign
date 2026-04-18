import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from './markdown';

const META = { title: 'Demo', schemaVersion: 1 as const };

describe('htmlToMarkdown', () => {
  it('writes a YAML frontmatter with title and schemaVersion', () => {
    const out = htmlToMarkdown('<p>hi</p>', META);
    expect(out.startsWith('---\ntitle: Demo\nschemaVersion: 1\n---\n')).toBe(true);
    expect(out).toContain('hi');
  });

  it('converts headings h1..h6', () => {
    const html = '<h1>One</h1><h2>Two</h2><h3>Three</h3><h6>Six</h6>';
    const out = htmlToMarkdown(html, META);
    expect(out).toContain('# One');
    expect(out).toContain('## Two');
    expect(out).toContain('### Three');
    expect(out).toContain('###### Six');
  });

  it('converts paragraphs to blank-line wrapped text', () => {
    const out = htmlToMarkdown('<p>First</p><p>Second</p>', META);
    expect(out).toMatch(/First\n\nSecond/);
  });

  it('converts links and images', () => {
    const out = htmlToMarkdown(
      '<a href="https://example.com">site</a><img src="/a.png" alt="logo" />',
      META,
    );
    expect(out).toContain('[site](https://example.com)');
    expect(out).toContain('![logo](/a.png)');
  });

  it('converts unordered and ordered lists', () => {
    const ul = htmlToMarkdown('<ul><li>a</li><li>b</li></ul>', META);
    expect(ul).toContain('- a');
    expect(ul).toContain('- b');
    const ol = htmlToMarkdown('<ol><li>x</li><li>y</li></ol>', META);
    expect(ol).toContain('1. x');
    expect(ol).toContain('2. y');
  });

  it('converts strong/em/code/pre', () => {
    const out = htmlToMarkdown(
      '<p><strong>bold</strong> and <em>italic</em> with <code>x</code></p><pre>line1\nline2</pre>',
      META,
    );
    expect(out).toContain('**bold**');
    expect(out).toContain('*italic*');
    expect(out).toContain('`x`');
    expect(out).toContain('```\nline1\nline2\n```');
  });

  it('strips script/style/head and unknown tags', () => {
    const out = htmlToMarkdown(
      '<head><title>x</title></head><script>evil()</script><style>.a{}</style><div><p>kept</p></div>',
      META,
    );
    expect(out).not.toContain('evil');
    expect(out).not.toContain('.a{}');
    expect(out).toContain('kept');
  });

  it('decodes entities', () => {
    const out = htmlToMarkdown('<p>A &amp; B &lt; C</p>', META);
    expect(out).toContain('A & B < C');
  });

  it('handles empty input gracefully', () => {
    const out = htmlToMarkdown('', META);
    expect(out).toContain('schemaVersion: 1');
  });

  it('handles malformed HTML without throwing', () => {
    const out = htmlToMarkdown('<p>open<strong>bold<p>next', META);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });
});
