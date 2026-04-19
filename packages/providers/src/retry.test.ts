import { type ChatMessage, CodesignError, type ModelRef } from '@open-codesign/shared';
import { describe, expect, it, vi } from 'vitest';
import type { GenerateOptions, GenerateResult } from './index';
import { type RetryReason, classifyError, completeWithRetry } from './retry';

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
});
