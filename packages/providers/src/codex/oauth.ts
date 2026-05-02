import { createHash, randomBytes } from 'node:crypto';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';

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

type TokenResponse = Record<string, unknown>;

function tokenParseError(
  kind: 'exchange' | 'refresh',
  detail: string,
  cause?: unknown,
): CodesignError {
  return new CodesignError(
    `Codex OAuth ${kind} returned an invalid token response: ${detail}`,
    ERROR_CODES.CODEX_TOKEN_PARSE_FAILED,
    { cause },
  );
}

function asTokenResponse(value: unknown, kind: 'exchange' | 'refresh'): TokenResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw tokenParseError(kind, 'response body must be a JSON object');
  }
  return value as TokenResponse;
}

function readRequiredTokenString(
  response: TokenResponse,
  field: 'access_token' | 'refresh_token' | 'id_token',
  kind: 'exchange' | 'refresh',
): string {
  const value = response[field];
  if (typeof value !== 'string') {
    throw tokenParseError(kind, `${field} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw tokenParseError(kind, `${field} must be a non-empty string`);
  }
  return trimmed;
}

function readOptionalRefreshToken(
  response: TokenResponse,
  kind: 'exchange' | 'refresh',
): string | null {
  const value = response['refresh_token'];
  if (value === undefined) return null;
  if (typeof value !== 'string') {
    throw tokenParseError(kind, 'refresh_token must be a non-empty string when present');
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw tokenParseError(kind, 'refresh_token must be a non-empty string when present');
  }
  return trimmed;
}

function readExpiresIn(response: TokenResponse, kind: 'exchange' | 'refresh'): number {
  const value = response['expires_in'];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw tokenParseError(kind, 'expires_in must be a positive number');
  }
  return value;
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
    const text = await safeResponseText(res);
    const parsed = parseOAuthErrorBody(text);
    throw new CodexOAuthTokenError({
      kind,
      status: res.status,
      responseBody: text,
      oauthErrorCode: parsed.oauthErrorCode,
      upstreamMessage: parsed.upstreamMessage,
    });
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (cause) {
    throw tokenParseError(kind, 'response body must be valid JSON', cause);
  }
  return asTokenResponse(json, kind);
}

async function safeResponseText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch (err) {
    void err;
    // The HTTP status is the failure; the response body only improves diagnostics.
    return '';
  }
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
  const response = await postToken(body, 'exchange');
  const idToken = readRequiredTokenString(response, 'id_token', 'exchange');
  const expiresIn = readExpiresIn(response, 'exchange');
  return {
    accessToken: readRequiredTokenString(response, 'access_token', 'exchange'),
    refreshToken: readRequiredTokenString(response, 'refresh_token', 'exchange'),
    idToken,
    expiresAt: Date.now() + expiresIn * 1000,
    accountId: extractAccountId(idToken),
  };
}

export async function refreshTokens(refreshToken: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });
  const response = await postToken(body, 'refresh');
  const idToken = readRequiredTokenString(response, 'id_token', 'refresh');
  const expiresIn = readExpiresIn(response, 'refresh');
  const nextRefreshToken = readOptionalRefreshToken(response, 'refresh');
  return {
    accessToken: readRequiredTokenString(response, 'access_token', 'refresh'),
    refreshToken: nextRefreshToken ?? refreshToken,
    idToken,
    expiresAt: Date.now() + expiresIn * 1000,
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

  const topLevelAccountId = readNonEmptyClaim(claims['chatgpt_account_id']);
  if (topLevelAccountId !== null) {
    return topLevelAccountId;
  }

  const nested = claims['https://api.openai.com/auth'];
  if (nested && typeof nested === 'object') {
    const accountId = (nested as { chatgpt_account_id?: unknown }).chatgpt_account_id;
    const nestedAccountId = readNonEmptyClaim(accountId);
    if (nestedAccountId !== null) return nestedAccountId;
  }

  const orgs = claims['organizations'];
  if (Array.isArray(orgs) && orgs.length > 0) {
    const first = orgs[0] as { id?: unknown };
    const orgId = readNonEmptyClaim(first?.id);
    if (orgId !== null) return orgId;
  }

  return null;
}

function readNonEmptyClaim(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
