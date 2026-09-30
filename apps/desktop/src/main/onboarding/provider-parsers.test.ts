import { CodesignError } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import { parseAddProviderPayload, parseUpdateProviderPayload } from './provider-parsers';

const addBase = {
  id: 'custom-glm',
  name: 'GLM',
  wire: 'openai-chat',
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: 'sk-test',
  defaultModel: 'glm-4.6',
  setAsActive: true,
} as const;

describe('parseAddProviderPayload discovery mode', () => {
  it('omits modelDiscoveryMode when the field is absent', () => {
    const parsed = parseAddProviderPayload(addBase);
    expect(parsed.modelDiscoveryMode).toBeUndefined();
  });

  it('accepts declared discovery modes', () => {
    expect(
      parseAddProviderPayload({ ...addBase, modelDiscoveryMode: 'infer-only' }).modelDiscoveryMode,
    ).toBe('infer-only');
    expect(
      parseAddProviderPayload({ ...addBase, modelDiscoveryMode: 'manual' }).modelDiscoveryMode,
    ).toBe('manual');
    expect(
      parseAddProviderPayload({ ...addBase, modelDiscoveryMode: 'static-hint' }).modelDiscoveryMode,
    ).toBe('static-hint');
    expect(
      parseAddProviderPayload({ ...addBase, modelDiscoveryMode: 'models' }).modelDiscoveryMode,
    ).toBe('models');
  });

  it('rejects unknown discovery modes', () => {
    expect(() => parseAddProviderPayload({ ...addBase, modelDiscoveryMode: 'catalog' })).toThrow(
      CodesignError,
    );
  });
});

describe('parseUpdateProviderPayload discovery mode', () => {
  it('accepts an optional modelDiscoveryMode on update', () => {
    expect(parseUpdateProviderPayload({ id: 'custom-glm', modelDiscoveryMode: 'manual' })).toEqual({
      id: 'custom-glm',
      modelDiscoveryMode: 'manual',
    });
  });

  it('rejects unknown discovery modes on update', () => {
    expect(() =>
      parseUpdateProviderPayload({ id: 'custom-glm', modelDiscoveryMode: 'guess' }),
    ).toThrow(/Unsupported modelDiscoveryMode/);
  });
});
