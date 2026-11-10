import { describe, expect, it } from 'vitest';
import { BUILTIN_PROVIDERS, type Config, hydrateConfig } from './config';
import { resolveWebSearchRoute } from './web-search-routing';
import { SaveWebSearchSettingsInput } from './web-search-settings';

function config(
  baseUrl: string,
  wire: 'openai-chat' | 'openai-responses' | 'anthropic' = 'openai-chat',
  model = 'test',
): Config {
  return hydrateConfig({
    version: 3,
    activeProvider: 'custom-id',
    activeModel: model,
    providers: { 'custom-id': { ...BUILTIN_PROVIDERS.openai, id: 'custom-id', baseUrl, wire } },
    secrets: { 'custom-id': { ciphertext: 'plain:fixture' } },
    webSearch: {
      enabled: true,
      backend: 'provider',
      maxCalls: 12,
      timeoutMs: 15000,
      maxChars: 10000,
    },
  });
}

describe('web search routing and configuration', () => {
  it.each([
    ['https://api.deepseek.com/v1', 'deepseek', 'https://api.deepseek.com/v1/tools/search'],
    ['https://api.moonshot.cn/v1', 'kimi', 'https://api.moonshot.cn/v1/tools/search_pro'],
    [
      'https://open.bigmodel.cn/api/paas/v4',
      'zhipu',
      'https://open.bigmodel.cn/api/paas/v4/web_search',
    ],
  ])('inherits the exact configured official service %s', (baseUrl, service, endpoint) => {
    expect(resolveWebSearchRoute(config(baseUrl))).toMatchObject({
      service,
      mode: 'search-api',
      endpoint,
      providerId: 'custom-id',
      reason: null,
    });
  });
  it.each([
    'https://api.deepseek.com.evil.test/v1',
    'http://api.deepseek.com/v1',
    'https://api.deepseek.com/proxy',
    'https://open.bigmodel.cn/api/coding/paas/v4',
    'https://gateway.example/v1',
    'https://user:password@api.deepseek.com/v1',
    'https://api.deepseek.com:444/v1',
  ])('rejects unsafe or unrelated endpoints %s', (baseUrl) => {
    expect(resolveWebSearchRoute(config(baseUrl))).toMatchObject({
      service: null,
      reason: 'unsupported-provider',
    });
  });
  it('keeps legacy settings on Tavily and uses auto for fresh settings', () => {
    const cfg = config('https://api.deepseek.com/v1');
    delete cfg.webSearch?.backend;
    cfg.secrets['tavily'] = { ciphertext: 'plain:tavily-fixture' };
    expect(resolveWebSearchRoute(cfg).service).toBe('tavily');
    delete cfg.webSearch;
    expect(resolveWebSearchRoute(cfg).service).toBe('deepseek');
  });
  it('auto falls back only at selection time; explicit provider never falls back', () => {
    const cfg = config('https://gateway.example/v1');
    cfg.secrets['tavily'] = { ciphertext: 'plain:tavily-fixture' };
    expect(resolveWebSearchRoute(cfg).service).toBeNull();
    if (cfg.webSearch) cfg.webSearch.backend = 'auto';
    expect(resolveWebSearchRoute(cfg).service).toBe('tavily');
  });
  it('requires stored provider credentials', () => {
    const cfg = config('https://api.deepseek.com/v1');
    cfg.secrets = {};
    expect(resolveWebSearchRoute(cfg)).toMatchObject({ service: null, reason: 'missing-key' });
  });

  it('auto selects Tavily when supplier credentials or native model support are unavailable', () => {
    const cfg = config('https://api.deepseek.com/v1');
    cfg.secrets = { tavily: { ciphertext: 'plain:fixture' } };
    if (cfg.webSearch) cfg.webSearch.backend = 'auto';
    expect(resolveWebSearchRoute(cfg).service).toBe('tavily');
    const native = config('https://api.openai.com/v1', 'openai-responses', 'unknown-model');
    native.secrets['tavily'] = { ciphertext: 'plain:fixture' };
    if (native.webSearch) Object.assign(native.webSearch, { backend: 'auto', nativeEnabled: true });
    expect(resolveWebSearchRoute(native).service).toBe('tavily');
  });
  it('gates native search by explicit opt-in, wire and known model', () => {
    const cfg = config('https://api.openai.com/v1', 'openai-responses', 'gpt-5.5');
    expect(resolveWebSearchRoute(cfg)).toMatchObject({ service: null, reason: 'native-disabled' });
    if (cfg.webSearch) cfg.webSearch.nativeEnabled = true;
    expect(resolveWebSearchRoute(cfg)).toMatchObject({ service: 'openai', mode: 'native-tool' });
    cfg.activeModel = 'unknown-future-model';
    expect(resolveWebSearchRoute(cfg)).toMatchObject({
      service: null,
      reason: 'unsupported-model',
    });
    const claude = config('https://api.anthropic.com', 'anthropic', 'claude-sonnet-4-6');
    if (claude.webSearch) claude.webSearch.nativeEnabled = true;
    expect(resolveWebSearchRoute(claude)).toMatchObject({
      service: 'anthropic',
      mode: 'native-tool',
    });
  });
  it('accepts new settings, validates native request bounds, and rejects credentials in state', () => {
    expect(
      SaveWebSearchSettingsInput.parse({
        backend: 'auto',
        nativeEnabled: true,
        maxNativeRequests: 12,
      }),
    ).toEqual({ backend: 'auto', nativeEnabled: true, maxNativeRequests: 12 });
    for (const maxNativeRequests of [0, 51, 1.5])
      expect(SaveWebSearchSettingsInput.safeParse({ maxNativeRequests }).success).toBe(false);
    expect(() => config('https://api.deepseek.com/v1')).not.toThrow();
  });
});
