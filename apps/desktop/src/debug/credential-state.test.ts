import { describe, expect, it } from 'vitest';
import { projectCredentialState } from './credential-state';

describe('Windows debug credential state', () => {
  it('projects only the DPAPI-wrapped encryption key', () => {
    const key = Buffer.from('DPAPIwrapped-test-key').toString('base64');
    expect(
      JSON.parse(
        projectCredentialState(
          JSON.stringify({
            os_crypt: { encrypted_key: key, other: 'private' },
            cookies: 'private',
          }),
        ),
      ),
    ).toEqual({ os_crypt: { encrypted_key: key } });
  });
  it.each([
    'private-sentinel',
    'null',
    '{}',
    '{"os_crypt":{"encrypted_key":"private-sentinel"}}',
  ])('rejects invalid state without echoing contents', (raw) => {
    expect(() => projectCredentialState(raw)).toThrow('BACKGROUND_MODEL_CREDENTIAL_STATE_INVALID');
    try {
      projectCredentialState(raw);
    } catch (error) {
      expect(String(error)).not.toContain('private-sentinel');
    }
  });
});
