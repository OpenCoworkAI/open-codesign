import { decodeJwtClaims, type StoredCodexAuth } from '@open-codesign/providers/codex';

/** Convert an explicitly selected Codex CLI login; never discover, refresh or modify it. */
export function projectCodexLogin(raw: string, now = Date.now()): StoredCodexAuth {
  let tokens: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as { auth_mode?: unknown; tokens?: Record<string, unknown> };
    if (parsed.auth_mode !== 'chatgpt' || !parsed.tokens) throw new Error();
    tokens = parsed.tokens;
    for (const key of ['access_token', 'refresh_token', 'id_token'])
      if (typeof tokens[key] !== 'string' || !tokens[key] || tokens[key] !== tokens[key].trim())
        throw new Error();
  } catch {
    throw new Error('BACKGROUND_MODEL_AUTH_INVALID');
  }
  const accessToken = tokens['access_token'] as string;
  const expiry = decodeJwtClaims(accessToken)?.['exp'];
  if (typeof expiry !== 'number' || !Number.isFinite(expiry))
    throw new Error('BACKGROUND_MODEL_AUTH_INVALID');
  if (expiry * 1000 <= now + 5 * 60 * 1000) throw new Error('BACKGROUND_MODEL_AUTH_EXPIRED');
  return {
    schemaVersion: 1,
    accessToken,
    refreshToken: tokens['refresh_token'] as string,
    idToken: tokens['id_token'] as string,
    expiresAt: expiry * 1000,
    accountId: null,
    email: null,
    updatedAt: now,
  };
}
