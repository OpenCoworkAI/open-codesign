import { describe, expect, it } from 'vitest';
import { CodesignError, isUserCancellation } from './codesign-error';
import { ERROR_CODES } from './error-codes';

describe('user generation cancellation', () => {
  it('distinguishes an acknowledged caller abort from upstream aborts, timeouts and unrelated failures', () => {
    const error = new CodesignError('Generation cancelled', ERROR_CODES.PROVIDER_ABORTED);
    const controller = new AbortController();
    expect(isUserCancellation(error, controller.signal)).toBe(false);
    expect(isUserCancellation(error)).toBe(false);
    controller.abort();
    expect(isUserCancellation(error, controller.signal)).toBe(true);
    expect(isUserCancellation(new Error('provider failed'), controller.signal)).toBe(false);
    expect(
      isUserCancellation(
        new CodesignError('auth failed', ERROR_CODES.PROVIDER_AUTH_MISSING),
        controller.signal,
      ),
    ).toBe(false);
    const timeout = new AbortController();
    timeout.abort(new CodesignError('Timed out', ERROR_CODES.GENERATION_TIMEOUT));
    expect(isUserCancellation(error, timeout.signal)).toBe(false);
  });
});
