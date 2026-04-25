import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_BASE,
  CLIENT_ID,
  buildAuthorizeUrl,
  decodeJwtClaims,
  exchangeCode,
  extractAccountId,
  generatePkce,
  refreshTokens,
} from './oauth';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function b64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function makeJwt(payload: unknown): string {
  const header = b64urlJson({ alg: 'none', typ: 'JWT' });
  const body = b64urlJson(payload);
  return `${header}.${body}.sig`;
}

describe('generatePkce', () => {
  it('produces a base64url verifier of at least 43 chars', () => {
    const { verifier } = generatePkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('challenge equals base64url(sha256(verifier))', () => {
    const { verifier, challenge } = generatePkce();
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);
  });
});

describe('buildAuthorizeUrl', () => {
  it('contains all required params and default originator', () => {
    const url = buildAuthorizeUrl({
      redirectUri: 'http://localhost:1455/auth/callback',
      state: 'state-xyz',
      challenge: 'chal-abc',
    });
    expect(url.startsWith(`${AUTH_BASE}/oauth/authorize?`)).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get('response_type')).toBe('code');
    expect(params.get('client_id')).toBe(CLIENT_ID);
    expect(params.get('redirect_uri')).toBe('http://localhost:1455/auth/callback');
    expect(params.get('scope')).toBe('openid profile email offline_access');
    expect(params.get('code_challenge')).toBe('chal-abc');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('state')).toBe('state-xyz');
    expect(params.get('codex_cli_simplified_flow')).toBe('true');
    expect(params.get('originator')).toBe('open-codesign');
    expect(params.get('id_token_add_organizations')).toBe('true');
  });

  it('respects custom originator', () => {
    const url = buildAuthorizeUrl({
      redirectUri: 'http://localhost:1455/auth/callback',
      state: 's',
      challenge: 'c',
      originator: 'my-custom-app',
    });
    expect(new URL(url).searchParams.get('originator')).toBe('my-custom-app');
  });
});

describe('decodeJwtClaims', () => {
  it('returns the claims object for a valid JWT', () => {
    const jwt = makeJwt({ email: 'a@b.com', sub: 'user_1' });
    expect(decodeJwtClaims(jwt)).toEqual({ email: 'a@b.com', sub: 'user_1' });
  });

  it('returns null for a malformed JWT with no dots', () => {
    expect(decodeJwtClaims('not-a-jwt')).toBeNull();
  });

  it('returns null when the payload segment is not valid base64/JSON', () => {
    expect(decodeJwtClaims('aaa.!!!notbase64!!!.bbb')).toBeNull();
  });

  it('returns null when the payload decodes to a non-object JSON value', () => {
    const arr = `h.${Buffer.from(JSON.stringify([1, 2, 3])).toString('base64url')}.s`;
    const str = `h.${Buffer.from(JSON.stringify('hello')).toString('base64url')}.s`;
    expect(decodeJwtClaims(arr)).toBeNull();
    expect(decodeJwtClaims(str)).toBeNull();
  });
});

describe('extractAccountId', () => {
  it('reads top-level chatgpt_account_id', () => {
    const jwt = makeJwt({ chatgpt_account_id: 'acct_top' });
    expect(extractAccountId(jwt)).toBe('acct_top');
  });

  it('falls back to https://api.openai.com/auth claim', () => {
    const jwt = makeJwt({
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct_nested' },
    });
    expect(extractAccountId(jwt)).toBe('acct_nested');
  });

  it('falls back to organizations[0].id', () => {
    const jwt = makeJwt({ organizations: [{ id: 'org_first' }, { id: 'org_second' }] });
    expect(extractAccountId(jwt)).toBe('org_first');
  });

  it('returns null when no claim matches', () => {
    const jwt = makeJwt({ sub: 'user_123' });
    expect(extractAccountId(jwt)).toBeNull();
  });

  it('returns null for a malformed JWT', () => {
    expect(extractAccountId('not-a-jwt')).toBeNull();
    expect(extractAccountId('only.two')).not.toBe(undefined);
    expect(extractAccountId('aaa.!!!notbase64!!!.bbb')).toBeNull();
  });
});

describe('exchangeCode', () => {
  it('POSTs form-encoded body without state and parses response', async () => {
    vi.useFakeTimers();
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);

    const idToken = makeJwt({ chatgpt_account_id: 'acct_xyz' });
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(
        JSON.stringify({
          access_token: 'at',
          refresh_token: 'rt',
          id_token: idToken,
          expires_in: 3600,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await exchangeCode('thecode', 'theverifier', 'http://localhost:1455/cb');

    expect(capturedUrl).toBe('https://auth.openai.com/oauth/token');
    expect(capturedInit?.method).toBe('POST');
    const headers = (capturedInit?.headers ?? {}) as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    const body = new URLSearchParams(capturedInit?.body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('thecode');
    expect(body.get('redirect_uri')).toBe('http://localhost:1455/cb');
    expect(body.get('client_id')).toBe(CLIENT_ID);
    expect(body.get('code_verifier')).toBe('theverifier');
    expect(body.has('state')).toBe(false);

    expect(result).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      idToken,
      expiresAt: now + 3600 * 1000,
      accountId: 'acct_xyz',
    });
  });

  it('throws with status and body on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad thing', { status: 400 })),
    );
    await expect(exchangeCode('c', 'v', 'r')).rejects.toThrow(/400.*bad thing/);
  });

  it('exposes structured OpenAI OAuth error details on exchange failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: 'unsupported_country_region_territory',
                message: 'Country, region, or territory not supported',
                param: null,
                type: 'request_forbidden',
              },
            }),
            { status: 403, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    await expect(exchangeCode('c', 'v', 'r')).rejects.toMatchObject({
      name: 'CodexOAuthTokenError',
      status: 403,
      oauthErrorCode: 'unsupported_country_region_territory',
      upstreamMessage: 'Country, region, or territory not supported',
    });
  });
});

describe('refreshTokens', () => {
  it('POSTs refresh body with client_id + refresh_token', async () => {
    const idToken = makeJwt({ chatgpt_account_id: 'acct_rt' });
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(
          JSON.stringify({
            access_token: 'at2',
            refresh_token: 'rt2',
            id_token: idToken,
            expires_in: 120,
          }),
          { status: 200 },
        );
      }),
    );

    const result = await refreshTokens('old-rt');
    const body = new URLSearchParams(capturedInit?.body as string);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('client_id')).toBe(CLIENT_ID);
    expect(body.get('refresh_token')).toBe('old-rt');

    expect(result.refreshToken).toBe('rt2');
    expect(result.accessToken).toBe('at2');
    expect(result.accountId).toBe('acct_rt');
  });

  it('falls back to input refresh_token when response omits one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ access_token: 'at2', id_token: '', expires_in: 60 }), {
            status: 200,
          }),
      ),
    );
    const result = await refreshTokens('keep-me');
    expect(result.refreshToken).toBe('keep-me');
  });

  it('throws on non-2xx refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 401 })),
    );
    await expect(refreshTokens('rt')).rejects.toThrow(/refresh failed: 401 nope/);
  });
});
