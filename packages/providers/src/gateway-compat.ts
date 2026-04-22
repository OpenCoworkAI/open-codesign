/**
 * Gateway compatibility detection.
 *
 * Third-party Anthropic-compatible relays (sub2api, claude2api, anyrouter…)
 * frequently implement GET /v1/models (which is what our connection test
 * hits) but stub out POST /v1/messages with "not implemented" / 501. That
 * combination passes the onboarding check but explodes on the first real
 * generation. Treating it as a retryable 5xx wastes the user's time with
 * exponential backoff and surfaces a misleading "check your API key" blurb.
 *
 * This helper detects the tell-tale upstream text so both the retry layer
 * (to short-circuit) and the core error remapper (to tag it with an
 * actionable code) can react correctly.
 */

const NOT_IMPLEMENTED_PATTERNS: readonly RegExp[] = [
  /not\s+implemented/i,
  /unsupported.*messages?\s*api/i,
  /messages?\s*api.*not\s*supported/i,
  /\b501\b/,
];

export function looksLikeGatewayMissingMessagesApi(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (!msg) return false;
  return NOT_IMPLEMENTED_PATTERNS.some((re) => re.test(msg));
}
