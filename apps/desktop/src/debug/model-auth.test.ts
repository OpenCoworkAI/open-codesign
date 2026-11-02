import { describe, expect, it } from 'vitest';
import { projectCodexLogin } from './model-auth';

function login(exp = 7200) {
  return JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`,
      refresh_token: 'private-refresh',
      id_token: 'private-id',
    },
    extra: 'unrelated-private-data',
  });
}
describe('explicit current-login snapshot', () => {
  it('projects the existing token format without unrelated account metadata', () => {
    const projected = projectCodexLogin(login(), 1000);
    expect(projected).toMatchObject({
      schemaVersion: 1,
      expiresAt: 7200000,
      updatedAt: 1000,
      accountId: null,
      email: null,
    });
    expect(JSON.stringify(projected)).not.toContain('unrelated-private-data');
  });
  it('rejects an expired or near-expiry login instead of refreshing it', () => {
    expect(() => projectCodexLogin(login(300), 1000)).toThrow('BACKGROUND_MODEL_AUTH_EXPIRED');
  });
  it.each([
    'private-refresh',
    '{}',
    '{"auth_mode":"chatgpt","tokens":{}}',
  ])('reports malformed credentials without their contents', (raw) => {
    expect(() => projectCodexLogin(raw)).toThrow('BACKGROUND_MODEL_AUTH_INVALID');
  });
});
