import { describe, expect, it } from 'vitest';
import { diagnose } from './diagnostics';

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

  // Regression: Zhipu GLM (issue #179) — baseUrl is /api/paas/v4, /models 404
  // is because GLM does not expose /models, NOT because /v1 is missing.
  // Auto-suggesting "add /v1" would corrupt a correct baseUrl.
  it('404 skips missingV1 when baseUrl already has /v4 (GLM)', () => {
    const result = diagnose('404', {
      ...baseCtx,
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    });
    expect(result[0]?.cause).toBe('diagnostics.cause.unknown');
    expect(result[0]?.suggestedFix).toBeUndefined();
  });

  it('404 skips missingV1 when baseUrl already has /v1 (e.g. Cloudflare Workers AI)', () => {
    const result = diagnose('404', {
      ...baseCtx,
      baseUrl: 'https://gateway.ai.cloudflare.com/v1/account/foo/openai',
    });
    expect(result[0]?.cause).toBe('diagnostics.cause.unknown');
    expect(result[0]?.suggestedFix).toBeUndefined();
  });

  it('404 skips missingV1 when baseUrl already has /v1beta (AI Studio)', () => {
    const result = diagnose('404', {
      ...baseCtx,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    });
    expect(result[0]?.cause).toBe('diagnostics.cause.unknown');
    expect(result[0]?.suggestedFix).toBeUndefined();
  });

  it('404 still suggests missingV1 when baseUrl has NO version segment', () => {
    const result = diagnose('404', { ...baseCtx, baseUrl: 'https://api.example.com' });
    expect(result[0]?.cause).toBe('diagnostics.cause.missingV1');
    expect(result[0]?.suggestedFix?.label).toBe('diagnostics.fix.addV1');
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
