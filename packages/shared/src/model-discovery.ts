import type {
  ProviderCapabilities,
  ProviderEntry,
  ProviderModelDiscoveryMode,
  WireApi,
} from './config';
import { resolveProviderCapabilities } from './config';

export type ModelsListSource = 'remote' | 'static-hint' | 'local';

export type ListForProviderPlan =
  | {
      action: 'return';
      models: string[];
      discoveryMode: ProviderModelDiscoveryMode;
      source: Exclude<ModelsListSource, 'remote'>;
    }
  | {
      action: 'fetch-remote';
      discoveryMode: 'models';
      source: 'remote';
    };

export type ImportedProviderSource = 'claude-code' | 'gemini' | 'opencode' | 'codex';

export type SettingsModelPickerKind = 'select' | 'manual';

function pushUnique(models: string[], seen: Set<string>, value: string | undefined): void {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length === 0 || seen.has(trimmed)) return;
  seen.add(trimmed);
  models.push(trimmed);
}

export function usesRemoteModelsListing(mode: ProviderModelDiscoveryMode): boolean {
  return mode === 'models';
}

export function connectionTestProbesModelsEndpoint(mode: ProviderModelDiscoveryMode): boolean {
  return mode === 'models';
}

export function settingsModelPickerKind(mode: ProviderModelDiscoveryMode): SettingsModelPickerKind {
  return mode === 'manual' || mode === 'infer-only' ? 'manual' : 'select';
}

export function capabilitiesForDiscoveryMode(
  mode: ProviderModelDiscoveryMode,
  extra?: Partial<ProviderCapabilities>,
): ProviderCapabilities {
  return {
    supportsModelsEndpoint: mode === 'models',
    modelDiscoveryMode: mode,
    ...extra,
  };
}

export function mergeDiscoveryMode(
  existing: ProviderCapabilities | undefined,
  mode: ProviderModelDiscoveryMode,
): ProviderCapabilities {
  return {
    ...existing,
    modelDiscoveryMode: mode,
    supportsModelsEndpoint: mode === 'models',
  };
}

export function localModelsForDiscoveryMode(
  mode: ProviderModelDiscoveryMode,
  entry: { defaultModel: string; modelsHint?: string[] | undefined },
): string[] | null {
  if (usesRemoteModelsListing(mode)) return null;
  const models: string[] = [];
  const seen = new Set<string>();
  if (mode === 'static-hint') {
    for (const id of entry.modelsHint ?? []) pushUnique(models, seen, id);
    pushUnique(models, seen, entry.defaultModel);
    return models;
  }
  pushUnique(models, seen, entry.defaultModel);
  for (const id of entry.modelsHint ?? []) pushUnique(models, seen, id);
  return models;
}

export function resolveListForProviderPlan(
  providerId: string,
  entry: Pick<
    ProviderEntry,
    'wire' | 'defaultModel' | 'modelsHint' | 'requiresApiKey' | 'reasoningLevel' | 'capabilities'
  >,
): ListForProviderPlan {
  const mode = resolveProviderCapabilities(providerId, entry).modelDiscoveryMode;
  if (usesRemoteModelsListing(mode)) {
    return { action: 'fetch-remote', discoveryMode: 'models', source: 'remote' };
  }
  const models = localModelsForDiscoveryMode(mode, entry) ?? [];
  return {
    action: 'return',
    models,
    discoveryMode: mode,
    source: mode === 'static-hint' ? 'static-hint' : 'local',
  };
}

export function isDefaultAnthropicApiHost(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === 'api.anthropic.com';
  } catch {
    return false;
  }
}

export function discoveryModeForImport(
  source: ImportedProviderSource,
  entry: { baseUrl: string; wire?: WireApi },
): ProviderModelDiscoveryMode {
  if (source === 'codex') return 'infer-only';
  if (source === 'claude-code') {
    return isDefaultAnthropicApiHost(entry.baseUrl) ? 'models' : 'infer-only';
  }
  return 'models';
}

export function capabilitiesForImportedProvider(
  source: ImportedProviderSource,
  entry: { baseUrl: string; wire?: WireApi },
): ProviderCapabilities {
  return capabilitiesForDiscoveryMode(discoveryModeForImport(source, entry));
}

export function discoveryModeForCustomProvider(input: {
  discoveryKind: 'idle' | 'discovering' | 'found' | 'failed';
  manualModel: boolean;
}): ProviderModelDiscoveryMode {
  if (input.manualModel) return 'manual';
  if (input.discoveryKind === 'found') return 'models';
  if (input.discoveryKind === 'failed') return 'infer-only';
  return 'manual';
}

export function looksLikeModelsListingUrl(url: string | undefined): boolean {
  if (url === undefined || url.length === 0) return false;
  try {
    return /\/models\/?$/i.test(new URL(url).pathname);
  } catch {
    return /\/models\/?$/i.test(url);
  }
}
