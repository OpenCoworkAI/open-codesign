import { describe, expect, it } from 'vitest';
import { BUILTIN_PROVIDERS, parseConfigFlexible, toPersistedV3 } from './config';
import { currentModelChoices } from './model-choices';

it('refreshes ordinary hints without resetting saved MiniMax selections', () => {
  for (const model of ['MiniMax-M2.7', 'MiniMax-M3', 'my-custom-model']) {
    const provider = { ...BUILTIN_PROVIDERS.minimax, defaultModel: model, modelsHint: [model] };
    const config = parseConfigFlexible({
      version: 3,
      activeProvider: 'minimax',
      activeModel: model,
      providers: { minimax: provider },
      secrets: {},
    });
    expect(currentModelChoices(provider, provider.modelsHint)).toEqual([
      'MiniMax-M3.1-Flash',
      'MiniMax-M3',
    ]);
    expect(toPersistedV3(config).activeModel).toBe(model);
    expect(toPersistedV3(config).providers['minimax']).toEqual(provider);
  }
});

describe('gateway choices', () => {
  it('filters old text models from a live catalog and preserves other capabilities', () => {
    expect(
      currentModelChoices(BUILTIN_PROVIDERS.openrouter, [
        'other/model',
        'minimax/minimax-m2.7',
        'minimax/minimax-m3',
        'minimax/image-01',
        'minimax/minimax-m3.1-flash:free',
      ]),
    ).toEqual([
      'minimax/minimax-m3.1-flash:free',
      'minimax/minimax-m3',
      'other/model',
      'minimax/image-01',
    ]);
  });
  it('does not invent unavailable gateway routes or change custom catalogs', () => {
    expect(currentModelChoices(BUILTIN_PROVIDERS.openrouter, ['other/model'])).toEqual([
      'other/model',
    ]);
    const custom = { ...BUILTIN_PROVIDERS.minimax, builtin: false };
    expect(currentModelChoices(custom, ['MiniMax-M2.7', 'custom'])).toEqual([
      'MiniMax-M2.7',
      'custom',
    ]);
  });
});
