import { describe, expect, it } from 'vitest';
import {
  classifyGatewayIncompatibility,
  isOfficialOpenAIBaseUrl,
  looksLikeGatewayDeveloperRoleRejection,
  looksLikeGatewayMissingMessagesApi,
  looksLikeGatewayReasoningRejection,
  looksLikeGatewayResponsesWireMismatch,
  openaiChatShouldProbeDeveloperRole,
} from './gateway-compat';

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

describe('gateway capability classifiers', () => {
  it('detects developer-role rejection', () => {
    expect(
      looksLikeGatewayDeveloperRoleRejection(
        new Error('messages.0.role should be system, user, assistant or tool; input "developer"'),
      ),
    ).toBe(true);
    expect(looksLikeGatewayDeveloperRoleRejection(new Error('model_not_found'))).toBe(false);
  });

  it('detects reasoning and responses-shape mismatches', () => {
    expect(
      looksLikeGatewayReasoningRejection(
        new Error('The `reasoning_content` in the thinking mode must be passed back'),
      ),
    ).toBe(true);
    expect(
      looksLikeGatewayResponsesWireMismatch(new Error('Unknown parameter: instructions')),
    ).toBe(true);
  });

  it('classifies 401 as authentication and 404 as endpoint-shape', () => {
    expect(classifyGatewayIncompatibility(401, 'unauthorized')?.layer).toBe('authentication');
    expect(classifyGatewayIncompatibility(404, 'missing')?.layer).toBe('endpoint-shape');
    expect(
      classifyGatewayIncompatibility(400, 'Unknown parameter: instructions', 'openai-responses')
        ?.layer,
    ).toBe('wire-support');
  });

  it('probes developer role only on third-party openai-chat endpoints', () => {
    expect(isOfficialOpenAIBaseUrl('https://api.openai.com/v1')).toBe(true);
    expect(openaiChatShouldProbeDeveloperRole('openai-chat', 'https://api.openai.com/v1')).toBe(
      false,
    );
    expect(
      openaiChatShouldProbeDeveloperRole('openai-chat', 'https://open.bigmodel.cn/api/paas/v4'),
    ).toBe(true);
    expect(
      openaiChatShouldProbeDeveloperRole('openai-responses', 'https://gateway.example/v1'),
    ).toBe(false);
  });
});
