import {
  type Api,
  getModel,
  getModels,
  getProviders,
  type KnownProvider,
  type Model,
} from '@mariozechner/pi-ai';
import type { ModelRef } from '@open-codesign/shared';

/** Used when neither the provider settings nor pi-ai's catalog know the model. */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

/**
 * Context window, in tokens, for a model: the provider's configured value,
 * then pi-ai's catalog entry for this provider and model, then the smallest
 * window among catalog entries with the same model id (relays and gateways
 * usually serve upstream ids, and an overestimate overflows the request while
 * an underestimate only trims context sooner), then DEFAULT_CONTEXT_WINDOW.
 */
export function resolveContextWindow(model: ModelRef, configured: number | undefined): number {
  if (configured !== undefined) return configured;
  const exact: Model<Api> | undefined = getModel(
    model.provider as KnownProvider,
    model.modelId as never,
  );
  if (exact !== undefined) return exact.contextWindow;
  const sameId = getProviders().flatMap((provider) =>
    getModels(provider).filter((entry) => entry.id === model.modelId),
  );
  return sameId.length > 0
    ? Math.min(...sameId.map((entry) => entry.contextWindow))
    : DEFAULT_CONTEXT_WINDOW;
}
