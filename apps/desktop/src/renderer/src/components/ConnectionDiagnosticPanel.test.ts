import { describe, expect, it, vi } from 'vitest';

vi.mock('@open-codesign/i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('../store', () => ({
  useCodesignStore: () => vi.fn(),
}));

import {
  isAbsoluteHttpUrl,
  shouldShowGatewayAllowlistHint,
  shouldShowLiteLLMHint,
} from './ConnectionDiagnosticPanel';

describe('isAbsoluteHttpUrl', () => {
  it('rejects an empty string so /v1 quick-fix cannot produce a bare "/v1"', () => {
    expect(isAbsoluteHttpUrl('')).toBe(false);
    expect(isAbsoluteHttpUrl('   ')).toBe(false);
  });

  it('rejects relative or scheme-less values', () => {
    expect(isAbsoluteHttpUrl('api.example.com')).toBe(false);
    expect(isAbsoluteHttpUrl('/v1')).toBe(false);
    expect(isAbsoluteHttpUrl('ftp://api.example.com')).toBe(false);
  });

  it('accepts http and https absolute URLs', () => {
    expect(isAbsoluteHttpUrl('https://api.example.com')).toBe(true);
    expect(isAbsoluteHttpUrl('http://localhost:8080')).toBe(true);
    expect(isAbsoluteHttpUrl('  https://api.example.com  ')).toBe(true);
  });
});

describe('shouldShowGatewayAllowlistHint', () => {
  it('shows the hint for 400-class compatibility failures on third-party gateways', () => {
    expect(shouldShowGatewayAllowlistHint('400', 'https://relay.example.com/v1', undefined)).toBe(
      true,
    );
    expect(
      shouldShowGatewayAllowlistHint(
        '403',
        'https://relay.example.com/v1',
        'https://relay.example.com/v1/chat/completions',
      ),
    ).toBe(true);
    expect(shouldShowGatewayAllowlistHint('PARSE', 'https://relay.example.com/v1')).toBe(true);
  });

  it('suppresses the hint for official providers and localhost proxies', () => {
    expect(shouldShowGatewayAllowlistHint('400', 'https://api.openai.com/v1')).toBe(false);
    expect(shouldShowGatewayAllowlistHint('403', 'https://api.anthropic.com')).toBe(false);
    expect(shouldShowGatewayAllowlistHint('400', 'http://127.0.0.1:8317')).toBe(false);
  });

  it('suppresses the hint for unrelated error classes', () => {
    expect(shouldShowGatewayAllowlistHint('404', 'https://relay.example.com/v1')).toBe(false);
    expect(shouldShowGatewayAllowlistHint('429', 'https://relay.example.com/v1')).toBe(false);
    expect(shouldShowGatewayAllowlistHint('ECONNREFUSED', 'https://relay.example.com/v1')).toBe(
      false,
    );
  });
});

describe('shouldShowLiteLLMHint', () => {
  it('shows LiteLLM help for the first-class preset and default listen address', () => {
    expect(
      shouldShowLiteLLMHint('custom-litellm-gateway-ab12', 'https://relay.example.com/v1'),
    ).toBe(true);
    expect(shouldShowLiteLLMHint('openai', 'http://localhost:4000/v1')).toBe(true);
  });

  it('hides LiteLLM help for unrelated providers', () => {
    expect(shouldShowLiteLLMHint('openai', 'https://api.openai.com/v1')).toBe(false);
    expect(shouldShowLiteLLMHint('cli-proxy-api', 'http://127.0.0.1:8317')).toBe(false);
  });
});
