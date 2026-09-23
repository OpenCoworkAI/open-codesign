import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  AddCustomProviderModal,
  buildEndpointDiscoveryPayload,
  buildProviderAuthPayload,
  buildProviderAuthUpdate,
} from './AddCustomProviderModal';

vi.mock('@open-codesign/i18n', () => ({
  useT: () => (key: string) => key,
}));

describe('AddCustomProviderModal', () => {
  it('shows the compatibility warning for editable custom endpoints', () => {
    const html = renderToStaticMarkup(
      <AddCustomProviderModal onSave={() => undefined} onClose={() => undefined} />,
    );

    expect(html).toContain('settings.providers.custom.compatibilityHintTitle');
    expect(html).toContain('settings.providers.custom.compatibilityHintBody');
    expect(html).toContain('settings.providers.custom.allowPrivateNetwork');
    expect(html).toContain('settings.providers.custom.keylessLabel');
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
  });

  it('hides the compatibility warning when editing a locked builtin endpoint', () => {
    const html = renderToStaticMarkup(
      <AddCustomProviderModal
        onSave={() => undefined}
        onClose={() => undefined}
        editTarget={{
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com',
          wire: 'anthropic',
          defaultModel: 'claude-sonnet-4-5',
          builtin: true,
          lockEndpoint: true,
        }}
      />,
    );

    expect(html).not.toContain('settings.providers.custom.compatibilityHintTitle');
    expect(html).not.toContain('settings.providers.custom.compatibilityHintBody');
    expect(html).not.toContain('settings.providers.custom.keylessLabel');
  });

  it('builds endpoint discovery payloads from the latest private-network opt-in value', () => {
    expect(
      buildEndpointDiscoveryPayload('openai-chat', ' http://127.0.0.1:8317 ', true, false, false),
    ).toEqual({
      wire: 'openai-chat',
      baseUrl: 'http://127.0.0.1:8317',
      apiKey: '',
      requiresApiKey: false,
      allowPrivateNetwork: true,
    });
  });

  it('does not automatically discover endpoints without an explicit keyless opt-in', () => {
    expect(
      buildEndpointDiscoveryPayload('openai-chat', 'https://provider.example/v1', false),
    ).toBeNull();
    expect(
      buildEndpointDiscoveryPayload(
        'openai-responses',
        'http://127.0.0.1:18537/v1',
        true,
        false,
        true,
      ),
    ).toBeNull();
  });

  it('restores the keyless edit state and disables the API key input', () => {
    const html = renderToStaticMarkup(
      <AddCustomProviderModal
        onSave={() => undefined}
        onClose={() => undefined}
        editTarget={{
          id: 'custom-coproxy',
          name: 'CoProxy',
          baseUrl: 'http://127.0.0.1:18537/v1',
          wire: 'openai-responses',
          defaultModel: 'gpt-6-astra',
          builtin: false,
          lockEndpoint: false,
          requiresApiKey: false,
        }}
      />,
    );
    expect(html).toMatch(/type="checkbox"[^>]*checked/);
    expect(html).toMatch(/type="password"[^>]*disabled/);
  });

  it('uses the selected authentication mode for create and explicit test payloads', () => {
    expect(buildProviderAuthPayload(false, 'sk-stale')).toEqual({
      requiresApiKey: false,
      apiKey: '',
    });
    expect(buildProviderAuthPayload(true, ' sk-entered ')).toEqual({
      requiresApiKey: true,
      apiKey: 'sk-entered',
    });
    expect(buildProviderAuthPayload(true, '')).toEqual({ requiresApiKey: true, apiKey: '' });
  });

  it('only clears a stored key when explicitly switching a custom provider to keyless', () => {
    expect(buildProviderAuthUpdate(false, 'sk-stale', { builtin: false })).toEqual({
      requiresApiKey: false,
      apiKey: '',
    });
    expect(buildProviderAuthUpdate(false, '', { builtin: false, requiresApiKey: false })).toEqual(
      {},
    );
    expect(buildProviderAuthUpdate(true, '', { builtin: false })).toEqual({});
    expect(buildProviderAuthUpdate(false, '', { builtin: true })).toEqual({});
  });

  it('switches back to keyed mode and rotates only a supplied key', () => {
    expect(
      buildProviderAuthUpdate(true, ' sk-new ', { builtin: false, requiresApiKey: false }),
    ).toEqual({
      requiresApiKey: true,
      apiKey: 'sk-new',
    });
    expect(buildProviderAuthUpdate(true, '', { builtin: false, requiresApiKey: false })).toEqual({
      requiresApiKey: true,
    });
  });
});
