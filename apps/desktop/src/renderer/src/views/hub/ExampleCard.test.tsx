import { getExample } from '@open-codesign/templates';
import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ExampleCard } from './ExampleCard';

vi.mock('@open-codesign/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@open-codesign/i18n')>()),
  useT: () => (key: string, options?: { count: number }) =>
    `${key}${options ? `:${options.count}` : ''}`,
}));

function findButton(node: ReactNode): (() => void) | undefined {
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return;
  if (node.type === 'button') return node.props.onClick;
  const children = node.props.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findButton(child);
    if (found) return found;
  }
}

describe('ExampleCard', () => {
  it('shows wrapping accessible feature chips and an inspectable input list', () => {
    const example = getExample('daymark', 'en');
    if (!example) throw new Error('Missing example');
    const html = renderToStaticMarkup(<ExampleCard example={example} onUsePrompt={vi.fn()} />);
    expect(html).toContain('aria-label="examples.featuresLabel"');
    expect(html).toContain('flex flex-wrap');
    expect(html).toContain('text-[length:var(--font-size-body-sm)]');
    expect(html).toContain('examples.inputFiles:5');
    expect(html).toContain('<details');
    for (const feature of example.features ?? [])
      expect(html).toContain(`examples.features.${feature}`);
    for (const file of example.inputFiles ?? []) expect(html).toContain(file);
    expect(html).toContain('examples.useDemoPack');
  });

  it.each(['daymark', 'cosmic-animation'])('passes all metadata unchanged for %s', (id) => {
    const example = getExample(id, 'en');
    if (!example) throw new Error('Missing example');
    const onUsePrompt = vi.fn();
    const click = findButton(ExampleCard({ example, onUsePrompt }));
    expect(click).toBeDefined();
    click?.();
    expect(onUsePrompt).toHaveBeenCalledWith(example);
    const html = renderToStaticMarkup(<ExampleCard example={example} onUsePrompt={onUsePrompt} />);
    if (!example.inputBundle) {
      expect(html).not.toContain('<details');
      expect(html).toContain('examples.useThisPrompt');
    }
  });
});
