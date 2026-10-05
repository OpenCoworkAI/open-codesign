import { describe, expect, it } from 'vitest';
import { modelsListingAttemptUrl } from './primitives';

describe('modelsListingAttemptUrl', () => {
  it('points connection diagnostics at GET /models only when the provider lists models', () => {
    expect(
      modelsListingAttemptUrl({
        baseUrl: 'https://api.openai.com/v1',
        wire: 'openai-chat',
        modelDiscoveryMode: 'models',
      }),
    ).toBe('https://api.openai.com/v1/models');
    expect(
      modelsListingAttemptUrl({
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        wire: 'openai-chat',
        modelDiscoveryMode: 'infer-only',
      }),
    ).toBeUndefined();
    expect(
      modelsListingAttemptUrl({
        baseUrl: null,
        wire: 'openai-chat',
        modelDiscoveryMode: 'models',
      }),
    ).toBeUndefined();
  });
});
