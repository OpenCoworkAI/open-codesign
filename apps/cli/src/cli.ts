import type { Readable } from 'node:stream';
import { type Arguments, HELP, parseArguments } from './arguments';
import { CliError, checkCancelled, EXIT_CODES, envelope, type Result, safeError } from './protocol';

interface IO {
  stdin?: Readable;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

type Dispatch = (args: Arguments, signal: AbortSignal, deadline: number) => Promise<Result>;

/** Cooperative deadline: wait for operation cleanup before emitting a terminal result. */
export async function execute(
  args: Arguments,
  signal: AbortSignal,
  dispatch: Dispatch,
): Promise<Result> {
  const controller = new AbortController();
  const cancel = () =>
    controller.abort(new CliError('cancelled', 'CANCELLED', 'Operation cancelled.'));
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const timer = setTimeout(() => {
    controller.abort(new CliError('timeout', 'TIMEOUT', 'Operation exceeded --timeout-ms.'));
  }, args.timeoutMs);
  const deadline = Date.now() + args.timeoutMs;
  try {
    checkCancelled(controller.signal);
    const result = await dispatch(args, controller.signal, deadline);
    if (args.command === 'debug ui' && controller.signal.aborted) {
      return { ...result, error: safeError(controller.signal.reason) };
    }
    // Synchronous document rendering can delay the timer callback.
    if (Date.now() >= deadline && args.command !== 'export html') {
      controller.abort(new CliError('timeout', 'TIMEOUT', 'Operation exceeded --timeout-ms.'));
    }
    checkCancelled(controller.signal);
    return result;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}

export async function runCli(
  argv: string[],
  io: IO,
  signal: AbortSignal = new AbortController().signal,
  dispatch: Dispatch = async (args, operationSignal, deadline) => {
    if (args.command === 'debug ui')
      return (await import('./ui-debug')).debugUi(args, operationSignal);
    const operations = await import('./operations');
    return operations.dispatch(args, operationSignal, deadline);
  },
): Promise<number> {
  let command = 'unknown';
  let json = argv.includes('--json');
  let result: Result;
  try {
    const args = parseArguments(argv);
    command = args.command;
    json = args.json;
    if (args.command === 'debug session') {
      if (!io.stdin)
        throw new CliError(
          'runtime',
          'SESSION_STDIN_REQUIRED',
          'debug session requires JSONL stdin.',
        );
      return await (await import('./ui-session')).runUiSession(args, io.stdin, io.stdout, signal);
    }
    if (command === 'help') result = { data: { help: HELP } };
    else if (command === 'unsupported')
      throw new CliError(
        'unsupported',
        'UNSUPPORTED',
        'Only doctor, workspace inspect, export html, debug ui and debug session are available. Design execution and session status require the Electron permission, credential and session lifecycle; MCP transport and other export formats are not implemented. No GUI fallback was attempted.',
      );
    else result = await execute(args, signal, dispatch);
  } catch (error) {
    result = { data: undefined, error: safeError(error) };
  }
  if (json) io.stdout(`${JSON.stringify(envelope(command, result))}\n`);
  else {
    if (command === 'help' && !result.error) io.stdout(HELP);
    else if (result.data !== undefined) {
      if (command === 'doctor') {
        const report = result.data as {
          checks: { id: string; status: string; code: string; message: string }[];
        };
        io.stdout(
          `${report.checks
            .map((check) => `[${check.status}] ${check.id} (${check.code}): ${check.message}`)
            .join('\n')}\n`,
        );
      } else io.stdout(`${JSON.stringify(result.data, null, 2)}\n`);
    }
    if (result.error) io.stderr(`${result.error.code}: ${result.error.message}\n`);
  }
  return result.error ? EXIT_CODES[result.error.category] : 0;
}
