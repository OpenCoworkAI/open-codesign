import { type ChatMessage, CodesignError, type ModelRef } from '@open-codesign/shared';
import { describe, expect, it, vi } from 'vitest';
import type { GenerateOptions, GenerateResult } from './index';
import {
  classifyError,
  completeWithRetry,
  isProviderAbortedTransportError,
  type RetryReason,
  withBackoff,
} from './retry';

const MODEL: ModelRef = { provider: 'anthropic', modelId: 'claude-sonnet-4-6' };
const MESSAGES: ChatMessage[] = [{ role: 'user', content: 'hi' }];
const OPTS: GenerateOptions = { apiKey: 'test-key' };

const ok: GenerateResult = { content: 'hello', inputTokens: 1, outputTokens: 1, costUsd: 0 };

class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

describe('classifyError', () => {
  it('marks 5xx as retryable', () => {
    expect(classifyError(new HttpError('boom', 503))).toMatchObject({ retry: true });
  });
  it('does not retry 5xx when body says Messages API is not implemented on anthropic wire', () => {
    const d = classifyError(new HttpError('500 not implemented', 500), 'anthropic');
    expect(d.retry).toBe(false);
    expect(d.reason).toMatch(/gateway does not implement Messages API/);
  });
  it('still retries 5xx "not implemented" on openai-chat wire (not a gateway-compat issue)', () => {
    const d = classifyError(new HttpError('500 not implemented', 500), 'openai-chat');
    expect(d.retry).toBe(true);
    expect(d.reason).toMatch(/server error/);
  });
  it('still retries 5xx "not implemented" when wire is unknown (safer default)', () => {
    const d = classifyError(new HttpError('500 not implemented', 500));
    expect(d.retry).toBe(true);
  });
  it('marks 4xx (non-429) as non-retryable', () => {
    expect(classifyError(new HttpError('bad', 400))).toMatchObject({ retry: false });
  });
  it('marks 429 as retryable and parses retry-after seconds', () => {
    const d = classifyError(new HttpError('slow', 429, { 'retry-after': '7' }));
    expect(d.retry).toBe(true);
    expect(d.retryAfterMs).toBe(7000);
  });
  it('treats empty retry-after as no hint (not 0ms)', () => {
    const d = classifyError(new HttpError('slow', 429, { 'retry-after': '' }));
    expect(d.retry).toBe(true);
    expect(d.retryAfterMs).toBeUndefined();
  });
  it('treats whitespace-only retry-after as no hint', () => {
    const d = classifyError(new HttpError('slow', 429, { 'retry-after': '   ' }));
    expect(d.retry).toBe(true);
    expect(d.retryAfterMs).toBeUndefined();
  });
  it('parses HTTP-date retry-after to a delay relative to now', () => {
    const future = new Date(Date.now() + 2_000).toUTCString();
    const d = classifyError(new HttpError('slow', 429, { 'retry-after': future }));
    expect(d.retry).toBe(true);
    expect(d.retryAfterMs).toBeGreaterThanOrEqual(0);
    expect(d.retryAfterMs).toBeLessThanOrEqual(2_500);
  });
  it('marks AbortError as not retryable', () => {
    const err = new DOMException('Aborted', 'AbortError');
    expect(classifyError(err)).toMatchObject({ retry: false, reason: 'aborted' });
  });
  it('marks TypeError (fetch failure) as retryable', () => {
    expect(classifyError(new TypeError('fetch failed'))).toMatchObject({ retry: true });
  });
  it('marks fetch failed: terminated as retryable', () => {
    const d = classifyError(new Error('fetch failed: terminated'));
    expect(d.retry).toBe(true);
    expect(d.reason).toMatch(/transport-level error/);
  });
  it('marks standalone terminated as retryable', () => {
    const d = classifyError(new Error('terminated'));
    expect(d.retry).toBe(true);
    expect(d.reason).toMatch(/transport-level error/);
  });
  it('does not treat unterminated as a terminated transport error', () => {
    const d = classifyError(new Error('unterminated JSON response'));
    expect(d.retry).toBe(false);
  });
  it('marks premature close as retryable', () => {
    const d = classifyError(new Error('premature close'));
    expect(d.retry).toBe(true);
    expect(d.reason).toMatch(/transport-level error/);
  });
  it('marks stream ended as retryable', () => {
    const d = classifyError(new Error('stream ended'));
    expect(d.retry).toBe(true);
    expect(d.reason).toMatch(/transport-level error/);
  });
  it('marks ECONNRESET as retryable via network code', () => {
    const err = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    const d = classifyError(err);
    expect(d.retry).toBe(true);
  });
  it('recognizes provider-side aborted transport messages for agent replay only', () => {
    expect(isProviderAbortedTransportError('Request was aborted')).toBe(true);
    expect(isProviderAbortedTransportError('Generation aborted by provider')).toBe(true);
    expect(isProviderAbortedTransportError('Generation aborted by user')).toBe(false);
  });
  it('does not retry regular errors without transport indicators', () => {
    const d = classifyError(new Error('something went wrong'));
    expect(d.retry).toBe(false);
  });
});

