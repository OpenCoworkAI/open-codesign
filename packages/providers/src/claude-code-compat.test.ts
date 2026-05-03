import { describe, expect, it } from 'vitest';
import {
  claudeCodeIdentityHeaders,
  isOfficialAnthropicBaseUrl,
  looksLikeClaudeOAuthToken,
  shouldForceClaudeCodeIdentity,
  withClaudeCodeIdentity,
} from './claude-code-compat';

describe('isOfficialAnthropicBaseUrl', () => {
  it('treats undefined / empty as official (default endpoint)', () => {
    expect(isOfficialAnthropicBaseUrl(undefined)).toBe(true);
    expect(isOfficialAnthropicBaseUrl('')).toBe(true);
  });
  it('recognizes api.anthropic.com', () => {
    expect(isOfficialAnthropicBaseUrl('https://api.anthropic.com')).toBe(true);
    expect(isOfficialAnthropicBaseUrl('https://api.anthropic.com/v1')).toBe(true);
  });
  it('recognizes anthropic.com subdomains', () => {
    expect(isOfficialAnthropicBaseUrl('https://foo.anthropic.com')).toBe(true);
  });
  it('returns false for third-party gateways', () => {
    expect(isOfficialAnthropicBaseUrl('https://sub2api.example.com')).toBe(false);
    expect(isOfficialAnthropicBaseUrl('https://open.bigmodel.cn/api/anthropic')).toBe(false);
    expect(isOfficialAnthropicBaseUrl('http://localhost:8080')).toBe(false);
  });
  it('returns false for unparseable URLs', () => {
    expect(isOfficialAnthropicBaseUrl('not a url')).toBe(false);
  });
  it('strips default ports so :443 / :80 still count as official', () => {
    // WHATWG URL already strips :443 from https:// and :80 from http://,
    // but cross-scheme typos (http://...:443) would otherwise leak the port
    // into host and misclassify the endpoint as custom.
    expect(isOfficialAnthropicBaseUrl('https://api.anthropic.com:443')).toBe(true);
    expect(isOfficialAnthropicBaseUrl('http://api.anthropic.com:443')).toBe(true);
    expect(isOfficialAnthropicBaseUrl('http://api.anthropic.com:80')).toBe(true);
  });
  it('preserves non-default ports as custom proxies', () => {
    // A user pointing at api.anthropic.com:8443 is running a local proxy,
    // not the canonical endpoint: inject CC identity headers.
    expect(isOfficialAnthropicBaseUrl('https://api.anthropic.com:8443')).toBe(false);
  });
});

describe('shouldForceClaudeCodeIdentity', () => {
  it('only triggers on anthropic wire', () => {
    expect(shouldForceClaudeCodeIdentity('anthropic', 'https://sub2api.example.com')).toBe(true);
    expect(shouldForceClaudeCodeIdentity('openai-chat', 'https://sub2api.example.com')).toBe(false);
    expect(shouldForceClaudeCodeIdentity('openai-responses', 'https://sub2api.example.com')).toBe(
      false,
    );
  });
  it('skips the official Anthropic endpoint', () => {
    expect(shouldForceClaudeCodeIdentity('anthropic', 'https://api.anthropic.com')).toBe(false);
    expect(shouldForceClaudeCodeIdentity('anthropic', undefined)).toBe(false);
  });
});

describe('claudeCodeIdentityHeaders', () => {
  it('emits claude-cli UA, x-app cli, and claude-code beta tag', () => {
    const h = claudeCodeIdentityHeaders();
    expect(h['user-agent']).toMatch(/^claude-cli\/\d+\.\d+\.\d+$/);
    expect(h['x-app']).toBe('cli');
    expect(h['anthropic-beta']).toContain('claude-code-20250219');
    expect(h['anthropic-beta']).toContain('oauth-2025-04-20');
  });
  it('covers every beta flag pi-ai would set, so optionsHeaders overwrite is lossless', () => {
    // Regression: if we drop flags pi-ai adds (e.g. interleaved-thinking for
    // non-adaptive reasoning models), overriding its anthropic-beta via
    // optionsHeaders silently disables those capabilities.
    const h = claudeCodeIdentityHeaders();
    expect(h['anthropic-beta']).toContain('fine-grained-tool-streaming-2025-05-14');
    expect(h['anthropic-beta']).toContain('interleaved-thinking-2025-05-14');
  });
});

describe('withClaudeCodeIdentity', () => {
  it('is a pass-through for official endpoints', () => {
    const result = withClaudeCodeIdentity('anthropic', 'https://api.anthropic.com', {
      'x-api-key': 'sk-ant-abc',
    });
    expect(result).toEqual({ 'x-api-key': 'sk-ant-abc' });
  });
  it('is a pass-through for non-anthropic wires', () => {
    const result = withClaudeCodeIdentity('openai-chat', 'https://proxy.example', {
      authorization: 'Bearer sk-x',
    });
    expect(result).toEqual({ authorization: 'Bearer sk-x' });
  });
  it('injects CC identity headers for custom anthropic endpoints', () => {
    const result = withClaudeCodeIdentity('anthropic', 'https://sub2api.example.com', {
      'x-api-key': 'opaque-token',
    });
    expect(result['user-agent']).toMatch(/^claude-cli\//);
    expect(result['x-app']).toBe('cli');
    expect(result['anthropic-beta']).toContain('claude-code-20250219');
    expect(result['x-api-key']).toBe('opaque-token');
  });
  it('lets caller override the injected UA', () => {
    const result = withClaudeCodeIdentity('anthropic', 'https://sub2api.example.com', {
      'x-api-key': 'opaque-token',
      'user-agent': 'my-custom/1.0',
    });
    expect(result['user-agent']).toBe('my-custom/1.0');
  });
  it('handles undefined extraHeaders', () => {
    const result = withClaudeCodeIdentity('anthropic', 'https://sub2api.example.com', undefined);
    expect(result['user-agent']).toMatch(/^claude-cli\//);
  });
});

describe('looksLikeClaudeOAuthToken', () => {
  it('matches pi-ai sk-ant-oat heuristic', () => {
    expect(looksLikeClaudeOAuthToken('sk-ant-oat-abc123')).toBe(true);
    expect(looksLikeClaudeOAuthToken('prefix-sk-ant-oat-embedded')).toBe(true);
  });
  it('rejects plain API keys', () => {
    expect(looksLikeClaudeOAuthToken('sk-ant-api03-xyz')).toBe(false);
    expect(looksLikeClaudeOAuthToken('opaque-sub2api-token')).toBe(false);
  });
});
