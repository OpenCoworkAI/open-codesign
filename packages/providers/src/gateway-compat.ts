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
 * actionable code) can react correctly. Connection diagnostics (#213) reuse
 * the same matchers so probe classification stays aligned with generate-time
 * heuristics.
 */

import type { ConnectionCapabilityLayer, WireApi } from '@open-codesign/shared';
import {
  looksLikeDeveloperRoleRejection,
  looksLikeGatewayNotImplemented,
  looksLikeReasoningRejection,
  looksLikeResponsesShapeRejection,
} from '@open-codesign/shared';

const NOT_IMPLEMENTED_PATTERNS: readonly RegExp[] = [
  /not\s+implemented/i,
  /unsupported.*messages?\s*api/i,
  /messages?\s*api.*not\s*supported/i,
  /\b501\b/,
];

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? '');
}

export function looksLikeGatewayMissingMessagesApi(err: unknown): boolean {
  const msg = errMessage(err);
  if (!msg) return false;
  return NOT_IMPLEMENTED_PATTERNS.some((re) => re.test(msg));
}

export function looksLikeGatewayDeveloperRoleRejection(err: unknown): boolean {
  return looksLikeDeveloperRoleRejection(errMessage(err));
}

export function looksLikeGatewayReasoningRejection(err: unknown): boolean {
  return looksLikeReasoningRejection(errMessage(err));
}

export function looksLikeGatewayResponsesWireMismatch(err: unknown): boolean {
  return looksLikeResponsesShapeRejection(errMessage(err));
}

export function looksLikeGatewayStubbedApi(err: unknown): boolean {
  const msg = errMessage(err);
  return looksLikeGatewayNotImplemented(msg) || looksLikeGatewayMissingMessagesApi(msg);
}

export function isOfficialOpenAIBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === 'api.openai.com' || host.endsWith('.openai.com');
  } catch {
    return false;
  }
}

/**
 * Official OpenAI already accepts `developer`. Third-party openai-chat
 * gateways are the ones connection tests need to probe (probe-only).
 */
export function openaiChatShouldProbeDeveloperRole(wire: WireApi, baseUrl: string): boolean {
  return wire === 'openai-chat' && !isOfficialOpenAIBaseUrl(baseUrl);
}

export interface GatewayIncompatibility {
  layer: ConnectionCapabilityLayer;
  message: string;
}

/** Best-effort layer for a generate-time or probe body. */
export function classifyGatewayIncompatibility(
  status: number | undefined,
  err: unknown,
  wire?: WireApi,
): GatewayIncompatibility | null {
  const message = errMessage(err);
  if (status === 401 || status === 403) {
    return { layer: 'authentication', message };
  }
  if (looksLikeGatewayDeveloperRoleRejection(err)) {
    return { layer: 'role-compatibility', message };
  }
  if (looksLikeGatewayReasoningRejection(err)) {
    return { layer: 'reasoning-compatibility', message };
  }
  if (
    (wire === 'openai-responses' && looksLikeGatewayResponsesWireMismatch(err)) ||
    looksLikeGatewayStubbedApi(err)
  ) {
    return { layer: 'wire-support', message };
  }
  if (status === 404) {
    return { layer: 'endpoint-shape', message };
  }
  return null;
}
