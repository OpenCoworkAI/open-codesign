/**
 * Per-runId stash of the normalized provider error context emitted by
 * `retry.ts` via the `provider.error` warn adapter. The final non-transient
 * row recorded by `recordFinalError` consumes the stash so it can attach
 * upstream_request_id / status / retry_count fields that otherwise live only
 * on the hidden transient sibling row.
 *
 * Bounded by `maxEntries` (default 50): successful runs that never call
 * `consume` would otherwise leak keys forever; inserting past the cap
 * evicts the oldest entry in insertion order.
 */
export interface ProviderContextStore {
  remember(runId: string, ctx: Record<string, unknown>): void;
  consume(runId: string): Record<string, unknown> | undefined;
  /** Testing-only — inspect current size without mutating. */
  size(): number;
}

/** Final normalized identity wins; retry logging fills only unavailable fields. */
export function mergeFinalProviderContext(
  normalized: Record<string, unknown> | undefined,
  remembered: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!normalized) return remembered;
  const context = { ...remembered };
  const changedAttempt = ['upstream_status', 'upstream_code'].some(
    (key) =>
      normalized[key] !== undefined &&
      remembered?.[key] !== undefined &&
      normalized[key] !== remembered[key],
  );
  if (changedAttempt) {
    delete context['upstream_request_id'];
    delete context['redacted_body_head'];
  }
  for (const [key, value] of Object.entries(normalized)) {
    if (
      value !== undefined &&
      !(key === 'recovery_category' && value === 'unknown' && context[key] !== undefined)
    ) {
      context[key] = value;
    }
  }
  if (remembered?.['retry_count'] !== undefined) context['retry_count'] = remembered['retry_count'];
  return context;
}

export function createProviderContextStore(maxEntries = 50): ProviderContextStore {
  const map = new Map<string, Record<string, unknown>>();
  return {
    remember(runId, ctx) {
      // Guard the eviction on !has(runId): overwriting an existing key doesn't
      // grow the map, so evicting the oldest would silently drop an unrelated
      // run's stash (e.g. a second `provider.error` for the same runId during
      // a retry loop would cost us another run's upstream_request_id).
      if (!map.has(runId) && map.size >= maxEntries) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
      map.set(runId, ctx);
    },
    consume(runId) {
      const value = map.get(runId);
      map.delete(runId);
      return value;
    },
    size() {
      return map.size;
    },
  };
}
