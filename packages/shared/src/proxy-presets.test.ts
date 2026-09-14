import { describe, expect, it } from 'vitest';
import {
  LITELLM_DEFAULT_BASE_URL,
  LITELLM_DEFAULT_WIRE,
  LITELLM_GATEWAY_PRESET,
  looksLikeLiteLLMGateway,
  PROXY_PRESET_SCHEMA_VERSION,
  PROXY_PRESETS,
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
    expect(ids).toContain('cli-proxy-api');
    expect(ids).toContain('litellm');
    expect(ids).toContain('custom');
  });

  it('DuckCoding preset has /v1 in baseUrl', () => {
    const duck = PROXY_PRESETS.find((p) => p.id === 'duckcoding');
    expect(duck).toBeDefined();
    expect(duck?.baseUrl).toContain('/v1');
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

describe('LITELLM_GATEWAY_PRESET', () => {
  it('registers OpenAI-compatible defaults without bundling LiteLLM', () => {
    expect(LITELLM_GATEWAY_PRESET.id).toBe('litellm');
    expect(LITELLM_GATEWAY_PRESET.label).toBe('LiteLLM Gateway');
    expect(LITELLM_GATEWAY_PRESET.wire).toBe(LITELLM_DEFAULT_WIRE);
    expect(LITELLM_GATEWAY_PRESET.wire).toBe('openai-chat');
    expect(LITELLM_GATEWAY_PRESET.baseUrl).toBe(LITELLM_DEFAULT_BASE_URL);
    expect(LITELLM_GATEWAY_PRESET.baseUrl).toBe('http://localhost:4000/v1');
    expect(LITELLM_GATEWAY_PRESET.supportsKeyless).toBe(true);
    expect(LITELLM_GATEWAY_PRESET.supportsModelsEndpoint).toBe(true);
    expect(LITELLM_GATEWAY_PRESET.modelDiscoveryMode).toBe('models');
    expect(LITELLM_GATEWAY_PRESET.notes.toLowerCase()).toContain('not bundled');
  });

  it('keeps PROXY_PRESETS in sync with the first-class LiteLLM entry', () => {
    const listed = PROXY_PRESETS.find((p) => p.id === 'litellm');
    expect(listed?.label).toBe(LITELLM_GATEWAY_PRESET.label);
    expect(listed?.baseUrl).toBe(LITELLM_GATEWAY_PRESET.baseUrl);
    expect(listed?.provider).toBe('openai');
  });
});

describe('looksLikeLiteLLMGateway', () => {
  it('matches preset ids, custom ids, and the default listen address', () => {
    expect(looksLikeLiteLLMGateway('litellm', '')).toBe(true);
    expect(looksLikeLiteLLMGateway('custom-litellm-gateway-ab12')).toBe(true);
    expect(looksLikeLiteLLMGateway('openai', LITELLM_DEFAULT_BASE_URL)).toBe(true);
    expect(looksLikeLiteLLMGateway('openai', 'http://127.0.0.1:4000/v1')).toBe(true);
    expect(looksLikeLiteLLMGateway('openai', 'https://litellm.internal.example/v1')).toBe(true);
  });

  it('does not match unrelated providers or ports', () => {
    expect(looksLikeLiteLLMGateway('openai', 'https://api.openai.com/v1')).toBe(false);
    expect(looksLikeLiteLLMGateway('cli-proxy-api', 'http://127.0.0.1:8317')).toBe(false);
    expect(looksLikeLiteLLMGateway('ollama', 'http://localhost:11434/v1')).toBe(false);
    expect(looksLikeLiteLLMGateway('custom-relay', 'http://localhost:8080/v1')).toBe(false);
  });
});
