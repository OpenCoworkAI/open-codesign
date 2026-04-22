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

export interface NormalizedProviderError {
  upstream_provider: string;
  upstream_status: number | undefined;
  upstream_code: string | undefined;
  upstream_message: string;
  upstream_request_id: string | undefined;
  retry_count: number;
  redacted_body_head: string | undefined;
  original_error_name: string;
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

export function normalizeProviderError(
  err: unknown,
  provider: string,
  retryCount: number,
): NormalizedProviderError {
  const rec = asRecord(err) ?? {};
  const rawMessage = extractMessage(err, rec);
  return {
    upstream_provider: provider,
    upstream_status: extractStatus(rec),
    upstream_code: extractCode(rec),
    upstream_message: scrub(rawMessage),
    upstream_request_id: extractRequestId(rec),
    retry_count: retryCount,
    redacted_body_head: extractBodyHead(rec),
    original_error_name: extractErrorName(err, rec),
  };
}
