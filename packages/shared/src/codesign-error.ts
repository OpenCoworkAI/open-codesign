import { type CodesignErrorCode, ERROR_CODES } from './error-codes';

export class CodesignError extends Error {
  constructor(
    message: string,
    // Accept a known registry code (preferred) or a free-form string for older callers.
    public readonly code: CodesignErrorCode | string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'CodesignError';
  }
}

export function isUserCancellation(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true &&
    error instanceof CodesignError &&
    error.code === ERROR_CODES.PROVIDER_ABORTED &&
    ((signal.reason instanceof DOMException && signal.reason.name === 'AbortError') ||
      (signal.reason instanceof CodesignError &&
        signal.reason.code === ERROR_CODES.PROVIDER_ABORTED))
  );
}
