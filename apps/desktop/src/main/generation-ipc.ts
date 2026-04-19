import { CodesignError } from '@open-codesign/shared';

export interface CancellationLogger {
  info: (event: string, payload: { id: string }) => void;
}

export function cancelGenerationRequest(
  raw: unknown,
  inFlight: Map<string, AbortController>,
  logIpc: CancellationLogger,
): void {
  if (typeof raw !== 'string') {
    throw new CodesignError('cancel-generation expects a generationId string', 'IPC_BAD_INPUT');
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
    logger.warn('generate.timeout.prefs_read_failed', {
      id,
      message: err instanceof Error ? err.message : String(err),
    });
    return () => {};
  }
  if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) return () => {};

  const handle = setTimeout(() => {
    logger.warn('generate.timeout.fired', { id, timeoutSec });
    controller.abort(
      new CodesignError(
        `Generation aborted after ${timeoutSec}s (Settings → Advanced → Generation timeout).`,
        'GENERATION_TIMEOUT',
      ),
    );
  }, timeoutSec * 1000);
  return () => clearTimeout(handle);
}
