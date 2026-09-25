import { describe, expect, it } from 'vitest';
import {
  SaveWebSearchSettingsInput,
  WEB_SEARCH_SETTINGS_CHANNELS,
  WebSearchSettingsState,
  WebSearchTestResult,
} from './web-search-settings';

describe('web search Settings IPC contracts', () => {
  it('versions the channels without adding fields to the agreed wire shapes', () => {
    expect(WEB_SEARCH_SETTINGS_CHANNELS).toEqual({
      get: 'settings:v1:get-web-search',
      save: 'settings:v1:save-web-search',
      test: 'settings:v1:test-web-search',
    });
    expect(WebSearchSettingsState.parse({ enabled: false, hasKey: true })).toEqual({
      enabled: false,
      hasKey: true,
    });
    expect(
      WebSearchSettingsState.safeParse({ enabled: true, hasKey: true, apiKey: 'secret' }).success,
    ).toBe(false);
  });

  it('preserves absent keys and requires explicit clearing', () => {
    expect(SaveWebSearchSettingsInput.parse({ enabled: false })).toEqual({ enabled: false });
    expect(SaveWebSearchSettingsInput.parse({ clearKey: true })).toEqual({ clearKey: true });
    expect(SaveWebSearchSettingsInput.parse({ clearKey: false })).toEqual({ clearKey: false });
    expect(SaveWebSearchSettingsInput.parse({})).toEqual({});
    expect(SaveWebSearchSettingsInput.parse({ apiKey: '  tvly-fixture  ' })).toEqual({
      apiKey: 'tvly-fixture',
    });
  });

  it.each([
    { apiKey: '' },
    { apiKey: '  ' },
    { apiKey: 'key with spaces' },
    { apiKey: 'key\nheader' },
    { apiKey: 'key\u0000' },
    { apiKey: '非ASCII' },
    { apiKey: 'x'.repeat(4097) },
    { apiKey: 'key', clearKey: true },
    { enabled: 'true' },
    { clearKey: 'true' },
    { provider: 'another' },
  ])('rejects invalid or ambiguous saves %#', (input) => {
    expect(SaveWebSearchSettingsInput.safeParse(input).success).toBe(false);
  });

  it('permits only sanitized test statuses and optional HTTP status', () => {
    for (const status of WebSearchTestResult.shape.status.options) {
      expect(WebSearchTestResult.parse({ status })).toEqual({ status });
    }
    expect(WebSearchTestResult.parse({ status: 'invalid-key', httpStatus: 401 })).toEqual({
      status: 'invalid-key',
      httpStatus: 401,
    });
    for (const result of [
      { status: 'raw error' },
      { status: 'ok', message: 'secret' },
      { status: 'ok', httpStatus: 999 },
      { status: 'ok', httpStatus: 200.5 },
    ]) {
      expect(WebSearchTestResult.safeParse(result).success).toBe(false);
    }
  });
});
