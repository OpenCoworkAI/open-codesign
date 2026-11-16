export const EXIT_CODES = {
  usage: 2,
  configuration: 3,
  runtime: 4,
  task: 5,
  unsupported: 6,
  timeout: 124,
  cancelled: 130,
} as const;

export type ErrorCategory = keyof typeof EXIT_CODES;

/** Only fixed, developer-authored messages belong here. Never pass a caught error's message. */
export class CliError extends Error {
  constructor(
    public readonly category: ErrorCategory,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function safeError(error: unknown): CliError {
  return error instanceof CliError
    ? error
    : new CliError('runtime', 'RUNTIME_FAILED', 'Operation failed. Check paths and permissions.');
}

export function checkCancelled(signal: AbortSignal, deadline?: number): void {
  if (signal.aborted) {
    throw signal.reason instanceof CliError
      ? signal.reason
      : new CliError('cancelled', 'CANCELLED', 'Operation cancelled.');
  }
  if (deadline !== undefined && Date.now() >= deadline)
    throw new CliError('timeout', 'TIMEOUT', 'Operation exceeded --timeout-ms.');
}

export interface Result {
  data: unknown;
  error?: CliError;
}

export function envelope(command: string, result: Result): object {
  return {
    schemaVersion: 1,
    command,
    ok: !result.error,
    ...(result.data === undefined ? {} : { data: result.data }),
    ...(result.error
      ? {
          error: {
            category: result.error.category,
            code: result.error.code,
            message: result.error.message,
            exitCode: EXIT_CODES[result.error.category],
          },
        }
      : {}),
  };
}
