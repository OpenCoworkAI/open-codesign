// @vitest-environment happy-dom

import type { ProviderModelDiscoveryMode } from '@open-codesign/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodesignApi, ProviderRow } from '../../../../preload/index';
import { ProviderCard } from './primitives';

const actions = vi.hoisted(() => ({ pushToast: vi.fn(), reportableErrorToast: vi.fn() }));
const translate = (key: string, options?: Record<string, unknown>) =>
  key === 'diagnostics.attempted' ? `${key}: ${options?.['url']}` : key;
vi.mock('@open-codesign/i18n', () => ({
  useT: () => translate,
  getCurrentLocale: () => 'en',
}));
vi.mock('../../store', () => ({
  useCodesignStore: (selector: (state: typeof actions) => unknown) => selector(actions),
}));
vi.mock('../../lib/action-timeline', () => ({ recordAction: vi.fn() }));

const testProvider = vi.fn<CodesignApi['connection']['testProvider']>();
const row: ProviderRow = {
  provider: 'custom-gateway',
  maskedKey: '',
  baseUrl: 'https://relay.example.com',
  isActive: false,
  label: 'Gateway',
  name: 'Gateway',
  builtin: false,
  wire: 'openai-chat',
  defaultModel: 'kept-model',
  hasKey: false,
  modelDiscoveryMode: 'models',
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  testProvider.mockReset();
  testProvider.mockResolvedValue({
    ok: false,
    code: '404',
    message: 'HTTP 404',
    hint: 'Endpoint not found',
  });
  Object.defineProperty(window, 'codesign', {
    configurable: true,
    value: { connection: { testProvider } },
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

const render = (mode: ProviderModelDiscoveryMode = 'models') =>
  act(async () =>
    root.render(
      <ProviderCard
        row={{ ...row, modelDiscoveryMode: mode }}
        config={null}
        onDelete={() => undefined}
        onActivate={() => undefined}
        onEdit={() => undefined}
        onRowChanged={() => undefined}
      />,
    ),
  );

async function testConnection() {
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="settings.providers.moreActions"]')
      ?.click(),
  );
  const button = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent === 'settings.providers.testConnection',
  );
  expect(button).toBeDefined();
  await act(async () => button?.click());
  expect(testProvider).toHaveBeenCalledWith(row.provider);
}

describe('ProviderCard connection diagnostics', () => {
  it('shows the actual inference URL instead of guessing a models URL', async () => {
    const attemptedUrl = 'https://relay.example.com/v1/chat/completions';
    testProvider.mockResolvedValue({
      ok: false,
      code: '401',
      message: 'HTTP 403',
      hint: 'Access denied',
      attemptedUrl,
    });
    await render();
    await testConnection();

    const panel = container.querySelector('[role="alert"]');
    expect(panel?.textContent).toContain(attemptedUrl);
    expect(panel?.textContent).not.toContain('https://relay.example.com/v1/models');
  });

  it.each([
    'infer-only',
    'manual',
  ] as const)('keeps a %s inference 404 as an endpoint failure without an add-v1 fix', async (mode) => {
    const attemptedUrl = 'https://relay.example.com/v1/chat/completions';
    testProvider.mockResolvedValue({
      ok: false,
      code: '404',
      message: 'HTTP 404',
      hint: 'Endpoint not found',
      attemptedUrl,
    });
    await render(mode);
    await testConnection();

    const panel = container.querySelector('[role="alert"]');
    expect(panel?.textContent).toContain(attemptedUrl);
    expect(panel?.textContent).toContain('diagnostics.cause.endpointNotFound');
    expect(panel?.textContent).not.toContain('diagnostics.cause.modelsListingNotApplicable');
    expect(panel?.textContent).not.toContain('diagnostics.cause.missingV1');
    expect(panel?.textContent).not.toContain('diagnostics.fix.addV1');
  });

  it('falls back to the models URL when an older listing failure omits attemptedUrl', async () => {
    await render();
    await testConnection();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'https://relay.example.com/v1/models',
    );
  });
});
