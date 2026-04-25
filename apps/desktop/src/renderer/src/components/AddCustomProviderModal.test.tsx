import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AddCustomProviderModal } from './AddCustomProviderModal';

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
});
