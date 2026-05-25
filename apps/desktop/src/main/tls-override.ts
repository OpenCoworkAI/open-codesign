import { Agent, type Dispatcher, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { getLogger } from './logger';

/**
 * Per-provider TLS verification bypass.
 *
 * Some users run open-codesign against internal OpenAI-compatible gateways
 * served with self-signed or private-CA certificates. Node 22's built-in fetch
 * is implemented by undici, which intentionally ignores
 * NODE_TLS_REJECT_UNAUTHORIZED. The only working bypass is to install a
 * dispatcher whose connect agent has rejectUnauthorized:false.
 *
 * This helper exposes a single high-order wrapper, withTlsBypass(enabled, fn).
 * When enabled, it swaps the global dispatcher for a loose one before invoking
 * fn and restores the original in finally. A ref count keeps nested or
 * overlapping bypass-enabled calls from clobbering each other: the loose
 * dispatcher is installed once on the 0→1 transition and the original is
 * restored on the n→0 transition.
 *
 * Known concurrency window: while a bypass call is in flight, any other
 * outbound HTTPS request issued from the main process (including from
 * built-in providers or unrelated bypass-disabled providers) uses the loose
 * dispatcher too. In practice this is rare because the app issues serial
 * requests per user, but if the user manually parallelizes a strict
 * provider's request with a bypass-enabled provider's request, the strict
 * one will silently skip verification for the overlap. Documented in
 * docs/superpowers/specs/2026-05-23-tls-bypass-design.md §9.
 */

const log = getLogger('tls-override');

let refCount = 0;
let savedDispatcher: Dispatcher | null = null;
let looseDispatcher: Dispatcher | null = null;

function getLooseDispatcher(): Dispatcher {
  if (looseDispatcher === null) {
    looseDispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  }
  return looseDispatcher;
}

function acquireTlsBypass(): void {
  if (refCount === 0) {
    savedDispatcher = getGlobalDispatcher();
    setGlobalDispatcher(getLooseDispatcher());
  }
  refCount++;
  log.warn(`TLS verification bypassed for outbound request (refcount=${refCount})`);
}

function releaseTlsBypass(): void {
  if (refCount === 0) {
    // Defensive: a release without a matching acquire indicates a logic bug.
    // Logging surfaces it; do not throw because callers run inside finally
    // blocks and a throw here would mask the real error.
    log.error('releaseTlsBypass called with refcount already 0');
    return;
  }
  refCount--;
  if (refCount === 0) {
    if (savedDispatcher !== null) setGlobalDispatcher(savedDispatcher);
    savedDispatcher = null;
  }
}

export async function withTlsBypass<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  if (!enabled) return fn();
  acquireTlsBypass();
  try {
    return await fn();
  } finally {
    releaseTlsBypass();
  }
}

/** Test-only: reset module state between vitest cases. */
export function _resetTlsOverrideForTesting(): void {
  refCount = 0;
  savedDispatcher = null;
  looseDispatcher = null;
}

/** Test-only: inspect refcount for assertions. */
export function _getTlsBypassRefCount(): number {
  return refCount;
}
