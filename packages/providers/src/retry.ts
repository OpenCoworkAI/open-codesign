/**
 * completeWithRetry — exponential backoff wrapper around `complete()`.
 *
 * PRINCIPLES §10 (errors loud): every retry attempt is surfaced via the
 * `onRetry` callback so the UI can show a status line. Silent retries are
 * forbidden — the user must see why the call took longer than expected.
 *
 * Retry policy (Tier 1, intentionally conservative):
 *   - max 3 attempts (1 initial + 2 retries by default)
 *   - exponential delay: baseDelayMs * 2^(attempt-1) with ±20% jitter
 *   - retry only on transient classes: 5xx, network/abort-unrelated, 429
 *   - 429 honours Retry-After header (seconds or HTTP-date) when present
 *   - any AbortSignal abort short-circuits immediately, no retry
 */

import {
  type ChatMessage,
  CodesignError,
  ERROR_CODES,
  type ModelRef,
  type WireApi,
} from '@open-codesign/shared';
import { normalizeProviderError } from './errors';
import { looksLikeGatewayMissingMessagesApi } from './gateway-compat';
import { complete, type GenerateOptions, type GenerateResult } from './index';

export interface RetryReason {
  attempt: number;
  totalAttempts: number;
  delayMs: number;
  reason: string;
  retryAfterMs?: number;
}

export interface CompleteWithRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  onRetry?: (info: RetryReason) => void;
  logger?: { warn: (event: string, data?: Record<string, unknown>) => void };
  provider?: string;
  wire?: WireApi;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;

export interface RetryDecision {
  retry: boolean;
  reason: string;
  retryAfterMs?: number;
}

const RETRYABLE_NET_CODES = new Set([
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ECONNREFUSED',
]);

function classifyByStatus(status: number, err: unknown, wire?: WireApi): RetryDecision | undefined {
  if (status === 429) {
    const retryAfterMs = extractRetryAfterMs(err);
    const decision: RetryDecision = { retry: true, reason: 'rate-limited (429)' };
    if (retryAfterMs !== undefined) decision.retryAfterMs = retryAfterMs;
    return decision;
  }
  if (status >= 500 && status <= 599) {
    // Third-party Anthropic relays (sub2api, claude2api, anyrouter…) often
    // return 5xx + "not implemented" for POST /v1/messages even though their
    // /v1/models endpoint works. Retrying wastes 3 rounds of exponential
    // backoff on an endpoint that will never respond; short-circuit so the
    // user sees the actionable error immediately. Only applies to
    // anthropic-wire endpoints — OpenAI/Google wires can emit the same text
    // for unrelated reasons and should retry normally.
    if (wire === 'anthropic' && looksLikeGatewayMissingMessagesApi(err)) {
      return { retry: false, reason: 'gateway does not implement Messages API' };
    }
    return { retry: true, reason: `server error (${status})` };
  }
  if (status >= 400 && status <= 499) {
    return { retry: false, reason: `client error (${status})` };
  }
  return undefined;
}

const TRANSPORT_ERROR_RE =
  /(?:fetch\s+failed.*\bterminated\b|\bterminated\b|premature\s+close|stream\s+(?:ended|closed)|ECONNRESET)\b/i;
const PROVIDER_ABORTED_TRANSPORT_RE =
  /(?:fetch\s+failed.*\baborted\b|request\s+was\s+aborted|generation\s+aborted\s+by\s+provider|provider\s+aborted|upstream\s+aborted|read\s*timeout|connection\s+reset|socket\s+hang\s+up)\b/i;

export function isTransportLevelError(errorMessage: string | undefined): boolean {
  if (!errorMessage) return false;
  return TRANSPORT_ERROR_RE.test(errorMessage);
}

export function isProviderAbortedTransportError(errorMessage: string | undefined): boolean {
  if (!errorMessage) return false;
  return PROVIDER_ABORTED_TRANSPORT_RE.test(errorMessage);
}

function classifyByNetwork(err: unknown): RetryDecision | undefined {
  if (err instanceof TypeError) return { retry: true, reason: 'network error' };
  if (!(err instanceof Error)) return undefined;
  const code = (err as Error & { code?: unknown }).code;
  if (typeof code === 'string' && RETRYABLE_NET_CODES.has(code)) {
    return { retry: true, reason: `network error (${code})` };
  }
  if (isTransportLevelError(err.message)) {
    return { retry: true, reason: 'transport-level error (stream terminated)' };
  }
  return undefined;
}

export function classifyError(err: unknown, wire?: WireApi): RetryDecision {
  if (err instanceof Error && (err.name === 'AbortError' || err.message === 'aborted')) {
    return { retry: false, reason: 'aborted' };
  }
  const status = extractStatus(err);
  if (status !== undefined) {
    const byStatus = classifyByStatus(status, err, wire);
    if (byStatus) return byStatus;
  }
  const byNet = classifyByNetwork(err);
  if (byNet) return byNet;
  return { retry: false, reason: errorMessage(err) };
}

function extractStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const candidates = [
    (err as { status?: unknown }).status,
    (err as { statusCode?: unknown }).statusCode,
    (err as { response?: { status?: unknown } }).response?.status,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  // CodesignError messages may embed the status: "HTTP 503 …"
  if (err instanceof CodesignError) {
    const m = /\b(\d{3})\b/.exec(err.message);
    if (m?.[1]) {
      const n = Number(m[1]);
      if (n >= 400 && n < 600) return n;
    }
  }
  return undefined;
}

