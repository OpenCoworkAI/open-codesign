import { describe, expect, it } from 'vitest';
import {
  isLiteLlmConnectionTarget,
  LITELLM_CONNECTION_HINT_KEYS,
  liteLlmEndpointPreset,
  liteLlmHintKeyForHttpStatus,
  liteLlmHintKeyForTransportError,
} from './litellm-hints';

describe('isLiteLlmConnectionTarget', () => {
  it('matches the preset id, a LiteLLM name or id, and a LiteLLM host or path', () => {
    expect(isLiteLlmConnectionTarget({ presetId: 'litellm' })).toBe(true);
    expect(
      isLiteLlmConnectionTarget({
        name: 'LiteLLM Gateway',
        baseUrl: 'https://llm.example/v1',
      }),
    ).toBe(true);
    expect(
      isLiteLlmConnectionTarget({
        providerId: 'custom-litellm-gateway-ab12',
        baseUrl: 'https://llm.example/v1',
      }),
    ).toBe(true);
    expect(isLiteLlmConnectionTarget({ baseUrl: 'https://litellm.example/v1' })).toBe(true);
    expect(isLiteLlmConnectionTarget({ baseUrl: 'https://gateway.example/litellm/v1' })).toBe(true);
  });

  it('does not treat other gateways as LiteLLM, including loopback port 4000', () => {
    expect(
      isLiteLlmConnectionTarget({
        name: 'one-api',
        providerId: 'custom-one-api',
        baseUrl: 'http://localhost:3000/v1',
      }),
    ).toBe(false);
    expect(isLiteLlmConnectionTarget({ baseUrl: 'https://api.openai.com/v1' })).toBe(false);
    expect(isLiteLlmConnectionTarget({ baseUrl: 'http://localhost:4000/v1' })).toBe(false);
    expect(isLiteLlmConnectionTarget({ baseUrl: 'http://127.0.0.1:4000' })).toBe(false);
    expect(isLiteLlmConnectionTarget({ baseUrl: 'http://[::1]:4000/v1' })).toBe(false);
    expect(isLiteLlmConnectionTarget({ baseUrl: 'https://example.com/v1?gateway=litellm' })).toBe(
      false,
    );
    expect(isLiteLlmConnectionTarget({ baseUrl: 'not a url' })).toBe(false);
  });

  it('sends presetId only for a LiteLLM target', () => {
    expect(
      liteLlmEndpointPreset({ presetId: 'litellm', baseUrl: 'https://llm.example/v1' }),
    ).toEqual({ presetId: 'litellm' });
    expect(liteLlmEndpointPreset({ name: 'Other', baseUrl: 'https://api.example/v1' })).toEqual({});
  });
});

describe('LiteLLM connection hint keys', () => {
  it('maps auth and missing-route statuses', () => {
    expect(liteLlmHintKeyForHttpStatus(401)).toBe(LITELLM_CONNECTION_HINT_KEYS.auth);
    expect(liteLlmHintKeyForHttpStatus(403)).toBe(LITELLM_CONNECTION_HINT_KEYS.auth);
    expect(liteLlmHintKeyForHttpStatus(404)).toBe(LITELLM_CONNECTION_HINT_KEYS.notFound);
    expect(liteLlmHintKeyForHttpStatus(404, 'https://llm.example/v1')).toBe(
      LITELLM_CONNECTION_HINT_KEYS.notFound,
    );
    expect(liteLlmHintKeyForHttpStatus(404, 'http://localhost:4000/v1')).toBe(
      LITELLM_CONNECTION_HINT_KEYS.notFoundLocal,
    );
    expect(liteLlmHintKeyForHttpStatus(404, 'http://127.0.0.1:4000')).toBe(
      LITELLM_CONNECTION_HINT_KEYS.notFoundLocal,
    );
    expect(liteLlmHintKeyForHttpStatus(404, 'http://[::1]:8080/v1')).toBe(
      LITELLM_CONNECTION_HINT_KEYS.notFoundLocal,
    );
    expect(liteLlmHintKeyForHttpStatus(404, 'http://192.168.1.8:4000/v1')).toBe(
      LITELLM_CONNECTION_HINT_KEYS.notFound,
    );
    expect(liteLlmHintKeyForHttpStatus(500)).toBeUndefined();
  });

  it('maps connection refused, including Node fetch cause errors', () => {
    expect(liteLlmHintKeyForTransportError(new Error('connect ECONNREFUSED 127.0.0.1:4000'))).toBe(
      LITELLM_CONNECTION_HINT_KEYS.unreachable,
    );
    const wrapped = new TypeError('fetch failed');
    Object.assign(wrapped, {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4000'), {
        code: 'ECONNREFUSED',
      }),
    });
    expect(liteLlmHintKeyForTransportError(wrapped)).toBe(LITELLM_CONNECTION_HINT_KEYS.unreachable);
    expect(liteLlmHintKeyForTransportError(new Error('getaddrinfo ENOTFOUND llm.example'))).toBe(
      undefined,
    );
  });
});