describe('completeWithRetry', () => {
  it('returns the result on first-try success', async () => {
    const impl = vi.fn().mockResolvedValueOnce(ok);
    const out = await completeWithRetry(MODEL, MESSAGES, OPTS, {}, impl);
    expect(out).toEqual(ok);
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 then succeeds, surfacing each attempt via onRetry', async () => {
    const impl = vi
      .fn()
      .mockRejectedValueOnce(new HttpError('boom', 503))
      .mockResolvedValueOnce(ok);
    const onRetry = vi.fn<(info: RetryReason) => void>();
    const out = await completeWithRetry(MODEL, MESSAGES, OPTS, { baseDelayMs: 1, onRetry }, impl);
    expect(out).toEqual(ok);
    expect(impl).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]?.[0].reason).toMatch(/server error/);
  });

  it('throws after exhausting retries', async () => {
    const impl = vi.fn().mockRejectedValue(new HttpError('still down', 500));
    await expect(
      completeWithRetry(MODEL, MESSAGES, OPTS, { baseDelayMs: 1, maxRetries: 3 }, impl),
    ).rejects.toThrow(/still down/);
    expect(impl).toHaveBeenCalledTimes(3);
  });

  it('does not retry on a 401 client error', async () => {
    const impl = vi.fn().mockRejectedValue(new HttpError('unauthorized', 401));
    await expect(
      completeWithRetry(MODEL, MESSAGES, OPTS, { baseDelayMs: 1 }, impl),
    ).rejects.toThrow(/unauthorized/);
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('honours Retry-After on 429 (delay is at least retryAfterMs)', async () => {
    const impl = vi
      .fn()
      .mockRejectedValueOnce(new HttpError('slow', 429, { 'retry-after': '0.05' }))
      .mockResolvedValueOnce(ok);
    const onRetry = vi.fn<(info: RetryReason) => void>();
    const out = await completeWithRetry(MODEL, MESSAGES, OPTS, { baseDelayMs: 1, onRetry }, impl);
    expect(out).toEqual(ok);
    const info = onRetry.mock.calls[0]?.[0];
    expect(info?.retryAfterMs).toBe(50);
    expect(info?.delayMs).toBeGreaterThanOrEqual(50);
  });

  it('aborts immediately when signal is already aborted', async () => {
    const impl = vi.fn().mockResolvedValue(ok);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      completeWithRetry(MODEL, MESSAGES, { ...OPTS, signal: ctrl.signal }, {}, impl),
    ).rejects.toBeInstanceOf(CodesignError);
    expect(impl).not.toHaveBeenCalled();
  });

  it('aborts mid-backoff when signal fires during retry sleep', async () => {
    const impl = vi.fn().mockRejectedValue(new HttpError('boom', 503));
    const ctrl = new AbortController();
    const promise = completeWithRetry(
      MODEL,
      MESSAGES,
      { ...OPTS, signal: ctrl.signal },
      { baseDelayMs: 5_000, maxRetries: 5 },
      impl,
    );
    setTimeout(() => ctrl.abort(), 10);
    await expect(promise).rejects.toThrow();
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('emits provider.error on each retried attempt with incrementing retry_count', async () => {
    const impl = vi
      .fn()
      .mockRejectedValueOnce(new HttpError('boom', 500))
      .mockRejectedValueOnce(new HttpError('boom', 500))
      .mockResolvedValueOnce(ok);
    const logger = { warn: vi.fn() };
    await completeWithRetry(
      MODEL,
      MESSAGES,
      OPTS,
      { baseDelayMs: 1, maxRetries: 5, logger, provider: 'anthropic' },
      impl,
    );
    const retryCalls = logger.warn.mock.calls.filter((c) => c[0] === 'provider.error');
    expect(retryCalls.length).toBe(2);
    expect(retryCalls[0]?.[1]).toMatchObject({ upstream_status: 500, retry_count: 0 });
    expect(retryCalls[1]?.[1]).toMatchObject({ upstream_status: 500, retry_count: 1 });
  });

  it('emits provider.error.final on retry exhaustion', async () => {
    const impl = vi.fn().mockRejectedValue(new HttpError('still down', 500));
    const logger = { warn: vi.fn() };
    await expect(
      completeWithRetry(MODEL, MESSAGES, OPTS, { baseDelayMs: 1, maxRetries: 3, logger }, impl),
    ).rejects.toThrow(/still down/);
    const lastCall = logger.warn.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe('provider.error.final');
    expect(lastCall?.[1]).toMatchObject({ upstream_status: 500, retry_count: 2 });
  });

  it('works without a logger (logger is optional)', async () => {
    const impl = vi
      .fn()
      .mockRejectedValueOnce(new HttpError('boom', 503))
      .mockResolvedValueOnce(ok);
    const out = await completeWithRetry(MODEL, MESSAGES, OPTS, { baseDelayMs: 1 }, impl);
    expect(out).toEqual(ok);
  });

  it('passes provider name through to the normalized payload', async () => {
    const impl = vi.fn().mockRejectedValue(new HttpError('bad', 401));
    const logger = { warn: vi.fn() };
    await expect(
      completeWithRetry(
        MODEL,
        MESSAGES,
        OPTS,
        { baseDelayMs: 1, logger, provider: 'anthropic' },
        impl,
      ),
    ).rejects.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      'provider.error.final',
      expect.objectContaining({ upstream_provider: 'anthropic' }),
    );
  });

  it('captures upstream_request_id from response headers', async () => {
    const impl = vi
      .fn()
      .mockRejectedValueOnce(new HttpError('throttled', 429, { 'x-request-id': 'req_test' }))
      .mockResolvedValueOnce(ok);
    const logger = { warn: vi.fn() };
    await completeWithRetry(
      MODEL,
      MESSAGES,
      OPTS,
      { baseDelayMs: 1, logger, provider: 'openai' },
      impl,
    );
    const firstCall = logger.warn.mock.calls.find((c) => c[0] === 'provider.error');
    expect(firstCall?.[1]).toMatchObject({ upstream_request_id: 'req_test' });
  });
});

