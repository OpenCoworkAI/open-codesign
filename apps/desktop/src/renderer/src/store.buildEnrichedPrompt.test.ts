import { describe, expect, it } from 'vitest';
import { buildEnrichedPrompt } from './store';

describe('buildEnrichedPrompt', () => {
  it('returns user prompt unchanged when there are no pending edits', () => {
    expect(buildEnrichedPrompt('make it blue', [])).toBe('make it blue');
  });

  it('prepends pinned element context and preserves the user prompt', () => {
    const prompt = buildEnrichedPrompt('tweak the page', [
      {
        selector: 'button.cta',
        tag: 'button',
        outerHTML: '<button class="cta">Try free</button>',
        text: 'Make this darker',
      },
    ]);
    expect(prompt).toContain('The user has pinned these elements');
    expect(prompt).toContain('button.cta');
    expect(prompt).toContain('<button class="cta">Try free</button>');
    expect(prompt).toContain('"Make this darker"');
    expect(prompt).toContain('tweak the page');
    // ordering: pins come first, user prompt last
    const pinsIdx = prompt.indexOf('The user has pinned');
    const userIdx = prompt.indexOf('tweak the page');
    expect(pinsIdx).toBeLessThan(userIdx);
  });

  it('substitutes a default trailer when the user prompt is empty', () => {
    const prompt = buildEnrichedPrompt('', [
      {
        selector: 'h1',
        tag: 'h1',
        outerHTML: '<h1>X</h1>',
        text: 'Shorter',
      },
    ]);
    expect(prompt).toContain('Apply the pending changes.');
  });

  it('truncates very long outerHTML blobs', () => {
    const big = 'x'.repeat(500);
    const prompt = buildEnrichedPrompt('p', [
      { selector: '#x', tag: 'div', outerHTML: big, text: 'ok' },
    ]);
    expect(prompt.length).toBeLessThan(500 + 400); // truncation applied
    expect(prompt).toContain('…');
  });

  it('numbers multiple edits sequentially', () => {
    const prompt = buildEnrichedPrompt('go', [
      { selector: 'a', tag: 'a', outerHTML: '<a/>', text: 'A' },
      { selector: 'b', tag: 'b', outerHTML: '<b/>', text: 'B' },
    ]);
    expect(prompt).toMatch(/1\. \[element: a/);
    expect(prompt).toMatch(/2\. \[element: b/);
  });
});
