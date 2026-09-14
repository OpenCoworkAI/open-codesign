import { z } from 'zod';

export const PROXY_PRESET_SCHEMA_VERSION = 1 as const;

/** Default LiteLLM proxy listen address. LiteLLM is not bundled — users point
 *  this preset at an already-running gateway. */
export const LITELLM_DEFAULT_BASE_URL = 'http://localhost:4000/v1';
export const LITELLM_DEFAULT_WIRE = 'openai-chat' as const;

/**
 * First-class LiteLLM Gateway preset. Used by Settings → Add provider and
 * diagnostics. Does not ship or spawn LiteLLM; it only pre-fills an
 * OpenAI-compatible custom provider that can run with a proxy key or keyless
 * (IP-allowlist / `disable_auth`) deployments.
 */
export const LITELLM_GATEWAY_PRESET = {
  id: 'litellm',
  label: 'LiteLLM Gateway',
  provider: 'openai',
  wire: LITELLM_DEFAULT_WIRE,
  baseUrl: LITELLM_DEFAULT_BASE_URL,
  notes:
    'Externally hosted LiteLLM gateway (OpenAI-compatible). Supports a proxy key or keyless IP-allowlist. LiteLLM is not bundled.',
  supportsKeyless: true,
  supportsModelsEndpoint: true,
  modelDiscoveryMode: 'models' as const,
  allowPrivateNetworkByDefault: true,
} as const;

export const PROXY_PRESETS = [
  {
    id: 'official-openai',
    label: 'OpenAI Official',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    notes: '',
  },
  {
    id: 'official-anthropic',
    label: 'Anthropic Official',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    notes: '',
  },
  {
    id: 'official-google',
    label: 'Google AI Studio',
    provider: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    notes: 'OpenAI-compatible endpoint',
  },
  {
    id: 'duckcoding',
    label: 'DuckCoding',
    provider: 'openai',
    baseUrl: 'https://api.duckcoding.ai/v1',
    notes: 'OpenAI compatible relay',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    provider: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    notes: 'Multi-model relay',
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    provider: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    notes: 'CN-friendly relay',
  },
  {
    id: 'one-api',
    label: 'one-api (self-hosted)',
    provider: 'openai',
    baseUrl: 'http://localhost:3000/v1',
    notes: 'Edit URL to your deployment',
  },
  {
    id: 'cli-proxy-api',
    label: 'CLIProxyAPI',
    provider: 'anthropic',
    baseUrl: 'http://127.0.0.1:8317',
    notes: '',
  },
  {
    id: 'litellm',
    label: LITELLM_GATEWAY_PRESET.label,
    provider: LITELLM_GATEWAY_PRESET.provider,
    baseUrl: LITELLM_GATEWAY_PRESET.baseUrl,
    notes: LITELLM_GATEWAY_PRESET.notes,
  },
  {
    id: 'custom',
    label: 'Custom...',
    provider: 'openai',
    baseUrl: '',
    notes: 'Enter your own base URL',
  },
] as const;

export type ProxyPresetId = (typeof PROXY_PRESETS)[number]['id'];

const presetIds = PROXY_PRESETS.map((p) => p.id) as [ProxyPresetId, ...ProxyPresetId[]];
export const ProxyPresetIdSchema = z.enum(presetIds);

export const ProxyPreset = z.object({
  id: ProxyPresetIdSchema,
  label: z.string(),
  provider: z.string(),
  baseUrl: z.string(),
  notes: z.string(),
});
export type ProxyPreset = z.infer<typeof ProxyPreset>;

export function getPresetById(id: ProxyPresetId): (typeof PROXY_PRESETS)[number] | undefined {
  return PROXY_PRESETS.find((p) => p.id === id);
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * True when a stored provider or connection-test context is a LiteLLM gateway.
 * Matches the first-class preset id, custom ids/names that contain "litellm",
 * and the default localhost:4000 listen address.
 */
export function looksLikeLiteLLMGateway(provider: string, baseUrl?: string): boolean {
  if (provider.toLowerCase().includes('litellm')) return true;
  if (!baseUrl) return false;
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    if (host.includes('litellm')) return true;
    const port = url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port;
    return LOOPBACK_HOSTS.has(host) && port === '4000';
  } catch {
    return /\blitellm\b/i.test(baseUrl);
  }
}
