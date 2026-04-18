import { CodesignError } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import { remapProviderError, rewriteUpstreamMessage } from './errors';

const LEAKED =
  'Incorrect API key provided: sk-AAA. You can find your API key at https://platform.openai.com/account/api-keys.';

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe('rewriteUpstreamMessage', () => {
  it('keeps openai URL when active provider is openai', () => {
    const result = rewriteUpstreamMessage(LEAKED, 'openai', 401);
    expect(result.rewritten).toBe(false);
    expect(result.message).toContain('platform.openai.com/account/api-keys');
  });

  it('rewrites leaked openai URL to anthropic billing URL', () => {
    const result = rewriteUpstreamMessage(LEAKED, 'anthropic', 401);
    expect(result.rewritten).toBe(true);
    expect(result.message).not.toContain('openai.com');
    expect(result.message).toContain('console.anthropic.com/settings/keys');
  });

  it('rewrites leaked openai URL to openrouter URL', () => {
    const result = rewriteUpstreamMessage(LEAKED, 'openrouter', 401);
    expect(result.message).toContain('openrouter.ai/settings/keys');
  });

  it('rewrites to deepseek URL even though it is not in the typed enum', () => {
    const result = rewriteUpstreamMessage(LEAKED, 'deepseek', 401);
    expect(result.message).toContain('platform.deepseek.com/api_keys');
  });

  it('strips URL and adds generic hint for unknown providers', () => {
    const result = rewriteUpstreamMessage(LEAKED, 'mystery-llm', 401);
    expect(result.rewritten).toBe(true);
    expect(result.message).not.toContain('openai.com');
    expect(result.message).toContain("Check your provider's API key settings");
  });

  it('does not rewrite 5xx errors', () => {
    const result = rewriteUpstreamMessage(LEAKED, 'anthropic', 503);
    expect(result.rewritten).toBe(false);
  });

  it('does not rewrite when no openai URL is present', () => {
    const result = rewriteUpstreamMessage('Bad request: model not found', 'anthropic', 400);
    expect(result.rewritten).toBe(false);
  });
});

describe('remapProviderError', () => {
  it('passes openai 401 through verbatim', () => {
    const err = httpError(401, LEAKED);
    const out = remapProviderError(err, 'openai');
    expect(out).toBe(err);
  });

  it('rewrites anthropic 401 with leaked openai URL into a CodesignError', () => {
    const err = httpError(401, LEAKED);
    const out = remapProviderError(err, 'anthropic');
    expect(out).toBeInstanceOf(CodesignError);
    expect((out as CodesignError).message).toContain('console.anthropic.com/settings/keys');
    expect((out as CodesignError).message).not.toContain('openai.com');
    expect((out as CodesignError).code).toBe('PROVIDER_HTTP_4XX');
  });

  it('strips the URL when provider is unknown', () => {
    const err = httpError(401, LEAKED);
    const out = remapProviderError(err, 'mystery-llm');
    expect(out).toBeInstanceOf(CodesignError);
    expect((out as CodesignError).message).not.toContain('openai.com');
    expect((out as CodesignError).message).toContain("Check your provider's API key settings");
  });

  it('passes 5xx errors through unchanged', () => {
    const err = httpError(503, 'upstream unavailable');
    const out = remapProviderError(err, 'anthropic');
    expect(out).toBe(err);
  });

  it('extracts status code from CodesignError messages that embed it', () => {
    const err = new CodesignError(
      'HTTP 401 — see https://platform.openai.com/account/api-keys',
      'PROVIDER_ERROR',
    );
    const out = remapProviderError(err, 'anthropic');
    expect(out).toBeInstanceOf(CodesignError);
    expect((out as CodesignError).message).toContain('console.anthropic.com/settings/keys');
  });
});
