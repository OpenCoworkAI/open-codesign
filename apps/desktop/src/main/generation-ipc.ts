import { CodesignError, ERROR_CODES } from '@open-codesign/shared';

export interface CancellationLogger {
  info: (event: string, payload: { id: string }) => void;
}

export function cancelGenerationRequest(
  raw: unknown,
  inFlight: Map<string, AbortController>,
  logIpc: CancellationLogger,
): void {
  if (typeof raw !== 'string') {
    throw new CodesignError(
      'cancel-generation expects a generationId string',
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }

  const controller = inFlight.get(raw);
  if (!controller) return;

  controller.abort();
  inFlight.delete(raw);
  logIpc.info('generate.cancelled', { id: raw });
}

export interface GenerationTimeoutLogger {
  warn: (event: string, payload: Record<string, unknown>) => void;
}

/**
 * Schedule an abort on `controller` after the user-configured generation
 * timeout elapses. Reads prefs lazily per-call so Settings changes apply on
 * the next request without an app restart. Returns `clear()` for the caller
 * to invoke once the request settles so we don't abort a finished controller.
 *
 * If the prefs read throws, the failure is surfaced (rethrown as
 * `PREFERENCES_READ_FAIL`) rather than silently dropping the timeout — an
 * unbounded LLM call is worse than a visible error the user can act on.
 * NaN / Infinity / negative values likewise throw `PREFERENCES_INVALID_TIMEOUT`
 * instead of silently disabling the timeout. A value of `0` means "disabled".
 */
export async function armGenerationTimeout(
  id: string,
  controller: AbortController,
  readTimeoutSec: () => Promise<number>,
  logger: GenerationTimeoutLogger,
): Promise<() => void> {
  let timeoutSec: number;
  try {
    timeoutSec = await readTimeoutSec();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('generate.timeout.prefs_read_failed', { id, message });
    throw new CodesignError(
      `Could not read generation timeout preference: ${message}`,
      ERROR_CODES.PREFERENCES_READ_FAIL,
    );
  }
  if (!Number.isFinite(timeoutSec) || timeoutSec < 0) {
    logger.warn('generate.timeout.invalid_value', { id, timeoutSec });
    throw new CodesignError(
      `Invalid generation timeout: ${String(timeoutSec)} (must be a non-negative finite number).`,
      ERROR_CODES.PREFERENCES_INVALID_TIMEOUT,
    );
  }
  if (timeoutSec === 0) return () => {};

  // Node's setTimeout caps delay at int32 (~24.8 days). Larger values overflow
  // and fire immediately, which would abort generation instantly.
  const TIMEOUT_MAX_MS = 2_147_483_647;
  const ms = Math.min(timeoutSec * 1000, TIMEOUT_MAX_MS);

  const handle = setTimeout(() => {
    logger.warn('generate.timeout.fired', { id, timeoutSec });
    controller.abort(
      new CodesignError(
        `Generation aborted after ${timeoutSec}s (Settings → Advanced → Generation timeout).`,
        ERROR_CODES.GENERATION_TIMEOUT,
      ),
    );
  }, ms);
  return () => clearTimeout(handle);
}

/**
 * Provider SDKs (Anthropic / OpenAI) catch an aborted fetch and rethrow their
 * own generic `'Request was aborted.'` error, discarding `signal.reason`. When
 * the caught error came from our own timeout abort, we want the richer message
 * (with the configured seconds and the Settings path) to surface to the user.
 *
 * Returns the `CodesignError` we stashed on `signal.reason`, or `null` when the
 * abort was caused by something else (user-initiated cancel, upstream error).
 */
export function extractGenerationTimeoutError(signal: AbortSignal): CodesignError | null {
  if (!signal.aborted) return null;
  const reason = signal.reason;
  if (reason instanceof CodesignError && reason.code === ERROR_CODES.GENERATION_TIMEOUT) {
    return reason;
  }
  return null;
}
