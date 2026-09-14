import { describe, expect, it, vi } from 'vitest';

vi.mock('@open-codesign/i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('../store', () => ({
  useCodesignStore: () => vi.fn(),
}));

import type { ConnectionCapabilityReason } from '@open-codesign/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ConnectionDiagnosticPanel,
  isAbsoluteHttpUrl,
  selectConnectionHypotheses,
  shouldShowGatewayAllowlistHint,
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

describe('selectConnectionHypotheses', () => {
  const ctx = { provider: 'custom', baseUrl: 'https://gateway.example.com/v1' };

  it('prefers structured capability reasons over local error-code inference', () => {
    const reasons: ConnectionCapabilityReason[] = [
      {
        layer: 'wire-support',
        status: 'fail',
        category: 'wrong-wire',
        cause: 'diagnostics.cause.wireMismatchResponses',
        source: 'probe-only',
        suggestedWire: 'openai-chat',
      },
    ];
    const result = selectConnectionHypotheses('404', ctx, reasons);
    expect(result[0]?.cause).toBe('diagnostics.cause.wireMismatchResponses');
    expect(result[0]?.suggestedFix?.kind).toBe('switchWire');
    expect(result[0]?.suggestedFix?.wire).toBe('openai-chat');
  });

  it('falls back to diagnose(errorCode) when no reasons are provided', () => {
    const result = selectConnectionHypotheses('401', ctx);
    expect(result[0]?.cause).toBe('diagnostics.cause.keyInvalid');
  });
});

describe('ConnectionDiagnosticPanel structured reasons', () => {
  it('renders capability layers and probe-only note from IPC reasons', () => {
    const reasons: ConnectionCapabilityReason[] = [
      {
        layer: 'authentication',
        status: 'pass',
        category: 'auth',
        cause: 'diagnostics.cause.capabilityPass',
        source: 'shared-contract',
      },
      {
        layer: 'wire-support',
        status: 'fail',
        category: 'wrong-wire',
        cause: 'diagnostics.cause.wireMismatchResponses',
        source: 'probe-only',
        suggestedWire: 'openai-chat',
      },
    ];
    const html = renderToStaticMarkup(
      <ConnectionDiagnosticPanel
        errorCode="404"
        baseUrl="https://gateway.example.com/v1"
        provider="custom"
        reasons={reasons}
        compatibility="incompatible"
        onApplyFix={() => undefined}
        onTestAgain={() => undefined}
      />,
    );
    expect(html).toContain('diagnostics.layersHeading');
    expect(html).toContain('diagnostics.layer.wire-support');
    expect(html).toContain('diagnostics.cause.wireMismatchResponses');
    expect(html).toContain('diagnostics.probeOnlyNote');
  });
});
