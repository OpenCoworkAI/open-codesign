import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, sanitizeUrl } from './markdown';

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

  it('strips javascript: links but keeps the visible text', () => {
    const out = htmlToMarkdown('<p><a href="javascript:alert(1)">x</a></p>', META);
    expect(out).toContain('x');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('](');
  });

  it('keeps https links untouched', () => {
    const out = htmlToMarkdown('<a href="https://x.test">x</a>', META);
    expect(out).toContain('[x](https://x.test)');
  });

  it('allows mailto and relative link schemes', () => {
    const out = htmlToMarkdown(
      '<a href="mailto:a@b.test">mail</a><a href="/foo">rel</a><a href="#anchor">anc</a>',
      META,
    );
    expect(out).toContain('[mail](mailto:a@b.test)');
    expect(out).toContain('[rel](/foo)');
    expect(out).toContain('[anc](#anchor)');
  });

  it('keeps inline data:image/* sources', () => {
    const src = 'data:image/png;base64,iVBORw0KGgo=';
    const out = htmlToMarkdown(`<img src="${src}" alt="px" />`, META);
    expect(out).toContain(`![px](${src})`);
  });

  it('strips non-image data: URLs from images', () => {
    const out = htmlToMarkdown('<img src="data:text/html,<script>x</script>" alt="bad" />', META);
    expect(out).not.toContain('data:text/html');
    expect(out).not.toContain('![bad]');
  });

  it('strips other dangerous schemes (vbscript:, file:)', () => {
    const out = htmlToMarkdown(
      '<a href="vbscript:msgbox">v</a><a href="file:///etc/passwd">f</a>',
      META,
    );
    expect(out).not.toContain('vbscript:');
    expect(out).not.toContain('file:');
    expect(out).toContain('v');
    expect(out).toContain('f');
  });
});

describe('sanitizeUrl encoded-scheme bypass guard', () => {
  it('rejects HTML hex-entity encoded javascript scheme', () => {
    expect(sanitizeUrl('&#x6A;avascript:alert(1)', 'link')).toBeNull();
  });

  it('rejects HTML decimal-entity encoded javascript scheme', () => {
    expect(sanitizeUrl('&#106;avascript:alert(1)', 'link')).toBeNull();
  });

  it('rejects entity-encoded colon javascript scheme', () => {
    expect(sanitizeUrl('javascript&#58;alert(1)', 'link')).toBeNull();
  });

  it('rejects URL percent-encoded javascript scheme', () => {
    expect(sanitizeUrl('%6Aavascript:alert(1)', 'link')).toBeNull();
  });

  it('rejects javascript scheme with leading whitespace', () => {
    expect(sanitizeUrl(' javascript:alert(1)', 'link')).toBeNull();
  });

  it('rejects javascript scheme with leading tab', () => {
    expect(sanitizeUrl('\tjavascript:alert(1)', 'link')).toBeNull();
  });

  it('rejects javascript scheme with embedded tab/newline before colon', () => {
    expect(sanitizeUrl('java\tscript:alert(1)', 'link')).toBeNull();
    expect(sanitizeUrl('java\nscript:alert(1)', 'link')).toBeNull();
  });

  it('rejects mixed-case javascript scheme', () => {
    expect(sanitizeUrl('JavaScript:alert(1)', 'link')).toBeNull();
  });

  it('still permits safe http/mailto/relative URLs after decoding', () => {
    expect(sanitizeUrl('https://x.test', 'link')).toBe('https://x.test');
    expect(sanitizeUrl('mailto:a@b.test', 'link')).toBe('mailto:a@b.test');
    expect(sanitizeUrl('/foo/bar', 'link')).toBe('/foo/bar');
    expect(sanitizeUrl('#anchor', 'link')).toBe('#anchor');
  });

  it('strips entity-encoded javascript when used inside markdown link conversion', () => {
    const out = htmlToMarkdown('<p><a href="&#x6A;avascript:alert(1)">x</a></p>', {
      title: 'Demo',
      schemaVersion: 1,
    });
    expect(out).toContain('x');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('](');
  });

  it('keeps URLs containing percent-encoded path/query characters as-is', () => {
    expect(sanitizeUrl('https://example.com/path?q=%2F', 'link')).toBe(
      'https://example.com/path?q=%2F',
    );
    expect(sanitizeUrl('https://example.com/p%C3%A9', 'link')).toBe('https://example.com/p%C3%A9');
  });

  it('keeps URLs with stray literal % that would break decodeURIComponent', () => {
    expect(sanitizeUrl('https://x.test/?q=100%', 'link')).toBe('https://x.test/?q=100%');
  });
});
