import {
  CodesignError,
  ERROR_CODES,
  type SupportedOnboardingProvider,
  isSupportedOnboardingProvider,
} from '@open-codesign/shared';

export type ValidateResult =
  | { ok: true; modelCount: number }
  | { ok: false; code: '401' | '402' | '429' | 'network'; message: string };

interface ProviderEndpoint {
  url: string;
  headers: (apiKey: string) => Record<string, string>;
}

/**
 * Normalize a user-supplied baseUrl so that appending /v1/models never
 * produces a double /v1/ segment.
 *
 * - openai / openrouter: strip trailing /v1 — we append /v1/models below
 * - anthropic: strip trailing /v1 — we append /v1/models below
 */
function normalizeValidateBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
}

function endpoint(provider: SupportedOnboardingProvider, baseUrl?: string): ProviderEndpoint {
  switch (provider) {
    case 'anthropic': {
      const root = baseUrl ? normalizeValidateBaseUrl(baseUrl) : 'https://api.anthropic.com';
      return {
        url: `${root}/v1/models`,
        headers: (apiKey) => ({
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        }),
      };
    }
    case 'openai': {
      const root = baseUrl ? normalizeValidateBaseUrl(baseUrl) : 'https://api.openai.com';
      return {
        url: `${root}/v1/models`,
        headers: (apiKey) => ({ authorization: `Bearer ${apiKey}` }),
      };
    }
    case 'openrouter': {
      const root = baseUrl ? normalizeValidateBaseUrl(baseUrl) : 'https://openrouter.ai/api';
      return {
        url: `${root}/v1/models`,
        headers: (apiKey) => ({ authorization: `Bearer ${apiKey}` }),
      };
    }
  }
}

function statusToCode(status: number): '401' | '402' | '429' | null {
  if (status === 401 || status === 403) return '401';
  if (status === 402) return '402';
  if (status === 429) return '429';
  return null;
}

function statusMessage(provider: SupportedOnboardingProvider, status: number): string {
  if (status === 401 || status === 403) {
    return `Invalid ${provider} API key (HTTP ${status}). Double-check the key, then try again.`;
  }
  if (status === 402) {
    return `${provider} reports the account has no credit (HTTP 402). Add billing or pick another provider.`;
  }
  if (status === 429) {
    return `${provider} rate-limited the validation request (HTTP 429). Wait a moment and retry.`;
  }
  return `${provider} returned HTTP ${status}.`;
}

export async function pingProvider(
  provider: string,
  apiKey: string,
  baseUrl?: string,
): Promise<ValidateResult> {
  if (!isSupportedOnboardingProvider(provider)) {
    throw new CodesignError(
      `Provider "${provider}" is not supported in v0.1. Supported: anthropic, openai, openrouter.`,
      ERROR_CODES.PROVIDER_NOT_SUPPORTED,
    );
  }
  if (!apiKey || apiKey.trim().length === 0) {
    throw new CodesignError('API key is empty', ERROR_CODES.PROVIDER_AUTH_MISSING);
  }

  const ep = endpoint(provider, baseUrl);
  let res: Response;
  try {
    res = await fetch(ep.url, { method: 'GET', headers: ep.headers(apiKey) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network request failed';
    return { ok: false, code: 'network', message };
  }

  if (!res.ok) {
    const code = statusToCode(res.status);
    if (code !== null) {
      return { ok: false, code, message: statusMessage(provider, res.status) };
    }
    return {
      ok: false,
      code: 'network',
      message: `${provider} returned an unexpected HTTP ${res.status}.`,
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid JSON in response';
    return { ok: false, code: 'network', message };
  }

  const modelCount = countModels(body);
  return { ok: true, modelCount };
}

function countModels(body: unknown): number {
  if (body === null || typeof body !== 'object') return 0;
  const data = (body as { data?: unknown }).data;
  if (Array.isArray(data)) return data.length;
  const models = (body as { models?: unknown }).models;
  if (Array.isArray(models)) return models.length;
  return 0;
}
