import { initI18n } from '@open-codesign/i18n';
import { beforeAll, describe, expect, it } from 'vitest';
import { STAGES } from './LoadingState';

beforeAll(async () => {
  await initI18n('en');
});

describe('LoadingState stage list', () => {
  it('includes all named stages in order', () => {
    expect(STAGES).toEqual(['sending', 'thinking', 'streaming', 'parsing', 'rendering', 'done']);
  });

  it('has a label for each stage in en locale', async () => {
    const { i18n } = await import('@open-codesign/i18n');
    for (const stage of STAGES) {
      const key = `loading.stage.${stage}`;
      const value = i18n.t(key) as string;
      // The i18n package renders missing keys as ⟦key⟧ in dev; a real translation must not match that
      expect(value).not.toMatch(/^\u27E6.*\u27E7$/);
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
