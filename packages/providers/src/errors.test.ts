import { describe, expect, it } from 'vitest';
import {
  classifyRecoveryCategory,
  type NormalizedProviderError,
  normalizeProviderError,
  recoveryHintFor,
} from './errors';

describe('provider recovery classification', () => {
  it.each([
    [400, undefined, 'unsupported role: developer', 'model_not_supported_role'],
    [400, undefined, 'model does not support system role', 'model_not_supported_role'],
    [400, undefined, 'unsupported model not found', 'model_not_found'],
    [400, undefined, 'unsupported response_format', 'unknown'],
    [undefined, undefined, 'request ID 15012', 'unknown'],
    [undefined, 'ECONNREFUSED', 'fetch failed', 'network_unreachable'],
    [undefined, 'ENOTFOUND', 'fetch failed', 'network_unreachable'],
    [undefined, 'ECONNRESET', 'fetch failed', 'network_unreachable'],
    [undefined, 'ETIMEDOUT', 'fetch failed', 'network_timeout'],
    [undefined, 'CERT_HAS_EXPIRED', 'certificate expired', 'tls_error'],
    [401, undefined, 'expired token', 'auth_key_expired'],
    [401, undefined, 'invalid key', 'auth_key_invalid'],
    [403, undefined, 'insufficient permissions', 'auth_permission'],
    [402, undefined, 'payment required', 'billing'],
    [429, 'insufficient_quota', 'quota exhausted', 'billing'],
    [429, undefined, 'too many requests', 'rate_limit'],
    [404, undefined, 'model not found', 'model_not_found'],
    [404, undefined, 'page not found', 'endpoint_not_found'],
    [413, undefined, 'body too large', 'request_too_large'],
    [501, undefined, 'not implemented', 'gateway_incompatible'],
    [503, undefined, 'unavailable', 'upstream_server_error'],
    [503, undefined, 'unsupported response_format', 'upstream_server_error'],
    [undefined, undefined, 'base URL must include /v1', 'endpoint_missing_v1'],
    [undefined, undefined, 'The /v1 path is required in the base URL', 'endpoint_missing_v1'],
    [undefined, undefined, 'unsupported wire', 'wire_incompatible'],
    [undefined, undefined, 'protocol openai-responses is not supported', 'wire_incompatible'],
  ])('classifies status %s / %s / %s as %s', (status, code, message, category) => {
    expect(classifyRecoveryCategory(status, code, message)).toBe(category);
    expect(recoveryHintFor(category as Parameters<typeof recoveryHintFor>[0])).toBeTruthy();
  });

  it('preserves a nested fetch failure code through normalization', () => {
    const err = new TypeError('fetch failed', {
      cause: Object.assign(new Error('socket timeout'), { code: 'ETIMEDOUT' }),
    });
    expect(normalizeProviderError(err, 'custom-relay', 2)).toMatchObject({
      upstream_code: 'ETIMEDOUT',
      recovery_category: 'network_timeout',
      retry_count: 2,
    });
  });

  it('handles long upstream text without guessing a missing version or incompatible wire', () => {
    const message = 'baseurlmissing include wire '.repeat(10_000);
    expect(classifyRecoveryCategory(undefined, undefined, message)).toBe('unknown');
  });

  it('does not follow a cyclic error cause forever', () => {
    const err = { message: 'fetch failed', cause: {} };
    err.cause = err;
    expect(normalizeProviderError(err, 'custom-relay', 0).recovery_category).toBe('unknown');
  });

  it('keeps logged identity and messages scrubbed when tagging recovery', () => {
    const result = normalizeProviderError(
      {
        status: 401,
        message: 'Invalid api key sk-aaaaaaaaaaaaaaaaaaaaa',
        headers: { 'x-request-id': 'req_recovery' },
      },
      'custom-relay',
      1,
    );
    expect(result).toMatchObject({
      recovery_category: 'auth_key_invalid',
      upstream_request_id: 'req_recovery',
      retry_count: 1,
    });
    expect(result.upstream_message).not.toContain('sk-aaaaaaaaaaaaaaaaaaaaa');
    expect(result.upstream_message).toContain('***REDACTED***');
  });
});

