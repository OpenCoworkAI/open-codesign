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

  it.each([
    new Error('Journal write failed'),
    new Error('Generation timed out'),
    new DOMException('Deadline exceeded', 'TimeoutError'),
  ])('does not acknowledge an abort caused by %s as a user cancellation', (reason) => {
    const controller = new AbortController();
    controller.abort(reason);
    const error = new CodesignError('Provider aborted', ERROR_CODES.PROVIDER_ABORTED);
    expect(isUserCancellation(error, controller.signal)).toBe(false);
  });

  it('acknowledges an explicit caller cancellation reason', () => {
    const error = new CodesignError('Caller cancelled', ERROR_CODES.PROVIDER_ABORTED);
    const controller = new AbortController();
    controller.abort(error);
    expect(isUserCancellation(error, controller.signal)).toBe(true);
  });
});
