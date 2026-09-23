import { initI18n } from '@open-codesign/i18n';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PromptInput } from './PromptInput';

beforeAll(async () => {
  await initI18n('en');
});

describe('prompt composer structure', () => {
  it('gives text its own full-width surface before a separate action row', () => {
    const html = renderToStaticMarkup(
      <PromptInput
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isGenerating={false}
        leadingAction={<button type="button">Attach reference</button>}
        contextSummary={<span>brief.md</span>}
      />,
    );
    expect(html.indexOf('brief.md')).toBeLessThan(html.indexOf('<textarea'));
    expect(html.indexOf('</textarea>')).toBeLessThan(html.indexOf('codesign-prompt-actions'));
    expect(html.indexOf('codesign-prompt-actions')).toBeLessThan(html.indexOf('Attach reference'));
    expect(html).toContain('rows="2"');
    expect(html).toContain('aria-label="');
    expect(html).toContain('w-full');
    expect(html).toContain('var(--size-control-md)');
    expect(html).toContain('disabled=""');
  });

  it('keeps stop distinct from submission while generation is active', () => {
    const html = renderToStaticMarkup(
      <PromptInput onSubmit={vi.fn()} onCancel={vi.fn()} isGenerating />,
    );
    expect(html).toContain('aria-label="Stop');
    expect(html).not.toContain('type="submit"');
    expect(html).toContain('aria-live="polite"');
  });

  it('keeps an empty active composer free of follow-up actions and guidance', () => {
    const html = renderToStaticMarkup(
      <PromptInput
        onSubmit={vi.fn()}
        onActiveSubmit={vi.fn(async () => {})}
        onCancel={vi.fn()}
        isGenerating
      />,
    );
    expect(html).not.toContain('Queue follow-up');
    expect(html).not.toContain('Steer next step');
    expect(html).toContain('aria-label="Stop');
    expect(html).not.toContain('type="submit"');
    expect(html).not.toContain('text-only');
    expect(html).not.toContain('tool batch');
    expect(html).not.toContain('permission request');
  });
});