describe('normalizeProviderError', () => {
  it('extracts status, request id, and message from OpenAI-style error', () => {
    const err = {
      status: 429,
      response: {
        headers: {
          get: (k: string) => (k.toLowerCase() === 'x-request-id' ? 'req_abc' : null),
        },
      },
      message: 'Rate limited',
    };
    const result = normalizeProviderError(err, 'openai', 0);
    expect(result.upstream_status).toBe(429);
    expect(result.upstream_request_id).toBe('req_abc');
    expect(result.upstream_message).toBe('Rate limited');
    expect(result.upstream_provider).toBe('openai');
    expect(result.retry_count).toBe(0);
  });

  it('redacts API keys in Anthropic-style error message', () => {
    const err = {
      status: 401,
      headers: { 'anthropic-request-id': 'req_123' },
      error: {
        type: 'authentication_error',
        message: 'Invalid api key sk-aaaaaaaaaaaaaaaaaaaaa',
      },
    };
    const result = normalizeProviderError(err, 'anthropic', 0);
    expect(result.upstream_status).toBe(401);
    expect(result.upstream_request_id).toBe('req_123');
    expect(result.upstream_message).not.toContain('sk-aaaaaaaaaaaaaaaaaaaaa');
    expect(result.upstream_message).toContain('***REDACTED***');
  });

  it('handles plain network error with no response', () => {
    const err = new Error('fetch failed');
    const result = normalizeProviderError(err, 'openai', 0);
    expect(result.upstream_status).toBeUndefined();
    expect(result.upstream_code).toBeUndefined();
    expect(result.upstream_request_id).toBeUndefined();
    expect(result.upstream_message).toBe('fetch failed');
    expect(result.original_error_name).toBe('Error');
  });

  it('preserves original_error_name for AbortError', () => {
    const err = { name: 'AbortError', message: 'aborted' };
    const result = normalizeProviderError(err, 'openai', 0);
    expect(result.original_error_name).toBe('AbortError');
    expect(result.upstream_status).toBeUndefined();
  });

  it('redacts Bearer tokens in redacted_body_head', () => {
    const err = {
      response: {
        data: {
          error: { message: 'wrong key' },
          raw: 'Bearer sk-1234567890abcdefghij',
        },
      },
    };
    const result = normalizeProviderError(err, 'openai', 0);
    expect(result.redacted_body_head).toBeDefined();
    expect(result.redacted_body_head).toContain('***REDACTED***');
    expect(result.redacted_body_head).not.toContain('sk-1234567890abcdefghij');
  });

  it('truncates body to 512 chars', () => {
    const longBody = 'x'.repeat(2048);
    const err = { response: { data: longBody } };
    const result = normalizeProviderError(err, 'openai', 0);
    expect(result.redacted_body_head).toBeDefined();
    expect(result.redacted_body_head?.length).toBe(512);
  });

  it('passes through retry_count', () => {
    const err = new Error('boom');
    const result: NormalizedProviderError = normalizeProviderError(err, 'openai', 3);
    expect(result.retry_count).toBe(3);
  });

  it('matches request id case-insensitively from plain-object headers', () => {
    const err = { headers: { 'X-Request-Id': 'req_xyz' } };
    const result = normalizeProviderError(err, 'openai', 0);
    expect(result.upstream_request_id).toBe('req_xyz');
  });

  it('redacts Google / AWS / Azure key shapes in messages', () => {
    // Obviously-fake placeholder shapes — matched by the regex, won't trigger
    // GitHub push-protection on realistic-looking secrets.
    const samples = [
      'error: AIzaSy000000000000000000000000000000000000 leaked',
      'aws key AKIA0000000000000000 in the body',
      `azure token ${'A'.repeat(43)}= found`,
    ];
    for (const raw of samples) {
      const err = { message: raw };
      const result = normalizeProviderError(err, 'generic', 0);
      expect(result.upstream_message).toContain('***REDACTED***');
      expect(result.upstream_message).not.toContain('AIzaSy0000');
      expect(result.upstream_message).not.toContain('AKIA0000');
    }
  });
});
