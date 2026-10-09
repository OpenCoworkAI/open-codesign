import { describe, expect, it } from 'vitest';
import { connectionFailureText } from './connection-failure-text';

describe('connectionFailureText', () => {
  const translate = (key: string) => `t:${key}`;

  it('translates a LiteLLM hint key ahead of the generic hint', () => {
    expect(
      connectionFailureText(translate, {
        hintKey: 'settings.providers.litellm.diagnostics.auth',
        hint: 'API key 错误或权限不足',
        message: 'HTTP 401',
      }),
    ).toBe('t:settings.providers.litellm.diagnostics.auth');
  });

  it('falls back to the existing hint, then the message', () => {
    expect(connectionFailureText(translate, { hint: 'API key 错误或权限不足' })).toBe(
      'API key 错误或权限不足',
    );
    expect(connectionFailureText(translate, { message: 'HTTP 500' })).toBe('HTTP 500');
  });
});
