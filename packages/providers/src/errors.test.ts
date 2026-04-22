import { describe, expect, it } from 'vitest';
import { type NormalizedProviderError, normalizeProviderError } from './errors';

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
