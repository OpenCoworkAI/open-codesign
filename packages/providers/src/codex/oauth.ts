import { createHash, randomBytes } from 'node:crypto';

export const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const AUTH_BASE = 'https://auth.openai.com';

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function generatePkce(): PkcePair {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export interface AuthorizeUrlOpts {
  redirectUri: string;
  state: string;
  challenge: string;
  originator?: string;
}

export function buildAuthorizeUrl(opts: AuthorizeUrlOpts): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: opts.redirectUri,
    scope: 'openid profile email offline_access',
    code_challenge: opts.challenge,
    code_challenge_method: 'S256',
    state: opts.state,
    codex_cli_simplified_flow: 'true',
    originator: opts.originator ?? 'open-codesign',
    id_token_add_organizations: 'true',
  });
  return `${AUTH_BASE}/oauth/authorize?${params.toString()}`;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number;
  accountId: string | null;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}

interface ParsedOAuthError {
  oauthErrorCode: string | undefined;
  upstreamMessage: string | undefined;
}

export class CodexOAuthTokenError extends Error {
  public readonly kind: 'exchange' | 'refresh';
  public readonly status: number;
  public readonly responseBody: string;
  public readonly oauthErrorCode: string | undefined;
  public readonly upstreamMessage: string | undefined;

  constructor(input: {
    kind: 'exchange' | 'refresh';
    status: number;
    responseBody: string;
    oauthErrorCode: string | undefined;
    upstreamMessage: string | undefined;
  }) {
    super(
      `Codex OAuth ${input.kind} failed: ${input.status}${formatOAuthErrorDetail(
        input.responseBody,
        input.oauthErrorCode,
        input.upstreamMessage,
      )}`,
    );
    this.name = 'CodexOAuthTokenError';
    this.kind = input.kind;
    this.status = input.status;
    this.responseBody = input.responseBody;
    this.oauthErrorCode = input.oauthErrorCode;
    this.upstreamMessage = input.upstreamMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseOAuthErrorBody(text: string): ParsedOAuthError {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return { oauthErrorCode: undefined, upstreamMessage: undefined };
    const error = parsed['error'];
    if (!isRecord(error)) return { oauthErrorCode: undefined, upstreamMessage: undefined };
    const code = error['code'];
    const message = error['message'];
    return {
      oauthErrorCode: typeof code === 'string' && code.length > 0 ? code : undefined,
      upstreamMessage: typeof message === 'string' && message.length > 0 ? message : undefined,
    };
  } catch {
    return { oauthErrorCode: undefined, upstreamMessage: undefined };
  }
}

function formatOAuthErrorDetail(
  responseBody: string,
  oauthErrorCode: string | undefined,
  upstreamMessage: string | undefined,
): string {
  if (oauthErrorCode !== undefined && upstreamMessage !== undefined) {
    return ` ${oauthErrorCode} - ${upstreamMessage}`;
  }
  if (oauthErrorCode !== undefined) return ` ${oauthErrorCode}`;
  if (upstreamMessage !== undefined) return ` ${upstreamMessage}`;
  return ` ${responseBody}`;
}

async function postToken(
  body: URLSearchParams,
  kind: 'exchange' | 'refresh',
): Promise<TokenResponse> {
  const res = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    const parsed = parseOAuthErrorBody(text);
    throw new CodexOAuthTokenError({
      kind,
      status: res.status,
      responseBody: text,
      oauthErrorCode: parsed.oauthErrorCode,
      upstreamMessage: parsed.upstreamMessage,
    });
  }
  return (await res.json()) as TokenResponse;
}

export async function exchangeCode(
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });
  const json = await postToken(body, 'exchange');
  const idToken = json.id_token ?? '';
  return {
    accessToken: json.access_token ?? '',
    refreshToken: json.refresh_token ?? '',
    idToken,
    expiresAt: Date.now() + (json.expires_in ?? 0) * 1000,
    accountId: extractAccountId(idToken),
  };
}

export async function refreshTokens(refreshToken: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });
  const json = await postToken(body, 'refresh');
  const idToken = json.id_token ?? '';
  return {
    accessToken: json.access_token ?? '',
    refreshToken: json.refresh_token ?? refreshToken,
    idToken,
    expiresAt: Date.now() + (json.expires_in ?? 0) * 1000,
    accountId: extractAccountId(idToken),
  };
}

/**
 * Decodes the payload segment of a JWT without verifying the signature.
 * Returns null on any parse/format failure. Intended for reading non-security
 * claims (email, chatgpt_account_id, organizations) from OpenAI-issued tokens.
 */
export function decodeJwtClaims(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1];
    if (payload === undefined || payload === '') return null;
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function extractAccountId(jwt: string): string | null {
  const claims = decodeJwtClaims(jwt);
  if (claims === null) return null;

  if (typeof claims['chatgpt_account_id'] === 'string') {
    return claims['chatgpt_account_id'];
  }

  const nested = claims['https://api.openai.com/auth'];
  if (nested && typeof nested === 'object') {
    const accountId = (nested as { chatgpt_account_id?: unknown }).chatgpt_account_id;
    if (typeof accountId === 'string') return accountId;
  }

  const orgs = claims['organizations'];
  if (Array.isArray(orgs) && orgs.length > 0) {
    const first = orgs[0] as { id?: unknown };
    if (first && typeof first.id === 'string') return first.id;
  }

  return null;
}
