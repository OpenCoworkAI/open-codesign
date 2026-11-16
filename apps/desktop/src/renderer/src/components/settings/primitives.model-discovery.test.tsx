// @vitest-environment happy-dom

import type { OnboardingState } from '@open-codesign/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodesignApi, ProviderRow } from '../../../../preload/index';
import { RowModelSelector } from './primitives';

const actions = vi.hoisted(() => ({
  completeOnboarding: vi.fn(),
  reportableErrorToast: vi.fn(),
}));
const translate = (key: string) => key;
vi.mock('@open-codesign/i18n', () => ({ useT: () => translate }));
vi.mock('../../store', () => ({
  useCodesignStore: (selector: (state: typeof actions) => unknown) => selector(actions),
}));

const listForProvider = vi.fn<CodesignApi['models']['listForProvider']>();
const config: OnboardingState = {
  hasKey: true,
  provider: 'custom-gateway',
  modelPrimary: 'kept-model',
  baseUrl: 'https://gateway.example/v1',
  designSystem: null,
};
const row: ProviderRow = {
  provider: 'custom-gateway',
  maskedKey: '***',
  baseUrl: config.baseUrl,
  isActive: true,
  label: 'Gateway',
  name: 'Gateway',
  builtin: false,
  wire: 'openai-chat',
  defaultModel: 'kept-model',
  hasKey: true,
  modelDiscoveryMode: 'models',
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  listForProvider.mockReset();
  listForProvider.mockResolvedValue({ ok: true, models: ['kept-model'] });
  Object.defineProperty(window, 'codesign', {
    configurable: true,
    value: { models: { listForProvider } },
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

const render = (current = row) =>
  act(async () =>
    root.render(<RowModelSelector config={config} row={current} onRowChanged={() => {}} />),
  );
const manualInput = () => container.querySelector<HTMLInputElement>('input[type="text"]');

describe('provider model discovery lifecycle', () => {
  it('uses manual model entry without requesting a remote list', async () => {
    await render({ ...row, modelDiscoveryMode: 'manual' });
    expect(listForProvider).not.toHaveBeenCalled();
    expect(manualInput()?.value).toBe('kept-model');
    expect(container.querySelector('.animate-spin')).toBeNull();
  });

  it('clears loading and reports a rejected listing request while preserving manual entry', async () => {
    listForProvider.mockRejectedValue(new Error('listing connection lost'));
    await render();
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(manualInput()?.value).toBe('kept-model');
    expect(actions.reportableErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'PROVIDER_MODELS_DISCOVERY_FAILED',
        description: 'listing connection lost',
        context: { provider: row.provider },
      }),
    );
  });

  it('retains the server hint alongside a reported failure and editable model ID', async () => {
    listForProvider.mockResolvedValue({
      ok: false,
      code: 'HTTP',
      message: 'listing denied',
      hint: 'Check the gateway key',
      hintKey: 'gateway.listingHint',
    });
    await render();
    expect(container.textContent).toContain('gateway.listingHint');
    expect(manualInput()?.value).toBe('kept-model');
    expect(actions.reportableErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'gateway.listingHint' }),
    );
  });

  it('ignores an obsolete response after switching from remote listing to manual entry', async () => {
    let finish:
      | ((value: Awaited<ReturnType<CodesignApi['models']['listForProvider']>>) => void)
      | undefined;
    listForProvider.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await render();
    expect(container.querySelector('.animate-spin')).not.toBeNull();
    await render({ ...row, modelDiscoveryMode: 'manual' });
    await act(async () => {
      finish?.({ ok: false, code: 'HTTP', message: 'stale', hint: 'stale', hintKey: 'stale.hint' });
    });
    expect(manualInput()?.value).toBe('kept-model');
    expect(container.textContent).not.toContain('stale.hint');
    expect(actions.reportableErrorToast).not.toHaveBeenCalled();
  });

  it('falls back to manual entry when the host listing API is unavailable', async () => {
    Object.defineProperty(window, 'codesign', { configurable: true, value: { models: {} } });
    await render();
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(manualInput()?.value).toBe('kept-model');
  });
});
