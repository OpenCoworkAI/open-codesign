import { describe, expect, it } from 'vitest';
import {
  capabilitiesForDiscoveryMode,
  capabilitiesForImportedProvider,
  connectionTestProbesModelsEndpoint,
  discoveryModeForCustomProvider,
  discoveryModeForImport,
  localModelsForDiscoveryMode,
  looksLikeModelsListingUrl,
  mergeDiscoveryMode,
  resolveListForProviderPlan,
  settingsModelPickerKind,
  usesRemoteModelsListing,
} from './model-discovery';

describe('discovery mode helpers', () => {
  it('only models mode uses a remote listing endpoint', () => {
    expect(usesRemoteModelsListing('models')).toBe(true);
    expect(usesRemoteModelsListing('static-hint')).toBe(false);
    expect(usesRemoteModelsListing('manual')).toBe(false);
    expect(usesRemoteModelsListing('infer-only')).toBe(false);
    expect(connectionTestProbesModelsEndpoint('models')).toBe(true);
    expect(connectionTestProbesModelsEndpoint('infer-only')).toBe(false);
  });

  it('maps picker UX to select vs manual without forcing remote discover', () => {
    expect(settingsModelPickerKind('models')).toBe('select');
    expect(settingsModelPickerKind('static-hint')).toBe('select');
    expect(settingsModelPickerKind('manual')).toBe('manual');
    expect(settingsModelPickerKind('infer-only')).toBe('manual');
  });

  it('keeps supportsModelsEndpoint in lockstep with the declared mode', () => {
    expect(capabilitiesForDiscoveryMode('models').supportsModelsEndpoint).toBe(true);
    expect(capabilitiesForDiscoveryMode('infer-only').supportsModelsEndpoint).toBe(false);
    expect(capabilitiesForDiscoveryMode('manual').modelDiscoveryMode).toBe('manual');
    expect(mergeDiscoveryMode({ supportsReasoning: true }, 'infer-only')).toEqual({
      supportsReasoning: true,
      modelDiscoveryMode: 'infer-only',
      supportsModelsEndpoint: false,
    });
  });
});

describe('localModelsForDiscoveryMode', () => {
  it('returns null for remote listing so callers fetch /models', () => {
    expect(
      localModelsForDiscoveryMode('models', { defaultModel: 'gpt-4o', modelsHint: ['gpt-4.1'] }),
    ).toBeNull();
  });

  it('returns the static catalog plus defaultModel when missing from the hint', () => {
    expect(
      localModelsForDiscoveryMode('static-hint', {
        defaultModel: 'gpt-5.5',
        modelsHint: ['gpt-5.4', 'gpt-5.4-mini'],
      }),
    ).toEqual(['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.5']);
  });

  it('seeds infer-only and manual from defaultModel without a remote catalog', () => {
    expect(localModelsForDiscoveryMode('infer-only', { defaultModel: 'glm-4.6' })).toEqual([
      'glm-4.6',
    ]);
    expect(
      localModelsForDiscoveryMode('manual', {
        defaultModel: 'custom-model',
        modelsHint: ['custom-model', 'other'],
      }),
    ).toEqual(['custom-model', 'other']);
  });
});

describe('resolveListForProviderPlan', () => {
  it('fetches remotely when the provider declares models listing', () => {
    expect(
      resolveListForProviderPlan('openai', {
        wire: 'openai-chat',
        defaultModel: 'gpt-4o',
        capabilities: { modelDiscoveryMode: 'models' },
      }),
    ).toEqual({ action: 'fetch-remote', discoveryMode: 'models', source: 'remote' });
  });

  it('returns the static hint without hitting /models', () => {
    expect(
      resolveListForProviderPlan('chatgpt-codex', {
        wire: 'openai-codex-responses',
        defaultModel: 'gpt-5.5',
        modelsHint: ['gpt-5.5', 'gpt-5.4'],
        requiresApiKey: false,
      }),
    ).toEqual({
      action: 'return',
      models: ['gpt-5.5', 'gpt-5.4'],
      discoveryMode: 'static-hint',
      source: 'static-hint',
    });
  });

  it('returns the imported default for infer-only providers', () => {
    expect(
      resolveListForProviderPlan('codex-coproxy', {
        wire: 'openai-responses',
        defaultModel: 'gpt-5.5',
        capabilities: { modelDiscoveryMode: 'infer-only', supportsModelsEndpoint: false },
      }),
    ).toEqual({
      action: 'return',
      models: ['gpt-5.5'],
      discoveryMode: 'infer-only',
      source: 'local',
    });
  });

  it('returns the typed default for manual providers', () => {
    expect(
      resolveListForProviderPlan('custom-lite', {
        wire: 'openai-chat',
        defaultModel: 'gpt-4.1',
        capabilities: { modelDiscoveryMode: 'manual', supportsModelsEndpoint: false },
      }),
    ).toMatchObject({
      action: 'return',
      models: ['gpt-4.1'],
      discoveryMode: 'manual',
      source: 'local',
    });
  });
});

describe('import and custom defaults', () => {
  it('uses /models for official Claude Code Anthropic, infer-only for proxies', () => {
    expect(discoveryModeForImport('claude-code', { baseUrl: 'https://api.anthropic.com' })).toBe(
      'models',
    );
    expect(discoveryModeForImport('claude-code', { baseUrl: 'http://localhost:8082' })).toBe(
      'infer-only',
    );
    expect(
      capabilitiesForImportedProvider('claude-code', { baseUrl: 'https://gateway.example.com' })
        .supportsModelsEndpoint,
    ).toBe(false);
  });

  it('marks Gemini and OpenCode official maps as listing-capable', () => {
    expect(
      discoveryModeForImport('gemini', {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      }),
    ).toBe('models');
    expect(discoveryModeForImport('opencode', { baseUrl: 'https://api.openai.com/v1' })).toBe(
      'models',
    );
  });

  it('treats Codex imports as infer-only (one known default, no listing contract)', () => {
    expect(discoveryModeForImport('codex', { baseUrl: 'https://api.deepseek.com/v1' })).toBe(
      'infer-only',
    );
  });

  it('stamps custom-provider modes from discovery outcome', () => {
    expect(discoveryModeForCustomProvider({ discoveryKind: 'found', manualModel: false })).toBe(
      'models',
    );
    expect(discoveryModeForCustomProvider({ discoveryKind: 'found', manualModel: true })).toBe(
      'manual',
    );
    expect(discoveryModeForCustomProvider({ discoveryKind: 'failed', manualModel: false })).toBe(
      'infer-only',
    );
    expect(discoveryModeForCustomProvider({ discoveryKind: 'idle', manualModel: false })).toBe(
      'manual',
    );
  });
});

describe('looksLikeModelsListingUrl', () => {
  it('detects /models listing URLs used by connection diagnostics', () => {
    expect(looksLikeModelsListingUrl('https://api.openai.com/v1/models')).toBe(true);
    expect(looksLikeModelsListingUrl('https://api.anthropic.com/v1/models')).toBe(true);
    expect(looksLikeModelsListingUrl('https://api.openai.com/v1/chat/completions')).toBe(false);
    expect(looksLikeModelsListingUrl(undefined)).toBe(false);
  });
});
