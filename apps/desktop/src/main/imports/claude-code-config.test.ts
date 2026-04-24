import { describe, expect, it } from 'vitest';
import {
  claudeCodeSettingsPath,
  PARSE_REASON_NOT_JSON_OBJECT,
  parseClaudeCodeSettings,
} from './claude-code-config';

describe('parseClaudeCodeSettings', () => {
  it('creates a single anthropic ProviderEntry from ANTHROPIC_BASE_URL + MODEL', () => {
    const json = JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: 'https://gateway.example.com',
        ANTHROPIC_MODEL: 'claude-opus-4-1',
        ANTHROPIC_AUTH_TOKEN: 'sk-ant-test',
      },
    });
    const out = parseClaudeCodeSettings(json, { env: {} });
    expect(out.provider?.id).toBe('claude-code-imported');
    expect(out.provider?.wire).toBe('anthropic');
    expect(out.provider?.baseUrl).toBe('https://gateway.example.com');
    expect(out.provider?.defaultModel).toBe('claude-opus-4-1');
    expect(out.apiKey).toBe('sk-ant-test');
    expect(out.apiKeySource).toBe('settings-json');
    expect(out.userType).toBe('has-api-key');
  });

  it('accepts ANTHROPIC_API_KEY from settings.json as a fallback to ANTHROPIC_AUTH_TOKEN', () => {
    const json = JSON.stringify({ env: { ANTHROPIC_API_KEY: 'k' } });
    const out = parseClaudeCodeSettings(json, { env: {} });
    expect(out.apiKey).toBe('k');
    expect(out.apiKeySource).toBe('settings-json');
    expect(out.userType).toBe('has-api-key');
  });

  it('falls back to shell env ANTHROPIC_AUTH_TOKEN when settings.json has no key', () => {
    const json = JSON.stringify({ env: {} });
    const out = parseClaudeCodeSettings(json, { env: { ANTHROPIC_AUTH_TOKEN: 'shell-key' } });
    expect(out.apiKey).toBe('shell-key');
    expect(out.apiKeySource).toBe('shell-env');
    expect(out.userType).toBe('has-api-key');
  });

  it('attaches envKey: ANTHROPIC_AUTH_TOKEN on the provider for runtime fallback', () => {
    const json = JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'k' } });
    const out = parseClaudeCodeSettings(json, { env: {} });
    expect(out.provider?.envKey).toBe('ANTHROPIC_AUTH_TOKEN');
  });

  it('classifies no-key + localhost baseUrl as local-proxy', () => {
    const json = JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://localhost:8082' } });
    const out = parseClaudeCodeSettings(json, { env: {} });
    expect(out.userType).toBe('local-proxy');
    expect(out.apiKey).toBeNull();
    expect(out.provider?.baseUrl).toBe('http://localhost:8082');
  });

  it('classifies no-key + custom remote baseUrl as remote-gateway', () => {
    const json = JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://api.custom.example.com' } });
    const out = parseClaudeCodeSettings(json, { env: {} });
    expect(out.userType).toBe('remote-gateway');
    expect(out.apiKey).toBeNull();
  });

  it('classifies no-key + OAuth evidence + default baseUrl as oauth-only and returns no provider', () => {
    const json = JSON.stringify({ env: {} });
    const out = parseClaudeCodeSettings(json, { env: {}, oauthEvidence: true });
    expect(out.userType).toBe('oauth-only');
    expect(out.provider).toBeNull();
    expect(out.hasOAuthEvidence).toBe(true);
  });

  it('classifies no-key + no OAuth evidence + default baseUrl as no-config', () => {
    const json = JSON.stringify({ env: {} });
    const out = parseClaudeCodeSettings(json, { env: {}, oauthEvidence: false });
    expect(out.userType).toBe('no-config');
    expect(out.provider).toBeNull();
  });

  it('surfaces apiKeyHelper presence as a warning without executing it', () => {
    const json = JSON.stringify({
      env: { ANTHROPIC_BASE_URL: 'http://localhost:8082' },
      apiKeyHelper: 'security find-generic-password -s anthropic -w',
    });
    const out = parseClaudeCodeSettings(json, { env: {} });
    expect(out.warnings.join(' ')).toMatch(/apiKeyHelper/);
    expect(out.apiKey).toBeNull();
  });

  it('ignores an empty ANTHROPIC_AUTH_TOKEN string and falls through to env', () => {
    const json = JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: '   ' } });
    const out = parseClaudeCodeSettings(json, { env: { ANTHROPIC_API_KEY: 'real' } });
    expect(out.apiKey).toBe('real');
    expect(out.apiKeySource).toBe('shell-env');
  });

  it('returns a raw parser error message on non-JSON input', () => {
    const out = parseClaudeCodeSettings('{ bad json', { env: {} });
    expect(out.provider).toBeNull();
    expect(out.userType).toBe('parse-error');
    // warnings[0] is the raw technical reason only; the localized prefix
    // is owned by the banner template so it can't double-up across locales.
    expect(out.warnings[0]).not.toMatch(/Claude Code settings\.json/);
    expect(out.warnings[0]).toMatch(/json|token|expected/i);
  });

  it('marks malformed JSON as parse-error regardless of OAuth evidence', () => {
    const out = parseClaudeCodeSettings('{ bad json', { env: {}, oauthEvidence: true });
    expect(out.userType).toBe('parse-error');
  });

  it('marks non-object settings (e.g. an array) as parse-error with a localizable sentinel', () => {
    const out = parseClaudeCodeSettings('[]', { env: {} });
    expect(out.userType).toBe('parse-error');
    // Use a sentinel rather than a free-form English string so the banner
    // can localize it instead of leaking "not a JSON object" into zh copy.
    expect(out.warnings[0]).toBe(PARSE_REASON_NOT_JSON_OBJECT);
  });

  it('threads settingsPath through option into every return branch', () => {
    const customPath = '/custom/home/.claude/settings.json';
    const valid = parseClaudeCodeSettings(JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'k' } }), {
      env: {},
      settingsPath: customPath,
    });
    expect(valid.settingsPath).toBe(customPath);
    const parseErr = parseClaudeCodeSettings('{bad', { env: {}, settingsPath: customPath });
    expect(parseErr.settingsPath).toBe(customPath);
    const oauth = parseClaudeCodeSettings(JSON.stringify({ env: {} }), {
      env: {},
      oauthEvidence: true,
      settingsPath: customPath,
    });
    expect(oauth.settingsPath).toBe(customPath);
  });

  it('defaults settingsPath to the canonical home-relative location', () => {
    const out = parseClaudeCodeSettings(JSON.stringify({ env: {} }), { env: {} });
    // Compare against the resolver rather than a literal regex so the test
    // passes on Windows (backslash-separated paths) too.
    expect(out.settingsPath).toBe(claudeCodeSettingsPath());
  });
});
