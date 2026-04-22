import { describe, expect, it } from 'vitest';
import { diagnose, diagnoseGenerateFailure } from './diagnostics';

const baseCtx = {
  provider: 'openai',
  baseUrl: 'https://api.example.com',
};

describe('diagnose', () => {
  it('maps 401 to keyInvalid hypothesis with updateKey fix', () => {
    const result = diagnose('401', baseCtx);
    expect(result).toHaveLength(1);
    expect(result[0]?.cause).toBe('diagnostics.cause.keyInvalid');
    expect(result[0]?.suggestedFix?.label).toBe('diagnostics.fix.updateKey');
  });

  it('maps 403 to keyInvalid hypothesis (same as 401)', () => {
    const result = diagnose('403', baseCtx);
    expect(result[0]?.cause).toBe('diagnostics.cause.keyInvalid');
  });

  it('maps 402 to balanceEmpty with addCredits fix', () => {
    const result = diagnose('402', baseCtx);
    expect(result[0]?.cause).toBe('diagnostics.cause.balanceEmpty');
    expect(result[0]?.suggestedFix?.label).toBe('diagnostics.fix.addCredits');
    expect(result[0]?.suggestedFix?.externalUrl).toBe(
      'https://platform.openai.com/settings/organization/billing',
    );
  });

  it('402 returns provider-specific billing URL for anthropic', () => {
    const result = diagnose('402', { ...baseCtx, provider: 'anthropic' });
    expect(result[0]?.suggestedFix?.externalUrl).toBe(
      'https://console.anthropic.com/settings/billing',
    );
  });

  it('402 returns provider-specific billing URL for openrouter', () => {
    const result = diagnose('402', { ...baseCtx, provider: 'openrouter' });
    expect(result[0]?.suggestedFix?.externalUrl).toBe('https://openrouter.ai/settings/credits');
  });

  it('402 returns generic message (no URL) for unknown provider', () => {
    const result = diagnose('402', { ...baseCtx, provider: 'mystery-provider' });
    expect(result[0]?.suggestedFix?.label).toBe('diagnostics.fix.addCreditsGeneric');
    expect(result[0]?.suggestedFix?.externalUrl).toBeUndefined();
  });

  it('maps 404 to missingV1 with a baseUrl transform', () => {
    const result = diagnose('404', baseCtx);
    expect(result[0]?.cause).toBe('diagnostics.cause.missingV1');
    const fix = result[0]?.suggestedFix;
    expect(fix?.baseUrlTransform).toBeDefined();
    expect(fix?.baseUrlTransform?.('https://api.example.com')).toBe('https://api.example.com/v1');
  });

  it('404 transform is idempotent when /v1 already present', () => {
    const result = diagnose('404', { ...baseCtx, baseUrl: 'https://api.example.com/v1' });
    const transform = result[0]?.suggestedFix?.baseUrlTransform;
    expect(transform?.('https://api.example.com/v1')).toBe('https://api.example.com/v1');
  });

  it('maps 429 to rateLimit with waitAndRetry fix', () => {
    const result = diagnose('429', baseCtx);
    expect(result[0]?.cause).toBe('diagnostics.cause.rateLimit');
    expect(result[0]?.suggestedFix?.label).toBe('diagnostics.fix.waitAndRetry');
  });

  it('maps ECONNREFUSED to hostUnreachable', () => {
    const result = diagnose('ECONNREFUSED', baseCtx);
    expect(result[0]?.cause).toBe('diagnostics.cause.hostUnreachable');
    expect(result[0]?.suggestedFix?.label).toBe('diagnostics.fix.checkNetwork');
  });

  it('maps ETIMEDOUT to timedOut', () => {
    const result = diagnose('ETIMEDOUT', baseCtx);
    expect(result[0]?.cause).toBe('diagnostics.cause.timedOut');
    expect(result[0]?.suggestedFix?.label).toBe('diagnostics.fix.checkVpn');
  });

  it('maps CORS to corsError with reportBug fix', () => {
    const result = diagnose('CORS', baseCtx);
    expect(result[0]?.cause).toBe('diagnostics.cause.corsError');
    expect(result[0]?.suggestedFix?.label).toBe('diagnostics.fix.reportBug');
  });

  it('maps SSL to sslError with disableTls fix', () => {
    const result = diagnose('SSL', baseCtx);
    expect(result[0]?.cause).toBe('diagnostics.cause.sslError');
    expect(result[0]?.suggestedFix?.label).toBe('diagnostics.fix.disableTls');
  });

  it('maps unknown codes to generic unknown cause', () => {
    const result = diagnose('SOME_UNKNOWN_CODE', baseCtx);
    expect(result[0]?.cause).toBe('diagnostics.cause.unknown');
    expect(result[0]?.suggestedFix).toBeUndefined();
  });

  it('all hypothesis objects have at least a cause string', () => {
    const codes = ['401', '402', '403', '404', '429', 'ECONNREFUSED', 'ETIMEDOUT', 'NETWORK'];
    for (const code of codes) {
      const results = diagnose(code, baseCtx);
      expect(results.length).toBeGreaterThan(0);
      for (const h of results) {
        expect(typeof h.cause).toBe('string');
        expect(h.cause.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('diagnoseGenerateFailure', () => {
  const ctx = { provider: 'openai', baseUrl: 'https://relay.example.com' };

  it('maps 404 to missingV1 with an /v1 baseUrl transform', () => {
    const result = diagnoseGenerateFailure({ ...ctx, status: 404 });
    expect(result[0]?.cause).toBe('diagnostics.cause.missingV1');
    expect(result[0]?.suggestedFix?.baseUrlTransform?.('https://relay.example.com')).toBe(
      'https://relay.example.com/v1',
    );
  });

  it('maps a "404 page not found" message with no status to missingV1', () => {
    // The Win11 gateway (#130) surfaces this as a plain message body,
    // sometimes without any HTTP metadata attached to the error. Pattern
    // matching on the message is the only way to recognise it.
    const result = diagnoseGenerateFailure({
      ...ctx,
      message: '404 page not found',
    });
    expect(result[0]?.cause).toBe('diagnostics.cause.missingV1');
    expect(result[0]?.suggestedFix?.baseUrlTransform).toBeDefined();
  });

  it('maps 401 to keyInvalid hypothesis', () => {
    const result = diagnoseGenerateFailure({ ...ctx, status: 401 });
    expect(result[0]?.cause).toBe('diagnostics.cause.keyInvalid');
  });

  it('maps 403 to keyInvalid hypothesis', () => {
    const result = diagnoseGenerateFailure({ ...ctx, status: 403 });
    expect(result[0]?.cause).toBe('diagnostics.cause.keyInvalid');
  });

  it('maps 500 with "not implemented" body to gatewayIncompatible', () => {
    const result = diagnoseGenerateFailure({
      ...ctx,
      status: 500,
      message: 'upstream: not implemented',
    });
    expect(result[0]?.cause).toBe('diagnostics.cause.gatewayIncompatible');
    expect(result[0]?.suggestedFix?.label).toBe('diagnostics.fix.switchWire');
  });

  it('maps 502 with "404 page not found" body to gatewayIncompatible', () => {
    // Third-party gateways sometimes wrap a 404 inside a 5xx envelope.
    const result = diagnoseGenerateFailure({
      ...ctx,
      status: 502,
      message: 'backend returned 404 page not found',
    });
    expect(result[0]?.cause).toBe('diagnostics.cause.gatewayIncompatible');
  });

  it('maps generic 503 to serverError', () => {
    const result = diagnoseGenerateFailure({
      ...ctx,
      status: 503,
      message: 'service unavailable',
    });
    expect(result[0]?.cause).toBe('diagnostics.cause.serverError');
    expect(result[0]?.suggestedFix?.label).toBe('diagnostics.fix.waitAndRetry');
  });

  it('maps 400 with "instructions are required" body to openaiResponsesMisconfigured', () => {
    const result = diagnoseGenerateFailure({
      ...ctx,
      status: 400,
      message: 'Invalid request: instructions are required',
    });
    expect(result[0]?.cause).toBe('diagnostics.cause.openaiResponsesMisconfigured');
    expect(result[0]?.suggestedFix?.label).toBe('diagnostics.fix.switchWire');
  });

  it('maps 429 to rateLimit', () => {
    const result = diagnoseGenerateFailure({ ...ctx, status: 429 });
    expect(result[0]?.cause).toBe('diagnostics.cause.rateLimit');
  });

  it('falls back to unknown when nothing matches', () => {
    const result = diagnoseGenerateFailure({ ...ctx, message: 'something odd' });
    expect(result[0]?.cause).toBe('diagnostics.cause.unknown');
  });
});
