import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCodexModelOptions } from './codex-models';
import { readCodexConfig } from './imports/codex-config';

vi.mock('./imports/codex-config', () => ({ readCodexConfig: vi.fn() }));
vi.mock('@mariozechner/pi-ai', () => ({
  getModels: (provider: string) => (provider === 'openai-codex' ? [{ id: 'catalog-model' }] : []),
}));

beforeEach(() => vi.mocked(readCodexConfig).mockReset());

describe('ChatGPT model suggestions', () => {
  it('prefills a realistic config that explicitly selects the built-in openai provider', async () => {
    const { parseCodexConfig } =
      await vi.importActual<typeof import('./imports/codex-config')>('./imports/codex-config');
    const imported = await parseCodexConfig(
      'model_provider = "openai"\nmodel = "local-codex-model"\n',
    );
    expect(imported.providers).toEqual([]);
    vi.mocked(readCodexConfig).mockResolvedValue(imported);
    expect((await getCodexModelOptions()).suggestedModel).toBe('local-codex-model');
  });
  it('keeps a local Codex model missing from the maintained pi catalog', async () => {
    vi.mocked(readCodexConfig).mockResolvedValue({
      providers: [],
      activeProvider: null,
      activeModel: 'future-account-model',
      envKeyMap: {},
      apiKeyMap: {},
      warnings: [],
    });
    expect(await getCodexModelOptions()).toEqual({
      suggestedModel: 'future-account-model',
      models: ['future-account-model', 'catalog-model'],
    });
  });

  it('does not invent a default when no local selection exists', async () => {
    vi.mocked(readCodexConfig).mockResolvedValue(null);
    expect(await getCodexModelOptions()).toEqual({
      suggestedModel: null,
      models: ['catalog-model'],
    });
  });

  it('does not reuse a custom API provider model as a ChatGPT default', async () => {
    vi.mocked(readCodexConfig).mockResolvedValue({
      providers: [],
      activeProvider: 'codex-custom',
      activeModel: 'custom-api-model',
      envKeyMap: {},
      apiKeyMap: {},
      warnings: [],
    });
    expect((await getCodexModelOptions()).suggestedModel).toBeNull();
  });

  it('does not assume a custom provider named openai is the built-in Codex provider', async () => {
    vi.mocked(readCodexConfig).mockResolvedValue({
      providers: [
        {
          id: 'codex-openai',
          name: 'Relay',
          builtin: false,
          wire: 'openai-responses',
          baseUrl: 'https://relay.example/v1',
          defaultModel: 'relay-only',
        },
      ],
      activeProvider: 'codex-openai',
      activeModel: 'relay-only',
      envKeyMap: {},
      apiKeyMap: {},
      warnings: [],
    });
    expect((await getCodexModelOptions()).suggestedModel).toBeNull();
  });
});
