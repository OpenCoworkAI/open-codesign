/**
 * Explicit wire-role-reasoning compatibility policy.
 *
 * "OpenAI-compatible" does not equal "behaviour-compatible." This module
 * centralises all compatibility decisions that were previously scattered
 * across index.ts so they can be read, tested, and extended in one place.
 *
 * Resolves issue #207: Wire-role-reasoning policy.
 *
 * Policy table (one place to look up what each wire does):
 *
 * Wire                  | System prompt      | Reasoning
 * ----------------------|--------------------|------------------------------------
 * anthropic             | system field       | always enabled
 * openai-responses      | instructions field | always enabled
 * openai-codex-responses| instructions field | always enabled
 * openai-chat           | system/developer*  | official OpenAI: model-ID check
 *                       |                    | third-party gateways: heuristic
 *
 * *developer role is injected by pi-ai when reasoning=true; third-party
 *  gateways reject developer with HTTP 400, so reasoning stays false there
 *  unless the model ID matches the known-reasoning heuristic.
 */

import type { WireApi } from '@open-codesign/shared';

// ── Reasoning policy ──────────────────────────────────────────────────────────

function isOpenAIOfficial(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  return /^https:\/\/api\.openai\.com(\/|$)/.test(baseUrl);
}

function isOfficialOpenAIReasoningModelId(modelId: string): boolean {
  // o1, o3, o4 families; gpt-5 family (incl. gpt-5-turbo, gpt-5.4, …)
  return /^(o[134]|gpt-5)/i.test(modelId);
}

/**
 * Matches reasoning-capable model IDs commonly proxied through third-party
 * OpenAI-compatible gateways (OpenRouter, univibe, sub2api, …). Third-party
 * gateways reject the `developer` role that pi-ai emits when reasoning=true,
 * so we only set reasoning=true when the model ID strongly suggests support.
 */
export const THIRD_PARTY_REASONING_MODEL_RE = new RegExp(
  [
    ':thinking$',
    '(^|/)claude-(?:opus|sonnet)-4',
    '^(?:openai/)?(?:o1|o3|o4|gpt-5)(?:[-.].*)?$',
    '^minimax/minimax-m\\d',
    '^deepseek/deepseek-r\\d',
    '^qwen/qwq',
  ].join('|'),
  'i',
);

/**
 * Returns true when the given wire+model+endpoint combination should have
 * reasoning (extended thinking / chain-of-thought) enabled.
 *
 * Policy per wire:
 * - anthropic               → always (all Claude 4.x models support extended thinking)
 * - openai-responses        → always (Responses API always supports reasoning)
 * - openai-codex-responses  → always
 * - openai-chat (official)  → o1 / o3 / o4 / gpt-5 model families only
 * - openai-chat (3rd-party) → heuristic model-ID match; avoids sending
 *                             `developer` role to gateways that reject it (#183)
 * - undefined / unknown     → false (safe default)
 */
export function inferReasoning(
  wire: WireApi | undefined,
  modelId: string,
  baseUrl: string | undefined,
): boolean {
  switch (wire) {
    case 'anthropic':
      return true;
    case 'openai-responses':
    case 'openai-codex-responses':
      return true;
    case 'openai-chat':
      if (isOpenAIOfficial(baseUrl)) return isOfficialOpenAIReasoningModelId(modelId);
      return THIRD_PARTY_REASONING_MODEL_RE.test(modelId);
    default:
      return false;
  }
}

// ── System-prompt / role shaping ──────────────────────────────────────────────

/**
 * Strict OpenAI-Responses gateways (sub2api-style routers) return HTTP 400
 * when both of the following are true:
 *   1. input[] contains a system or developer role entry
 *   2. the top-level `instructions` field is absent
 *
 * pi-ai's plain `openai-responses` adapter emits (1) but not (2). We patch
 * the serialised payload to mirror the codex wire's strict behaviour: promote
 * the system prompt to `instructions` and strip system/developer entries from
 * input[]. The patch is idempotent: if systemPrompt is empty, the payload is
 * returned unchanged.
 */
export function applyResponsesRoleShaping(
  payload: unknown,
  systemPrompt: string | undefined,
): unknown {
  if (!systemPrompt) return payload;
  const params = payload as {
    instructions?: string;
    input?: Array<{ role?: string }>;
  };
  params.instructions = systemPrompt;
  if (Array.isArray(params.input)) {
    params.input = params.input.filter(
      (entry) => entry.role !== 'system' && entry.role !== 'developer',
    );
  }
  return params;
}

/**
 * Returns true when the wire requires responses-style role shaping
 * (`instructions` field + system/developer entries stripped from input[]).
 */
export function requiresResponsesRoleShaping(wire: WireApi | undefined): boolean {
  return wire === 'openai-responses';
}
