import { describe, expect, it } from 'vitest';
import { looksLikeGatewayMissingMessagesApi } from './gateway-compat';

describe('looksLikeGatewayMissingMessagesApi', () => {
  it('matches plain "not implemented"', () => {
    expect(looksLikeGatewayMissingMessagesApi(new Error('500 not implemented'))).toBe(true);
  });

  it('matches "Not Implemented" with different case and spacing', () => {
    expect(looksLikeGatewayMissingMessagesApi(new Error('Not  Implemented'))).toBe(true);
  });

  it('matches "Messages API not supported"', () => {
    expect(
      looksLikeGatewayMissingMessagesApi(new Error('Messages API not supported on this relay')),
    ).toBe(true);
  });

  it('matches "unsupported Messages API" phrasing', () => {
    expect(looksLikeGatewayMissingMessagesApi(new Error('unsupported messages api endpoint'))).toBe(
      true,
    );
  });

  it('matches bare 501 status code in text', () => {
    expect(looksLikeGatewayMissingMessagesApi(new Error('HTTP 501 from gateway'))).toBe(true);
  });

  it('ignores ordinary 500 messages that do not mention not-implemented', () => {
    expect(looksLikeGatewayMissingMessagesApi(new Error('500 internal server error'))).toBe(false);
  });

  it('handles non-Error inputs safely', () => {
    expect(looksLikeGatewayMissingMessagesApi(undefined)).toBe(false);
    expect(looksLikeGatewayMissingMessagesApi(null)).toBe(false);
    expect(looksLikeGatewayMissingMessagesApi('not implemented')).toBe(true);
  });
});
