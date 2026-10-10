import { getModels, getProviders, type KnownProvider } from '@mariozechner/pi-ai';
import { normalizeGeminiModelId } from '@open-codesign/providers';
import type { ModelRef } from '@open-codesign/shared';

/** Used when neither the provider settings nor pi-ai's catalog know the model. */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

/**
 * Context window, in tokens, for a model: the provider's configured value,
 * then pi-ai's catalog entry for this provider and model, then the smallest
 * window among catalog entries with the same model id (relays and gateways
 * usually serve upstream ids, and an overestimate overflows the request while
 * an underestimate only trims context sooner), then DEFAULT_CONTEXT_WINDOW.
 * The catalog is searched with the id sent on the wire, so Gemini's
 * `models/`-prefixed ids match.
 */
export function resolveContextWindow(
  model: ModelRef,
  baseUrl: string | undefined,
  configured: number | undefined,
): number {
  if (configured !== undefined) return configured;
  const modelId = normalizeGeminiModelId(model.modelId, baseUrl);
  const exact = getModels(model.provider as KnownProvider).find((entry) => entry.id === modelId);
  if (exact !== undefined) return exact.contextWindow;
  const sameId = getProviders().flatMap((provider) =>
    getModels(provider).filter((entry) => entry.id === modelId),
  );
  return sameId.length > 0
    ? Math.min(...sameId.map((entry) => entry.contextWindow))
    : DEFAULT_CONTEXT_WINDOW;
}
