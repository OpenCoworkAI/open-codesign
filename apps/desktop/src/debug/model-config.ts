import {
  type Config,
  hydrateConfig,
  parseConfigFlexible,
  resolveProviderCapabilities,
} from '@open-codesign/shared';
import { parse } from 'smol-toml';
import type { DebugModelOptions } from './contract';

export function selectDebugConfig(raw: string, options: DebugModelOptions): Config {
  let source: Config;
  try {
    source = parseConfigFlexible(parse(raw));
  } catch {
    throw new Error('BACKGROUND_MODEL_CONFIG_INVALID: expected a valid config.toml');
  }
  const provider = options.provider ?? source.activeProvider;
  const entry = source.providers[provider];
  const model = options.model ?? (options.provider ? entry?.defaultModel : source.activeModel);
  if (!entry || !model) throw new Error('BACKGROUND_MODEL_SELECTION_MISSING');
  const codex = entry.wire === 'openai-codex-responses' || provider === 'chatgpt-codex';
  if (codex && !options.codexAuth)
    throw new Error(
      'BACKGROUND_MODEL_OAUTH_UNSUPPORTED: an explicit current login snapshot is required',
    );
  if (
    options.codexAuth &&
    (provider !== 'chatgpt-codex' ||
      entry.wire !== 'openai-codex-responses' ||
      entry.baseUrl.replace(/\/$/, '') !== 'https://chatgpt.com/backend-api' ||
      Object.keys(entry.httpHeaders ?? {}).length)
  )
    throw new Error('BACKGROUND_MODEL_OAUTH_ENDPOINT_UNSUPPORTED');
  const url = new URL(entry.baseUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['http:', 'https:'].includes(url.protocol)
  )
    throw new Error('BACKGROUND_MODEL_ENDPOINT_UNSUPPORTED: credential-free HTTP(S) URL required');
  if (entry.tlsRejectUnauthorized === false || Object.keys(entry.queryParams ?? {}).length)
    throw new Error(
      'BACKGROUND_MODEL_ENDPOINT_UNSUPPORTED: TLS bypass and query parameters are unsupported',
    );
  if (
    !codex &&
    !source.secrets[provider] &&
    !resolveProviderCapabilities(provider, entry).supportsKeyless
  )
    throw new Error('BACKGROUND_MODEL_CREDENTIAL_MISSING');
  return hydrateConfig({
    version: 3,
    activeProvider: provider,
    activeModel: model,
    providers: {
      [provider]: {
        ...entry,
        name: 'Background test model',
        defaultModel: model,
        modelsHint: [model],
      },
    },
    secrets:
      !codex && source.secrets[provider]
        ? { [provider]: { ...source.secrets[provider], mask: '[REDACTED]' } }
        : {},
  });
}

export function fixtureConfig(): Config {
  return hydrateConfig({
    version: 3,
    activeProvider: 'background-fixture',
    activeModel: 'fixture',
    providers: {
      'background-fixture': {
        id: 'background-fixture',
        name: 'Controlled model',
        builtin: false,
        wire: 'openai-chat',
        baseUrl: 'http://127.0.0.1:1/v1',
        defaultModel: 'fixture',
        modelsHint: ['fixture'],
        requiresApiKey: false,
      },
    },
    secrets: {},
  });
}
