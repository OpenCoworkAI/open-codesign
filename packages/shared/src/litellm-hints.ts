/**
 * LiteLLM Gateway connection failures get their own hints. The saved provider
 * is still a normal OpenAI-compatible entry, so identity comes from the preset
 * id, a name or provider id that says LiteLLM, or a base URL whose host or
 * path says LiteLLM. The port is not a signal: other local servers also use
 * port 4000.
 */

export const LITELLM_CONNECTION_HINT_KEYS = {
  auth: 'settings.providers.litellm.diagnostics.auth',
  notFound: 'settings.providers.litellm.diagnostics.notFound',
  notFoundLocal: 'settings.providers.litellm.diagnostics.notFoundLocal',
  unreachable: 'settings.providers.litellm.diagnostics.unreachable',
} as const;

export interface LiteLlmTargetInput {
  presetId?: string | undefined;
  providerId?: string | undefined;
  name?: string | undefined;
  baseUrl?: string | undefined;
}

export function isLiteLlmConnectionTarget(input: LiteLlmTargetInput): boolean {
  if (input.presetId === 'litellm') return true;
  const label = `${input.name ?? ''} ${input.providerId ?? ''}`.toLowerCase();
  if (label.includes('litellm')) return true;
  return urlMentionsLiteLlm(input.baseUrl);
}

export function liteLlmEndpointPreset(input: LiteLlmTargetInput): { presetId?: 'litellm' } {
  return isLiteLlmConnectionTarget(input) ? { presetId: 'litellm' } : {};
}

export function liteLlmHintKeyForHttpStatus(status: number, baseUrl?: string): string | undefined {
  if (status === 401 || status === 403) return LITELLM_CONNECTION_HINT_KEYS.auth;
  if (status === 404) {
    return isLoopbackBaseUrl(baseUrl)
      ? LITELLM_CONNECTION_HINT_KEYS.notFoundLocal
      : LITELLM_CONNECTION_HINT_KEYS.notFound;
  }
  return undefined;
}

export function liteLlmHintKeyForTransportError(err: unknown): string | undefined {
  return transportSignals(err).includes('ECONNREFUSED')
    ? LITELLM_CONNECTION_HINT_KEYS.unreachable
    : undefined;
}

function urlMentionsLiteLlm(baseUrl: string | undefined): boolean {
  const url = parseBaseUrl(baseUrl);
  if (url === null) return false;
  const host = hostnameOf(url);
  return host.includes('litellm') || url.pathname.toLowerCase().includes('litellm');
}

function isLoopbackBaseUrl(baseUrl: string | undefined): boolean {
  const url = parseBaseUrl(baseUrl);
  if (url === null) return false;
  const host = hostnameOf(url);
  return (
    host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1'
  );
}

function parseBaseUrl(baseUrl: string | undefined): URL | null {
  if (baseUrl === undefined || baseUrl.length === 0) return null;
  try {
    return new URL(baseUrl);
  } catch {
    return null;
  }
}

function hostnameOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

function transportSignals(err: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown): void => {
    if (value == null || seen.has(value)) return;
    if (typeof value === 'string') {
      parts.push(value);
      return;
    }
    if (typeof value !== 'object') return;
    seen.add(value);
    const record = value as {
      message?: unknown;
      code?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    if (typeof record.code === 'string') parts.push(record.code);
    if (typeof record.message === 'string') parts.push(record.message);
    visit(record.cause);
    if (Array.isArray(record.errors)) {
      for (const item of record.errors) visit(item);
    }
  };
  visit(err);
  return parts.join(' ');
}
