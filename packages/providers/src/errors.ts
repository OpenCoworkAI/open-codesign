/**
 * normalizeProviderError — flatten heterogeneous provider SDK errors into a
 * single shape for structured logging.
 *
 * PRINCIPLES §10 (errors loud): every upstream failure carries enough
 * identity (status, request-id) to be reproducible, with secrets scrubbed.
 *
 * NOTE: a near-identical API_KEY_RE lives in
 * apps/desktop/src/main/diagnostics-ipc.ts — we duplicate the constant here
 * instead of importing across module layers. Per CLAUDE.md "three similar
 * lines is fine", the duplication is intentional.
 */

import { looksLikeGatewayMissingMessagesApi } from './gateway-compat';

const API_KEY_RE =
  /(sk-[A-Za-z0-9-_]{20,}|AIzaSy[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|[A-Za-z0-9+/]{43}=|[A-Fa-f0-9]{32,}|Bearer\s+[A-Za-z0-9._~+/=-]+)/g;
const REDACTION = '***REDACTED***';
const BODY_HEAD_LIMIT = 512;

const REQUEST_ID_KEYS = [
  'x-request-id',
  'request-id',
  'openai-request-id',
  'anthropic-request-id',
  'x-amzn-requestid',
];

/**
 * Stable taxonomy for recovery actions. When the UI receives a
 * NormalizedProviderError, it can use this category to show a targeted
 * hint ("Check your API key", "Try adding /v1", etc.) instead of a
 * generic "something went wrong" message.
 */
export type RecoveryCategory =
  | 'auth_key_invalid'
  | 'auth_key_expired'
  | 'auth_permission'
  | 'endpoint_not_found'
  | 'endpoint_missing_v1'
  | 'wire_incompatible'
  | 'gateway_incompatible'
  | 'model_not_found'
  | 'model_not_supported_role'
  | 'rate_limit'
  | 'billing'
  | 'network_unreachable'
  | 'network_timeout'
  | 'upstream_server_error'
  | 'request_too_large'
  | 'tls_error'
  | 'unknown';

export interface NormalizedProviderError {
  upstream_provider: string;
  upstream_status: number | undefined;
  upstream_code: string | undefined;
  upstream_message: string;
  upstream_request_id: string | undefined;
  retry_count: number;
  redacted_body_head: string | undefined;
  original_error_name: string;
  /** Machine-readable recovery category so the UI can show a targeted hint. */
  recovery_category: RecoveryCategory;
}

function scrub(s: string): string {
  return s.replace(API_KEY_RE, REDACTION);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function pickNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function extractStatus(err: Record<string, unknown>): number | undefined {
  const direct = pickNumber(err['status']);
  if (direct !== undefined) return direct;
  const response = asRecord(err['response']);
  const viaResponse = response ? pickNumber(response['status']) : undefined;
  if (viaResponse !== undefined) return viaResponse;
  return pickNumber(err['statusCode']);
}

function extractCode(err: Record<string, unknown>): string | undefined {
  const direct = pickString(err['code']);
  if (direct !== undefined) return direct;
  const errorField = asRecord(err['error']);
  const viaError = errorField ? pickString(errorField['code']) : undefined;
  if (viaError !== undefined) return viaError;
  const response = asRecord(err['response']);
  const data = response ? asRecord(response['data']) : undefined;
  const dataError = data ? asRecord(data['error']) : undefined;
  return dataError ? pickString(dataError['code']) : undefined;
}

function extractMessage(err: unknown, errRec: Record<string, unknown>): string {
  const direct = pickString(errRec['message']);
  if (direct !== undefined) return direct;
  const response = asRecord(errRec['response']);
  const data = response ? asRecord(response['data']) : undefined;
  const dataError = data ? asRecord(data['error']) : undefined;
  const viaData = dataError ? pickString(dataError['message']) : undefined;
  if (viaData !== undefined) return viaData;
  const errorField = asRecord(errRec['error']);
  const viaError = errorField ? pickString(errorField['message']) : undefined;
  if (viaError !== undefined) return viaError;
  return String(err);
}

interface HeadersLike {
  get?: (key: string) => string | null | undefined;
  [key: string]: unknown;
}

function headerLookup(headers: HeadersLike, key: string): string | undefined {
  if (typeof headers.get === 'function') {
    const value = headers.get(key);
    if (typeof value === 'string' && value.length > 0) return value;
    return undefined;
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === key && typeof v === 'string' && v.length > 0) {
      return v;
    }
  }
  return undefined;
}

function extractRequestId(err: Record<string, unknown>): string | undefined {
  const response = asRecord(err['response']);
  const sources: HeadersLike[] = [];
  const responseHeaders = response ? (response['headers'] as unknown) : undefined;
  if (responseHeaders && typeof responseHeaders === 'object') {
    sources.push(responseHeaders as HeadersLike);
  }
  const errHeaders = err['headers'];
  if (errHeaders && typeof errHeaders === 'object') {
    sources.push(errHeaders as HeadersLike);
  }
  for (const source of sources) {
    for (const key of REQUEST_ID_KEYS) {
      const value = headerLookup(source, key);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function extractBodyHead(err: Record<string, unknown>): string | undefined {
  const response = asRecord(err['response']);
  let raw: string | undefined;
  if (response && 'data' in response) {
    const data = response['data'];
    if (typeof data === 'string') {
      raw = data;
    } else if (data && typeof data === 'object') {
      try {
        raw = JSON.stringify(data);
      } catch {
        raw = undefined;
      }
    }
  }
  if (raw === undefined) {
    const responseBody = pickString(err['responseBody']);
    if (responseBody !== undefined) raw = responseBody;
  }
  if (raw === undefined) return undefined;
  return scrub(raw).slice(0, BODY_HEAD_LIMIT);
}

function extractErrorName(err: unknown, errRec: Record<string, unknown>): string {
  const direct = pickString(errRec['name']);
  if (direct !== undefined) return direct;
  if (err && typeof err === 'object') {
    const ctor = (err as { constructor?: { name?: unknown } }).constructor;
    if (ctor && typeof ctor.name === 'string' && ctor.name.length > 0) {
      return ctor.name;
    }
  }
  return 'UnknownError';
}

/**
 * Classify a provider error into a recovery category so the UI can show
 * a targeted hint instead of a generic failure message.
 *
 * Priority: status code > message patterns > network/system code > fallback.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: deliberate per-status/message classification switch
export function classifyRecoveryCategory(
  status: number | undefined,
  code: string | undefined,
  message: string,
  wire?: string | undefined,
): RecoveryCategory {
  const msg = message.toLowerCase();
  const sysCode = (code ?? '').toLowerCase();

  if (sysCode === 'econnrefused' || sysCode === 'enotfound' || sysCode === 'econnreset') {
    return 'network_unreachable';
  }
  if (sysCode === 'etimedout' || sysCode === 'eai_again') {
    return 'network_timeout';
  }
  if (sysCode.includes('ssl') || sysCode.includes('cert') || sysCode.includes('tls')) {
    return 'tls_error';
  }

  if (status !== undefined) {
    if (status === 401) {
      if (msg.includes('expired') || msg.includes('revoked')) return 'auth_key_expired';
      if (msg.includes('permission') || msg.includes('insufficient')) return 'auth_permission';
      return 'auth_key_invalid';
    }
    if (status === 403) {
      if (msg.includes('permission') || msg.includes('insufficient')) return 'auth_permission';
      return 'auth_key_invalid';
    }
    if (status === 402) return 'billing';
    if (status === 404) {
      if (msg.includes('model')) return 'model_not_found';
      return 'endpoint_not_found';
    }
    if (status === 413 || (status === 400 && msg.includes('too large'))) {
      return 'request_too_large';
    }
    if (status === 429) return 'rate_limit';
    if (status >= 500 && status < 600) {
      if (msg.includes('not implemented') || msg.includes('unsupported')) {
        return 'gateway_incompatible';
      }
      return 'upstream_server_error';
    }
  }

  if (msg.includes('not implemented') || msg.includes('unsupported') || msg.includes('501')) {
    return 'gateway_incompatible';
  }
  if (
    msg.includes('model') &&
    (msg.includes('not found') || msg.includes('not exist') || msg.includes('does not exist'))
  ) {
    return 'model_not_found';
  }
  if (
    msg.includes('developer role') ||
    msg.includes('system role') ||
    msg.includes('unsupported role')
  ) {
    return 'model_not_supported_role';
  }
  if (msg.includes('quota') || msg.includes('billing') || msg.includes('credit')) {
    return 'billing';
  }
  if (msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'rate_limit';
  }
  if (msg.includes('expired') || msg.includes('revoked')) {
    return 'auth_key_expired';
  }
  if (
    msg.includes('invalid') &&
    (msg.includes('api key') || msg.includes('apikey') || msg.includes('auth'))
  ) {
    return 'auth_key_invalid';
  }

  if (wire === 'anthropic' && looksLikeGatewayMissingMessagesApi({ message } as Error)) {
    return 'gateway_incompatible';
  }

  return 'unknown';
}

/**
 * Return a user-facing recovery hint for a given recovery category.
 * The returned text is English-only; downstream UI layers may optionally
 * map these to i18n keys.
 */
export function recoveryHintFor(category: RecoveryCategory): string {
  switch (category) {
    case 'auth_key_invalid':
      return 'Check your API key is correct and active in provider settings';
    case 'auth_key_expired':
      return 'Your API key may have expired — generate a new one and update provider settings';
    case 'auth_permission':
      return 'Your API key may lack required permissions — check provider dashboard';
    case 'endpoint_not_found':
      return 'Verify your base URL is correct (typo, wrong path, or wrong port)';
    case 'endpoint_missing_v1':
      return 'Try adding /v1 to your base URL — many OpenAI-compatible gateways require it';
    case 'wire_incompatible':
      return 'Try switching wire type in advanced provider settings';
    case 'gateway_incompatible':
      return 'This gateway does not support the selected wire — try switching to a compatible wire or a different provider';
    case 'model_not_found':
      return 'Check model ID spelling or try listing available models from your provider';
    case 'model_not_supported_role':
      return 'The selected model does not support the developer/system role — try a different model or disable reasoning';
    case 'rate_limit':
      return 'Rate limited — wait a moment and retry, or upgrade your provider plan';
    case 'billing':
      return 'Check your billing status and quota in your provider dashboard';
    case 'network_unreachable':
      return 'Cannot reach the server — check your network, base URL, and firewall settings';
    case 'network_timeout':
      return 'Connection timed out — check your network, or increase timeout in advanced settings';
    case 'upstream_server_error':
      return 'Upstream server error — the provider may be experiencing issues, try again later';
    case 'request_too_large':
      return 'Request payload too large — reduce attachment size, prompt length, or conversation history';
    case 'tls_error':
      return 'SSL/TLS certificate error — check TLS settings in advanced provider configuration';
    default:
      return 'An unexpected error occurred — check the diagnostics panel for details';
  }
}

export function normalizeProviderError(
  err: unknown,
  provider: string,
  retryCount: number,
  wire?: string | undefined,
): NormalizedProviderError {
  const rec = asRecord(err) ?? {};
  const rawMessage = extractMessage(err, rec);
  const upstreamStatus = extractStatus(rec);
  const upstreamCode = extractCode(rec);
  const upstreamMessage = scrub(rawMessage);
  return {
    upstream_provider: provider,
    upstream_status: upstreamStatus,
    upstream_code: upstreamCode,
    upstream_message: upstreamMessage,
    upstream_request_id: extractRequestId(rec),
    retry_count: retryCount,
    redacted_body_head: extractBodyHead(rec),
    original_error_name: extractErrorName(err, rec),
    recovery_category: classifyRecoveryCategory(
      upstreamStatus,
      upstreamCode,
      upstreamMessage,
      wire,
    ),
  };
}
