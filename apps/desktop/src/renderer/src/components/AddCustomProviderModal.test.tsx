import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AddCustomProviderModal, buildEndpointDiscoveryPayload } from './AddCustomProviderModal';

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
  });

  it('builds endpoint discovery payloads from the latest private-network opt-in value', () => {
    expect(buildEndpointDiscoveryPayload('openai-chat', ' http://127.0.0.1:8317 ', true)).toEqual({
      wire: 'openai-chat',
      baseUrl: 'http://127.0.0.1:8317',
      apiKey: '',
      allowPrivateNetwork: true,
    });
  });

  it('includes a typed proxy key in the discovery payload', () => {
    expect(
      buildEndpointDiscoveryPayload(
        'openai-chat',
        'http://localhost:4000/v1',
        true,
        false,
        ' sk-litellm-master ',
      ),
    ).toEqual({
      wire: 'openai-chat',
      baseUrl: 'http://localhost:4000/v1',
      apiKey: 'sk-litellm-master',
      allowPrivateNetwork: true,
    });
  });

  it('shows LiteLLM-specific keyless and proxy-key help when opened from the preset', () => {
    const html = renderToStaticMarkup(
      <AddCustomProviderModal
        onSave={() => undefined}
        onClose={() => undefined}
        initialValues={{
          name: 'LiteLLM Gateway',
          baseUrl: 'http://localhost:4000/v1',
          wire: 'openai-chat',
          helpPreset: 'litellm',
          supportsKeyless: true,
          allowPrivateNetwork: true,
        }}
      />,
    );

    expect(html).toContain('settings.providers.litellmGateway.helpTitle');
    expect(html).toContain('settings.providers.litellmGateway.helpBody');
    expect(html).toContain('settings.providers.litellmGateway.apiKeyOptional');
    expect(html).toContain('settings.providers.litellmGateway.apiKeyPlaceholder');
  });

  it('does not show LiteLLM help on a generic custom provider form', () => {
    const html = renderToStaticMarkup(
      <AddCustomProviderModal onSave={() => undefined} onClose={() => undefined} />,
    );
    expect(html).not.toContain('settings.providers.litellmGateway.helpTitle');
  });
});