function extractRetryAfterMs(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const headers =
    (err as { headers?: Record<string, string | string[] | undefined> }).headers ??
    (err as { response?: { headers?: Record<string, string | string[] | undefined> } }).response
      ?.headers;
  const direct = (err as { retryAfter?: unknown }).retryAfter;
  const raw =
    pickHeader(headers, 'retry-after') ??
    (typeof direct === 'string' || typeof direct === 'number' ? String(direct) : undefined);
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  // Empty / whitespace-only headers must not coerce to 0 via Number(''),
  // which would otherwise emit a zero-delay retry hint and defeat backoff.
  if (trimmed.length === 0) return undefined;
  // Numeric path first — explicit shape so '7' / '1.5' parse but a
  // Date-formatted header ('Wed, 21 Oct 2015 …') falls through to Date.parse.
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

function pickHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) {
      if (Array.isArray(v)) return v[0];
      if (typeof v === 'string') return v;
    }
  }
  return undefined;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function computeDelay(attempt: number, baseDelayMs: number): number {
  const exponent = Math.max(0, attempt - 1);
  const base = baseDelayMs * 2 ** exponent;
  const jitter = base * (Math.random() * 0.4 - 0.2);
  return Math.max(0, Math.round(base + jitter));
}

export function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

type CompleteFn = (
  model: ModelRef,
  messages: ChatMessage[],
  opts: GenerateOptions,
) => Promise<GenerateResult>;

function buildRetryInfo(
  attempt: number,
  totalAttempts: number,
  decision: RetryDecision,
  baseDelayMs: number,
): RetryReason {
  const backoff = computeDelay(attempt, baseDelayMs);
  const delayMs =
    decision.retryAfterMs !== undefined ? Math.max(decision.retryAfterMs, backoff) : backoff;
  const info: RetryReason = { attempt, totalAttempts, delayMs, reason: decision.reason };
  if (decision.retryAfterMs !== undefined) info.retryAfterMs = decision.retryAfterMs;
  return info;
}

function shouldStop(decision: RetryDecision, attempt: number, maxRetries: number): boolean {
  return !decision.retry || attempt >= maxRetries;
}

export interface BackoffOptions {
  /** Total attempts (initial + retries). Default 3. */
  maxRetries?: number;
  /** Exponential-backoff base, ms. Default 500. */
  baseDelayMs?: number;
  /** Decide whether a given error is transient. Defaults to {@link classifyError}. */
  classify?: (err: unknown) => RetryDecision;
  /** Invoked immediately before each retry sleep. */
  onRetry?: (info: RetryReason) => void;
  /** Abort short-circuits both the in-flight call and the inter-retry sleep. */
  signal?: AbortSignal;
}

/**
 * Generic retry wrapper. `completeWithRetry` is a thin wrapper around this that
 * adds provider-error normalization + structured logging. Call this directly
 * when you need first-turn retry semantics around an arbitrary transient-prone
 * async op (e.g. `agent.prompt()` in the pi-agent-core path).
 */
export async function withBackoff<T>(fn: () => Promise<T>, opts: BackoffOptions = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const classify = opts.classify ?? classifyError;
  const signal = opts.signal;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new CodesignError('Generation aborted by user', ERROR_CODES.PROVIDER_ABORTED);
    }
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const decision = classify(err);
      if (shouldStop(decision, attempt, maxRetries)) {
        if (decision.reason === 'aborted') {
          throw new CodesignError('Generation aborted by user', ERROR_CODES.PROVIDER_ABORTED, {
            cause: err,
          });
        }
        throw err;
      }
      const info = buildRetryInfo(attempt, maxRetries, decision, baseDelayMs);
      opts.onRetry?.(info);
      await sleepWithAbort(info.delayMs, signal);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new CodesignError('withBackoff exhausted', ERROR_CODES.PROVIDER_RETRY_EXHAUSTED);
}

export async function completeWithRetry(
  model: ModelRef,
  messages: ChatMessage[],
  opts: GenerateOptions,
  retryOpts: CompleteWithRetryOptions = {},
  // Injected for tests; defaults to the real `complete`.
  _impl: CompleteFn = complete,
): Promise<GenerateResult> {
  const maxRetries = retryOpts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = retryOpts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const onRetry = retryOpts.onRetry;
  const logger = retryOpts.logger;
  const provider = retryOpts.provider ?? 'unknown';

  // Thin wrapper around withBackoff: folds provider-error normalization into
  // the classify/onRetry hooks so each attempt emits structured provider.error
  // logs and exhaustion surfaces provider.error.final.
  let attemptForLog = 0;
  const backoffOpts: BackoffOptions = {
    maxRetries,
    baseDelayMs,
    classify: (err) => {
      const decision = classifyError(err, retryOpts.wire);
      const retryCount = Math.max(0, attemptForLog - 1);
      const normalized = normalizeProviderError(err, provider, retryCount);
      if (shouldStop(decision, attemptForLog, maxRetries)) {
        logger?.warn('provider.error.final', normalized as unknown as Record<string, unknown>);
      } else {
        logger?.warn('provider.error', normalized as unknown as Record<string, unknown>);
      }
      return decision;
    },
    onRetry: (info) => {
      onRetry?.(info);
    },
  };
  if (opts.signal) backoffOpts.signal = opts.signal;
  return withBackoff(() => {
    attemptForLog += 1;
    return _impl(model, messages, opts);
  }, backoffOpts);
}
