// @vitest-environment happy-dom

import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodesignApi } from '../../../preload/index';
import { AddCustomProviderModal } from './AddCustomProviderModal';

const translate = (key: string) => key;
vi.mock('@open-codesign/i18n', () => ({ useT: () => translate }));

const testEndpoint = vi.fn<CodesignApi['config']['testEndpoint']>();
const updateProvider = vi.fn<CodesignApi['config']['updateProvider']>();
const onSave = vi.fn();
const editTarget: NonNullable<ComponentProps<typeof AddCustomProviderModal>['editTarget']> = {
  id: 'custom-gateway',
  name: 'Gateway',
  baseUrl: 'https://gateway.example/v1',
  wire: 'openai-chat',
  defaultModel: 'kept-model',
  builtin: false,
  lockEndpoint: false,
  requiresApiKey: false,
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  testEndpoint.mockReset();
  testEndpoint.mockResolvedValue({ ok: true, modelCount: 2, models: ['kept-model', 'other'] });
  updateProvider.mockReset();
  updateProvider.mockResolvedValue({
    hasKey: false,
    provider: editTarget.id,
    modelPrimary: editTarget.defaultModel,
    baseUrl: editTarget.baseUrl,
    designSystem: null,
  });
  onSave.mockReset();
  Object.defineProperty(window, 'codesign', {
    configurable: true,
    value: { config: { testEndpoint, updateProvider } },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Reflect.deleteProperty(window, 'codesign');
  vi.unstubAllGlobals();
});

async function clickButton(key: string) {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === key,
  );
  expect(button).toBeDefined();
  expect(button?.disabled).toBe(false);
  await act(async () => button?.click());
}

const render = (mode: NonNullable<typeof editTarget.modelDiscoveryMode>) =>
  act(async () =>
    root.render(
      <AddCustomProviderModal
        editTarget={{ ...editTarget, modelDiscoveryMode: mode }}
        onSave={onSave}
        onClose={() => undefined}
      />,
    ),
  );

describe('custom provider discovery mode edits', () => {
  it.each([
    'manual',
    'infer-only',
  ] as const)('persists models mode after rediscovering a %s provider and switching to the list', async (mode) => {
    await render(mode);
    await clickButton('settings.providers.custom.test');
    expect(testEndpoint).toHaveBeenCalledOnce();

    await clickButton('settings.providers.custom.switchToDropdown');
    expect(container.querySelector('select')?.value).toBe('kept-model');
    await clickButton('settings.providers.custom.saveEdit');

    expect(updateProvider).toHaveBeenCalledWith({
      id: editTarget.id,
      modelDiscoveryMode: 'models',
    });
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('persists a successful explicit rediscovery without changing the endpoint', async () => {
    await render('static-hint');
    await clickButton('settings.providers.custom.test');
    await clickButton('settings.providers.custom.saveEdit');

    expect(updateProvider).toHaveBeenCalledWith({
      id: editTarget.id,
      modelDiscoveryMode: 'models',
    });
  });

  it('keeps manual mode when a successful test is not followed by switching to the list', async () => {
    await render('manual');
    await clickButton('settings.providers.custom.test');
    await clickButton('settings.providers.custom.saveEdit');

    expect(updateProvider).toHaveBeenCalledWith({
      id: editTarget.id,
      modelDiscoveryMode: 'manual',
    });
  });

  it('keeps an untouched discovery mode when saving an existing provider', async () => {
    await render('infer-only');
    await clickButton('settings.providers.custom.saveEdit');

    expect(testEndpoint).not.toHaveBeenCalled();
    expect(updateProvider).toHaveBeenCalledWith({ id: editTarget.id });
  });
});
