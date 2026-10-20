import { getExample, type LocalizedExample } from '@open-codesign/templates';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HubView } from './HubView';

let select: ((example: LocalizedExample) => void | Promise<void>) | undefined;
vi.mock('../store', () => ({
  useCodesignStore: (selector: (state: { hubTab: string }) => unknown) =>
    selector({ hubTab: 'examples' }),
}));
vi.mock('./hub/ExamplesTab', () => ({
  ExamplesTab: (props: { onUsePrompt: typeof select }) => {
    select = props.onUsePrompt;
    return <div>Examples</div>;
  },
}));
vi.mock('./hub/DesignSystemsTab', () => ({ DesignSystemsTab: () => null }));
vi.mock('./hub/RecentTab', () => ({ RecentTab: () => null }));
vi.mock('./hub/YourDesignsTab', () => ({ YourDesignsTab: () => null }));

describe('Hub example selection', () => {
  it('forwards complete localized metadata and waits for the host preparation', async () => {
    const example = getExample('common-ground', 'zh-CN');
    if (!example) throw new Error('Missing example');
    const promise = Promise.resolve();
    const onUseExamplePrompt = vi.fn(() => promise);
    renderToStaticMarkup(<HubView onUseExamplePrompt={onUseExamplePrompt} />);
    expect(select?.(example)).toBe(promise);
    await promise;
    expect(onUseExamplePrompt).toHaveBeenCalledWith(example);
    expect(example.inputFiles).toHaveLength(5);
  });
});
