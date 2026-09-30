// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageGenerationSettingsView } from '../../../../preload/index';
import { ImageGenerationTab } from './ImageGenerationTab';

const translate = (key: string) => key;
vi.mock('@open-codesign/i18n', () => ({ useT: () => translate }));
const pushToast = vi.fn();
vi.mock('../../store', () => ({ useCodesignStore: () => pushToast }));

let container: HTMLDivElement;
let root: Root;
let settings: ImageGenerationSettingsView;
const get = vi.fn<() => Promise<ImageGenerationSettingsView>>();
const update =
  vi.fn<(patch: Partial<ImageGenerationSettingsView>) => Promise<ImageGenerationSettingsView>>();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  settings = {
    enabled: true,
    provider: 'openai',
    credentialMode: 'inherit',
    model: 'gpt-image-2',
    baseUrl: 'https://api.openai.com/v1',
    requestBase64: false,
    quality: 'high',
    size: '1536x1024',
    outputFormat: 'png',
    hasCustomKey: false,
    maskedKey: null,
    inheritedKeyAvailable: true,
  };
  get.mockImplementation(async () => settings);
  update.mockImplementation(async (patch) => {
    settings = { ...settings, ...patch };
    return settings;
  });
  Object.defineProperty(window, 'codesign', {
    configurable: true,
    value: { imageGeneration: { get, update } },
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

const mount = () => act(async () => root.render(<ImageGenerationTab />));
function saveButton(): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === 'common.save',
  );
  if (!button) throw new Error('Missing Save button');
  return button;
}
function checkbox(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="settings.imageGen.requestBase64"]',
  );
  if (!input) throw new Error('Missing base64 checkbox');
  return input;
}
async function edit(selector: string, value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`Missing input: ${selector}`);
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setValue) throw new Error('Missing native input setter');
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('image response preference UI', () => {
  it.each([
    'openai',
    'openrouter',
    'chatgpt-codex',
  ] as const)('shows the checkbox only for the OpenAI provider (%s)', async (provider) => {
    settings.provider = provider;
    await mount();
    expect(
      container.querySelector('input[aria-label="settings.imageGen.requestBase64"]') !== null,
    ).toBe(provider === 'openai');
    expect(saveButton().disabled).toBe(true);
  });

  it('enables Save for a changed checkbox and disables it after reverting the draft', async () => {
    await mount();
    expect(checkbox().checked).toBe(false);
    expect(saveButton().disabled).toBe(true);
    await act(async () => checkbox().click());
    expect(saveButton().disabled).toBe(false);
    await act(async () => checkbox().click());
    expect(saveButton().disabled).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });

  it.each([false, true])('saves only the changed base64 preference (%s)', async (initial) => {
    settings.requestBase64 = initial;
    await mount();
    await act(async () => checkbox().click());
    await act(async () => saveButton().click());
    expect(update).toHaveBeenCalledExactlyOnceWith({ requestBase64: !initial });
    expect(saveButton().disabled).toBe(true);
  });

  it('preserves an unsaved gateway URL while toggling the checkbox and saves both edits', async () => {
    await mount();
    await edit('input[type="url"]', 'https://relay.example/v1');
    await act(async () => checkbox().click());
    expect(container.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe(
      'https://relay.example/v1',
    );
    expect(update).not.toHaveBeenCalled();
    await act(async () => saveButton().click());
    expect(update).toHaveBeenCalledExactlyOnceWith({
      baseUrl: 'https://relay.example/v1',
      requestBase64: true,
    });
  });

  it('keeps the inherited endpoint when only the image model changes', async () => {
    await mount();
    await edit('input[type="text"]', 'custom-image');
    await act(async () => saveButton().click());
    expect(update).toHaveBeenCalledExactlyOnceWith({ model: 'custom-image' });
  });

  it('keeps the draft and surfaces a failed save instead of reporting success', async () => {
    update.mockRejectedValueOnce(new Error('Gateway settings unavailable'));
    await mount();
    await act(async () => checkbox().click());
    await act(async () => saveButton().click());
    expect(checkbox().checked).toBe(true);
    expect(saveButton().disabled).toBe(false);
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error', description: 'Gateway settings unavailable' }),
    );
    expect(pushToast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }));
  });
});
