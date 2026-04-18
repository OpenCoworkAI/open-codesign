import { describe, expect, it } from 'vitest';
import {
  PROXY_PRESETS,
  PROXY_PRESET_SCHEMA_VERSION,
  ProxyPreset,
  ProxyPresetIdSchema,
} from './proxy-presets';

describe('PROXY_PRESETS', () => {
  it('has the correct schema version constant', () => {
    expect(PROXY_PRESET_SCHEMA_VERSION).toBe(1);
  });

  it('all preset ids are valid ProxyPresetIdSchema values', () => {
    for (const preset of PROXY_PRESETS) {
      expect(() => ProxyPresetIdSchema.parse(preset.id)).not.toThrow();
    }
  });

  it('every preset has all required fields', () => {
    for (const preset of PROXY_PRESETS) {
      const result = ProxyPreset.safeParse(preset);
      expect(
        result.success,
        `preset "${preset.id}" failed schema: ${JSON.stringify((result as { error?: unknown }).error)}`,
      ).toBe(true);
    }
  });

  it('contains the expected relay ids', () => {
    const ids = PROXY_PRESETS.map((p) => p.id);
    expect(ids).toContain('official-openai');
    expect(ids).toContain('official-anthropic');
    expect(ids).toContain('duckcoding');
    expect(ids).toContain('openrouter');
    expect(ids).toContain('siliconflow');
    expect(ids).toContain('one-api');
    expect(ids).toContain('custom');
  });

  it('DuckCoding preset has /v1 in baseUrl', () => {
    const duck = PROXY_PRESETS.find((p) => p.id === 'duckcoding');
    expect(duck).toBeDefined();
    expect(duck!.baseUrl).toContain('/v1');
  });

  it('official-openai uses the correct baseUrl', () => {
    const preset = PROXY_PRESETS.find((p) => p.id === 'official-openai');
    expect(preset?.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('custom preset has empty baseUrl', () => {
    const custom = PROXY_PRESETS.find((p) => p.id === 'custom');
    expect(custom?.baseUrl).toBe('');
  });
});
