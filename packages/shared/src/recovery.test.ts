import { describe, expect, it } from 'vitest';
import { readProviderFailureContext } from './recovery';

describe('durable provider recovery context', () => {
  it('copies only known categories and HTTP status, excluding arbitrary upstream data', () => {
    const source = {
      recoveryCategory: 'billing',
      status: 429,
      apiKey: 'synthetic-secret',
      headers: { authorization: 'synthetic-secret' },
      baseUrl: 'https://example.test/?token=synthetic-secret',
      message: 'private prompt',
    };
    const result = readProviderFailureContext(source);
    expect(result).toEqual({ recoveryCategory: 'billing', status: 429 });
    source.recoveryCategory = 'region_restricted';
    expect(result?.recoveryCategory).toBe('billing');
  });
  it.each([
    null,
    [],
    'billing',
    { recoveryCategory: 'made_up' },
  ])('rejects invalid metadata %s', (value) => {
    expect(readProviderFailureContext(value)).toBeUndefined();
  });
  it.each([NaN, Infinity, 99, 600, 429.5, '429'])('omits an invalid HTTP status %s', (status) => {
    expect(readProviderFailureContext({ recoveryCategory: 'billing', status })).toEqual({
      recoveryCategory: 'billing',
    });
  });
});
