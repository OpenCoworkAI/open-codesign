import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorDetails, summarizeError } from './ErrorDetails';

describe('compact error diagnostics', () => {
  it('keeps a short actionable error visible without a redundant disclosure', () => {
    const html = renderToStaticMarkup(<ErrorDetails message="Permission denied" />);
    expect(html).toContain('Permission denied');
    expect(html).not.toContain('<details');
  });

  it('summarizes validation failures without showing raw arguments by default', () => {
    const reason =
      'Validation failed for tool "preview":\n- steps: must not have more than 16 items';
    const message = `${reason}\nReceived arguments: ${JSON.stringify({
      path: 'App.jsx',
      steps: Array.from({ length: 17 }, (_, index) => ({
        action: 'assert',
        selector: `#check-${index}`,
      })),
    })}`;
    expect(summarizeError(message)).toBe(reason.replace(/\s+/g, ' '));
    const html = renderToStaticMarkup(<ErrorDetails message={message} />);
    expect(html).toContain('<details');
    expect(html).not.toMatch(/<details[^>]*\bopen/);
    expect(html).toContain('Received arguments:');
    expect(html).toContain('#check-16');
    expect(html.slice(html.indexOf('<summary'), html.indexOf('</summary>'))).not.toContain(
      'Received arguments:',
    );
  });

  it('bounds other errors without deleting their original diagnostic details', () => {
    const message = 'Long diagnostic <not-html>\n'.repeat(100);
    expect(summarizeError(message)).toHaveLength(200);
    const html = renderToStaticMarkup(<ErrorDetails message={message} />);
    expect(html).toContain('&lt;not-html&gt;');
    expect(html).not.toContain('<not-html>');
    expect(html.split('Long diagnostic').length).toBeGreaterThan(100);
  });
});
