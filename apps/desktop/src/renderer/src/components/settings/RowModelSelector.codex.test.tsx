// @vitest-environment happy-dom

import type { OnboardingState } from '@open-codesign/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProviderRow } from '../../../../preload/index';
import { RowModelSelector } from './primitives';

const translate = (key: string) => key;
vi.mock('@open-codesign/i18n', () => ({ useT: () => translate, getCurrentLocale: () => 'en' }));
const storeAction = vi.hoisted(() => vi.fn());
vi.mock('../../store', () => ({ useCodesignStore: () => storeAction }));
vi.mock('../../lib/action-timeline', () => ({ recordAction: vi.fn() }));

const config: OnboardingState = {
  hasKey: true,
  provider: 'chatgpt-codex',
  modelPrimary: 'saved-model',
  baseUrl: 'https://chatgpt.com/backend-api',
  designSystem: null,
};
const row: ProviderRow = {
  provider: 'chatgpt-codex',
  maskedKey: '',
  baseUrl: config.baseUrl,
  isActive: true,
  label: 'ChatGPT',
  name: 'ChatGPT',
  builtin: false,
  wire: 'openai-codex-responses',
  defaultModel: 'saved-model',
  hasKey: true,
  requiresApiKey: false,
};
const setActiveProvider = vi.fn();
const updateProvider = vi.fn();
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  setActiveProvider.mockResolvedValue(config);
  updateProvider.mockResolvedValue(config);
  Object.defineProperty(window, 'codesign', {
    configurable: true,
    value: {
      models: { listForProvider: async () => ({ ok: true, models: ['catalog-model'] }) },
      settings: { setActiveProvider },
      config: { updateProvider },
    },
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

it.each([
  true,
  false,
])('saves an arbitrary model directly for a subscription row (active=%s)', async (isActive) => {
  const changed = vi.fn();
  await act(async () =>
    root.render(
      <RowModelSelector config={config} row={{ ...row, isActive }} onRowChanged={changed} />,
    ),
  );
  const input = container.querySelector('input');
  if (!input) throw new Error('Missing model input');
  input.value = '  account-only-model  ';
  await act(async () =>
    container
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  if (isActive) {
    expect(setActiveProvider).toHaveBeenCalledWith({
      provider: 'chatgpt-codex',
      modelPrimary: 'account-only-model',
    });
    expect(updateProvider).not.toHaveBeenCalled();
  } else {
    expect(updateProvider).toHaveBeenCalledWith({
      id: 'chatgpt-codex',
      defaultModel: 'account-only-model',
    });
    expect(setActiveProvider).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({ defaultModel: 'account-only-model' }),
    );
  }
});
