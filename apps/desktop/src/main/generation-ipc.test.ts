import { CancelGenerationPayloadV1, CodesignError } from '@open-codesign/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  armGenerationTimeout,
  cancelGenerationRequest,
  extractGenerationTimeoutError,
} from './generation-ipc';

function makeController() {
  return { abort: vi.fn() } as unknown as AbortController;
}

describe('cancelGenerationRequest', () => {
  it('parses the public v1 cancel-generation payload', () => {
    const payload = CancelGenerationPayloadV1.parse({
      schemaVersion: 1,
      generationId: 'gen-1',
    });

    expect(payload).toEqual({
      schemaVersion: 1,
      generationId: 'gen-1',
    });
  });

  it('throws on invalid IPC payloads without aborting in-flight requests', () => {
    const controller = makeController();
    const inFlight = new Map([['gen-1', controller]]);
    const logIpc = { info: vi.fn() };

    expect(() => cancelGenerationRequest(undefined, inFlight, logIpc)).toThrow(CodesignError);
    expect(controller.abort).not.toHaveBeenCalled();
    expect(inFlight.has('gen-1')).toBe(true);
    expect(logIpc.info).not.toHaveBeenCalled();
  });

  it('aborts only the requested generation', () => {
    const target = makeController();
    const other = makeController();
    const inFlight = new Map([
      ['gen-1', target],
      ['gen-2', other],
    ]);
    const logIpc = { info: vi.fn() };

    cancelGenerationRequest('gen-1', inFlight, logIpc);

    expect(target.abort).toHaveBeenCalledOnce();
    expect(other.abort).not.toHaveBeenCalled();
    expect(inFlight.has('gen-1')).toBe(false);
    expect(inFlight.has('gen-2')).toBe(true);
    expect(logIpc.info).toHaveBeenCalledWith('generate.cancelled', { id: 'gen-1' });
  });

  it('is a noop when the generationId is not in the in-flight map', () => {
    const other = makeController();
    const inFlight = new Map([['gen-2', other]]);
    const logIpc = { info: vi.fn() };

    cancelGenerationRequest('gen-unknown', inFlight, logIpc);

    expect(other.abort).not.toHaveBeenCalled();
    expect(inFlight.has('gen-2')).toBe(true);
    expect(logIpc.info).not.toHaveBeenCalled();
  });

  it('rejects CancelGenerationPayloadV1 with empty generationId or missing schemaVersion', () => {
    expect(() => CancelGenerationPayloadV1.parse({ schemaVersion: 1, generationId: '' })).toThrow();
    expect(() => CancelGenerationPayloadV1.parse({ generationId: 'gen-1' })).toThrow();
    expect(() =>
      CancelGenerationPayloadV1.parse({ schemaVersion: 2, generationId: 'gen-1' }),
    ).toThrow();
  });
});

describe('armGenerationTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts the controller with a CodesignError after the configured timeout', async () => {
    const controller = new AbortController();
    const logger = { warn: vi.fn() };

    const clear = await armGenerationTimeout('gen-1', controller, async () => 5, logger);

    expect(controller.signal.aborted).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBeInstanceOf(CodesignError);
    expect((controller.signal.reason as CodesignError).code).toBe('GENERATION_TIMEOUT');
    expect(logger.warn).toHaveBeenCalledWith('generate.timeout.fired', {
      id: 'gen-1',
      timeoutSec: 5,
    });
    clear();
  });

  it('does not abort when clear() is called before the timeout fires', async () => {
    const controller = new AbortController();
    const logger = { warn: vi.fn() };

    const clear = await armGenerationTimeout('gen-1', controller, async () => 60, logger);
    clear();
    vi.advanceTimersByTime(120_000);

    expect(controller.signal.aborted).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('rethrows as PREFERENCES_READ_FAIL when reading preferences fails — never silently unbounded', async () => {
    const controller = new AbortController();
    const logger = { warn: vi.fn() };

    await expect(
      armGenerationTimeout(
        'gen-1',
        controller,
        async () => {
          throw new Error('disk gone');
        },
        logger,
      ),
    ).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'PREFERENCES_READ_FAIL',
    });

    expect(controller.signal.aborted).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      'generate.timeout.prefs_read_failed',
      expect.objectContaining({ id: 'gen-1', message: 'disk gone' }),
    );
  });

  it('treats 0 as disabled and does not arm a timeout', async () => {
    const controller = new AbortController();
    const logger = { warn: vi.fn() };

    const clear = await armGenerationTimeout('gen-1', controller, async () => 0, logger);
    vi.advanceTimersByTime(60_000);
    clear();

    expect(controller.signal.aborted).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('clamps very large timeout values to Node setTimeout int32 cap so the abort does not fire immediately', async () => {
    const controller = new AbortController();
    const logger = { warn: vi.fn() };
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const clear = await armGenerationTimeout('gen-1', controller, async () => 99_999_999, logger);

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    const delay = setTimeoutSpy.mock.calls[0]?.[1];
    expect(delay).toBe(2_147_483_647);

    vi.advanceTimersByTime(1);
    expect(controller.signal.aborted).toBe(false);

    setTimeoutSpy.mockRestore();
    clear();
  });

  it('throws PREFERENCES_INVALID_TIMEOUT when the timeout value is NaN', async () => {
    const controller = new AbortController();
    const logger = { warn: vi.fn() };

    await expect(
      armGenerationTimeout('gen-1', controller, async () => Number.NaN, logger),
    ).rejects.toMatchObject({ name: 'CodesignError', code: 'PREFERENCES_INVALID_TIMEOUT' });
    expect(controller.signal.aborted).toBe(false);
  });

  it('throws PREFERENCES_INVALID_TIMEOUT when the timeout value is negative', async () => {
    const controller = new AbortController();
    const logger = { warn: vi.fn() };

    await expect(
      armGenerationTimeout('gen-1', controller, async () => -1, logger),
    ).rejects.toMatchObject({ name: 'CodesignError', code: 'PREFERENCES_INVALID_TIMEOUT' });
    expect(controller.signal.aborted).toBe(false);
  });
});

describe('extractGenerationTimeoutError', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the CodesignError stashed by armGenerationTimeout so the SDK-rewritten AbortError can be upgraded back to GENERATION_TIMEOUT', async () => {
    const controller = new AbortController();
    const logger = { warn: vi.fn() };

    await armGenerationTimeout('gen-1', controller, async () => 3, logger);
    vi.advanceTimersByTime(3000);

    const recovered = extractGenerationTimeoutError(controller.signal);
    expect(recovered).toBeInstanceOf(CodesignError);
    expect(recovered?.code).toBe('GENERATION_TIMEOUT');
    expect(recovered?.message).toContain('3s');
    expect(recovered?.message).toContain('Settings');
  });

  it('returns null when the controller was aborted by a user-initiated cancel (no reason set)', () => {
    const controller = new AbortController();
    controller.abort();
    expect(extractGenerationTimeoutError(controller.signal)).toBeNull();
  });

  it('returns null when the signal has not been aborted', () => {
    const controller = new AbortController();
    expect(extractGenerationTimeoutError(controller.signal)).toBeNull();
  });

  it('returns null when the abort reason is some other CodesignError (not a timeout)', () => {
    const controller = new AbortController();
    controller.abort(new CodesignError('something else', 'PROVIDER_ABORTED'));
    expect(extractGenerationTimeoutError(controller.signal)).toBeNull();
  });
});
