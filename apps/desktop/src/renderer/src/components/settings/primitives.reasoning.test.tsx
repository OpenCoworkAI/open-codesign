// @vitest-environment happy-dom

import type { ThinkingLevelMap } from '@open-codesign/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReasoningDepthSelector } from './primitives';

const actions = vi.hoisted(() => ({ pushToast: vi.fn(), reportableErrorToast: vi.fn() }));
vi.mock('@open-codesign/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('../../store', () => ({
  useCodesignStore: (selector: (state: typeof actions) => unknown) => selector(actions),
}));

const updateProvider = vi.fn().mockResolvedValue(undefined);
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(window, 'codesign', {
    configurable: true,
    value: { config: { updateProvider } },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Reflect.deleteProperty(window, 'codesign');
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function render(map?: ThinkingLevelMap) {
  await act(async () =>
    root.render(
      <ReasoningDepthSelector
        provider="custom-ninfer"
        value="high"
        {...(map !== undefined ? { thinkingLevelMap: map } : {})}
        onUpdated={() => {}}
      />,
    ),
  );
  const select = container.querySelector('select');
  if (!select) throw new Error('Missing reasoning selector');
  return select;
}

describe('provider thinking whitelist selector', () => {
  it('offers only declared levels and displays the effective clamped value', async () => {
    const select = await render({ off: 'none', low: 'low', medium: 'medium', xhigh: 'xhigh' });
    expect(Array.from(select.options, (option) => option.value)).toEqual([
      '',
      'off',
      'low',
      'medium',
      'xhigh',
    ]);
    expect(select.value).toBe('xhigh');
    await act(async () => {
      select.value = 'low';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(updateProvider).toHaveBeenCalledWith({ id: 'custom-ninfer', reasoningLevel: 'low' });
  });

  it('keeps all existing choices when the optional map is absent', async () => {
    const select = await render();
    expect(Array.from(select.options, (option) => option.value)).toEqual([
      '',
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    expect(select.value).toBe('high');
  });
});
