import { stringify } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { fixtureConfig, selectDebugConfig } from './model-config';

function source() {
  const fixture = fixtureConfig();
  return {
    version: 3,
    activeProvider: 'background-fixture',
    activeModel: 'fixture',
    providers: { ...fixture.providers },
    secrets: {
      'background-fixture': { ciphertext: 'plain:private-sentinel' },
      other: { ciphertext: 'plain:unrelated-secret' },
    },
    webSearch: { enabled: true },
    imageGeneration: { enabled: false },
  };
}
describe('explicit debug model configuration', () => {
  it('restricts a login snapshot to the official subscription endpoint', () => {
    const original = fixtureConfig().providers['background-fixture'];
    if (!original) throw new Error('Missing fixture');
    const config = {
      version: 3,
      activeProvider: 'chatgpt-codex',
      activeModel: 'test-model',
      providers: {
        'chatgpt-codex': {
          ...original,
          id: 'chatgpt-codex',
          wire: 'openai-codex-responses',
          baseUrl: 'https://chatgpt.com/backend-api',
        },
      },
    };
    expect(
      selectDebugConfig(stringify(config), { mode: 'live', codexAuth: 'explicit.json' }).secrets,
    ).toEqual({});
    config.providers['chatgpt-codex'].baseUrl = 'https://other.example/backend-api';
    expect(() =>
      selectDebugConfig(stringify(config), { mode: 'live', codexAuth: 'explicit.json' }),
    ).toThrow('BACKGROUND_MODEL_OAUTH_ENDPOINT_UNSUPPORTED');
  });
  it('selects one provider without copying unrelated secrets or optional capabilities', () => {
    const original = source();
    delete (original as { imageGeneration?: unknown }).imageGeneration;
    const before = structuredClone(original);
    const selected = selectDebugConfig(stringify(original), { mode: 'live' });
    expect(Object.keys(selected.secrets)).toEqual(['background-fixture']);
    expect(selected.secrets['background-fixture']?.mask).toBe('[REDACTED]');
    expect(selected.webSearch).toBeUndefined();
    expect(selected.imageGeneration).toBeUndefined();
    expect(selected.designSystem).toBeUndefined();
    expect(original).toEqual(before);
  });
  it('does not include parser values in configuration errors', () => {
    expect(() => selectDebugConfig('secret="private-sentinel', { mode: 'live' })).toThrow(
      'BACKGROUND_MODEL_CONFIG_INVALID',
    );
    try {
      selectDebugConfig('secret="private-sentinel', { mode: 'live' });
    } catch (error) {
      expect(String(error)).not.toContain('private-sentinel');
    }
  });
  it.each([
    'https://secret@example.com/v1',
    'https://example.com/v1?api_key=secret',
  ])('rejects credential-bearing endpoints %s', (baseUrl) => {
    const config = fixtureConfig();
    const entry = config.providers['background-fixture'];
    if (!entry) throw new Error('Missing fixture');
    entry.baseUrl = baseUrl;
    expect(() =>
      selectDebugConfig(
        stringify({
          version: 3,
          activeProvider: config.activeProvider,
          activeModel: config.activeModel,
          providers: config.providers,
        }),
        { mode: 'live' },
      ),
    ).toThrow('BACKGROUND_MODEL_ENDPOINT_UNSUPPORTED');
  });
  it('rejects OAuth rather than refreshing a personal token store', () => {
    const config = fixtureConfig();
    const entry = config.providers['background-fixture'];
    if (!entry) throw new Error('Missing fixture');
    entry.wire = 'openai-codex-responses';
    expect(() =>
      selectDebugConfig(
        stringify({
          version: 3,
          activeProvider: config.activeProvider,
          activeModel: config.activeModel,
          providers: config.providers,
        }),
        { mode: 'live' },
      ),
    ).toThrow('BACKGROUND_MODEL_OAUTH_UNSUPPORTED');
  });
});
