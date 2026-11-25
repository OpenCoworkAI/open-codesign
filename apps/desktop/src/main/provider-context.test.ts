import { describe, expect, it } from 'vitest';
import { createProviderContextStore, mergeFinalProviderContext } from './provider-context';

describe('final provider error context', () => {
  it('keeps authoritative terminal identity over a stale transient retry', () => {
    expect(
      mergeFinalProviderContext(
        {
          upstream_status: 403,
          upstream_code: 'unsupported_country_region_territory',
          recovery_category: 'region_restricted',
          upstream_request_id: undefined,
          retry_count: 0,
        },
        {
          upstream_status: 503,
          upstream_code: 'server_error',
          recovery_category: 'upstream_server_error',
          upstream_request_id: 'last-retry',
          retry_count: 2,
        },
      ),
    ).toEqual({
      upstream_status: 403,
      upstream_code: 'unsupported_country_region_territory',
      recovery_category: 'region_restricted',
      retry_count: 2,
    });
  });
  it('retains available retry context when final normalization lacks upstream identity', () => {
    expect(
      mergeFinalProviderContext(
        { upstream_status: undefined, recovery_category: 'unknown', retry_count: 0 },
        { upstream_status: 429, recovery_category: 'rate_limit', retry_count: 1 },
      ),
    ).toEqual({ upstream_status: 429, recovery_category: 'rate_limit', retry_count: 1 });
  });
});

describe('createProviderContextStore', () => {
  it('remember then consume returns the context and deletes it', () => {
    const store = createProviderContextStore();
    const ctx = { upstream_status: 504, upstream_request_id: 'req_1' };
    store.remember('run-a', ctx);
    expect(store.size()).toBe(1);
    expect(store.consume('run-a')).toEqual(ctx);
    expect(store.size()).toBe(0);
    // Second consume returns undefined — the entry was removed.
    expect(store.consume('run-a')).toBeUndefined();
  });

  it('consume of an unknown runId returns undefined', () => {
    const store = createProviderContextStore();
    expect(store.consume('never-stashed')).toBeUndefined();
  });

  it('evicts the oldest entry when maxEntries is reached', () => {
    const store = createProviderContextStore(3);
    store.remember('a', { v: 1 });
    store.remember('b', { v: 2 });
    store.remember('c', { v: 3 });
    // Inserting past the cap should evict 'a' (oldest by insertion).
    store.remember('d', { v: 4 });
    expect(store.size()).toBe(3);
    expect(store.consume('a')).toBeUndefined();
    expect(store.consume('b')).toEqual({ v: 2 });
    expect(store.consume('c')).toEqual({ v: 3 });
    expect(store.consume('d')).toEqual({ v: 4 });
  });

  it('overwriting an existing key does not grow size past the cap', () => {
    const store = createProviderContextStore(2);
    store.remember('a', { v: 1 });
    store.remember('a', { v: 2 });
    expect(store.size()).toBe(1);
    expect(store.consume('a')).toEqual({ v: 2 });
  });

  it('does NOT evict when overwriting an existing key even at capacity', () => {
    const store = createProviderContextStore(3);
    store.remember('a', { v: 1 });
    store.remember('b', { v: 2 });
    store.remember('c', { v: 3 });
    // Overwrite 'a' — a second `provider.error` for the same runId should
    // refresh the stash in place, not silently evict 'b' (the oldest by
    // insertion) and lose an unrelated run's upstream_request_id.
    store.remember('a', { v: 99 });
    expect(store.size()).toBe(3);
    expect(store.consume('b')).toEqual({ v: 2 });
    expect(store.consume('a')).toEqual({ v: 99 });
    expect(store.consume('c')).toEqual({ v: 3 });
  });
});