describe('withBackoff', () => {
  it('returns the result on first-try success without invoking onRetry', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn().mockResolvedValueOnce('ok');
    const out = await withBackoff(fn, { baseDelayMs: 1, onRetry });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('retries on 503 then succeeds and surfaces each attempt via onRetry', async () => {
    const onRetry = vi.fn<(info: RetryReason) => void>();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new HttpError('boom', 503))
      .mockResolvedValueOnce('ok');
    const out = await withBackoff(fn, { baseDelayMs: 1, onRetry });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]?.[0].reason).toMatch(/server error/);
  });

  it('retries on 429 and honours Retry-After (delay is at least retryAfterMs)', async () => {
    const onRetry = vi.fn<(info: RetryReason) => void>();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new HttpError('slow', 429, { 'retry-after': '0.05' }))
      .mockResolvedValueOnce('ok');
    await withBackoff(fn, { baseDelayMs: 1, onRetry });
    const info = onRetry.mock.calls[0]?.[0];
    expect(info?.retryAfterMs).toBe(50);
    expect(info?.delayMs).toBeGreaterThanOrEqual(50);
  });

  it('does not retry on a 4xx client error', async () => {
    const fn = vi.fn().mockRejectedValue(new HttpError('unauthorized', 401));
    await expect(withBackoff(fn, { baseDelayMs: 1 })).rejects.toThrow(/unauthorized/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts maxRetries and rethrows the last error', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn().mockRejectedValue(new HttpError('still down', 500));
    await expect(withBackoff(fn, { baseDelayMs: 1, maxRetries: 3, onRetry })).rejects.toThrow(
      /still down/,
    );
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('aborts immediately when signal is already aborted', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(withBackoff(fn, { signal: ctrl.signal })).rejects.toBeInstanceOf(CodesignError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('aborts mid-backoff when signal fires during retry sleep', async () => {
    const fn = vi.fn().mockRejectedValue(new HttpError('boom', 503));
    const ctrl = new AbortController();
    const promise = withBackoff(fn, {
      baseDelayMs: 5_000,
      maxRetries: 5,
      signal: ctrl.signal,
    });
    setTimeout(() => ctrl.abort(), 10);
    await expect(promise).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses a custom classify override when provided', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('weird'));
    const classify = vi.fn(() => ({ retry: false as const, reason: 'never-retry' }));
    await expect(withBackoff(fn, { baseDelayMs: 1, classify })).rejects.toThrow(/weird/);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
