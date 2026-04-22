import { stripInferenceEndpointSuffix } from './base-url';
import type { WireApi } from './config';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);
const ANTHROPIC_API_HOST = 'api.anthropic.com';

function hostnameFor(baseUrl: string): string | null {
  try {
    return new URL(stripInferenceEndpointSuffix(baseUrl)).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function shouldMirrorBearerForAnthropic(baseUrl?: string): boolean {
  if (baseUrl === undefined || baseUrl.length === 0) return false;
  const hostname = hostnameFor(baseUrl);
  if (hostname === null) return false;
  return hostname !== ANTHROPIC_API_HOST && !LOCAL_HOSTS.has(hostname);
}

export function buildAuthHeadersForWire(
  wire: WireApi,
  apiKey: string,
  options: {
    baseUrl?: string;
    extraHeaders?: Record<string, string>;
  } = {},
): Record<string, string> {
  const { baseUrl, extraHeaders } = options;
  if (apiKey.length === 0) {
    const base = wire === 'anthropic' ? { 'anthropic-version': '2023-06-01' } : {};
    return { ...base, ...(extraHeaders ?? {}) };
  }

  if (wire === 'anthropic') {
    const base: Record<string, string> = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
    if (shouldMirrorBearerForAnthropic(baseUrl)) {
      base['authorization'] = `Bearer ${apiKey}`;
    }
    return { ...base, ...(extraHeaders ?? {}) };
  }

  return { authorization: `Bearer ${apiKey}`, ...(extraHeaders ?? {}) };
}
