import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import type { UiDebugFrame, UiDebugHost } from '../../desktop/src/debug/contract';
import type { Arguments } from './arguments';
import { CliError, EXIT_CODES, envelope, type Result, safeError } from './protocol';
import { loadUiDebugHost } from './ui-debug';

/** Bounded, sequential JSONL transport. It owns neither application state nor a network port. */
export class SessionInput {
  private buffer = '';
  private decoder = new StringDecoder('utf8');
  private queue: string[] = [];
  private ended = false;
  private failure: CliError | undefined;
  private wake: (() => void) | undefined;

  constructor(
    private readonly input: Readable,
    private readonly fail: (error: CliError) => void,
  ) {
    input.on('data', this.data);
    input.once('end', this.end);
    input.once('error', this.error);
    input.once('close', this.end);
    if (input.readableEnded || input.destroyed) this.end();
  }
  private rejectInput() {
    this.failure = new CliError(
      'usage',
      'SESSION_INPUT_LIMIT',
      'JSONL input exceeds 64 KiB per message or eight queued messages.',
    );
    this.input.pause();
    this.fail(this.failure);
    this.wake?.();
  }
  private data = (chunk: Buffer | string) => {
    if (this.failure) return;
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    if (Buffer.byteLength(this.buffer) > 512 * 1024) return this.rejectInput();
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (Buffer.byteLength(line) > 64 * 1024 || this.queue.length >= 8) return this.rejectInput();
      this.queue.push(line);
      newline = this.buffer.indexOf('\n');
    }
    if (Buffer.byteLength(this.buffer) > 64 * 1024) return this.rejectInput();
    this.wake?.();
  };
  private end = () => {
    if (this.ended) return;
    this.buffer += this.decoder.end();
    if (this.buffer.length) this.data('\n');
    this.ended = true;
    this.wake?.();
  };
  private error = () => {
    this.failure = new CliError(
      'runtime',
      'SESSION_INPUT_FAILED',
      'Session input connection failed.',
    );
    this.fail(this.failure);
    this.wake?.();
  };
  async next(signal: AbortSignal, idleMs: number): Promise<string | undefined> {
    signal.throwIfAborted();
    if (this.failure) throw this.failure;
    if (this.queue.length) return this.queue.shift();
    if (this.ended) return undefined;
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: unknown) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        this.wake = undefined;
        if (error) reject(error);
        else resolve();
      };
      const abort = () => finish(signal.reason);
      const timer = setTimeout(
        () =>
          finish(
            new CliError(
              'timeout',
              'SESSION_IDLE_TIMEOUT',
              'Session closed after input idle timeout.',
            ),
          ),
        idleMs,
      );
      this.wake = () => finish();
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    return this.next(signal, idleMs);
  }
  dispose() {
    this.input
      .off('data', this.data)
      .off('end', this.end)
      .off('error', this.error)
      .off('close', this.end);
    this.input.pause();
    this.queue = [];
    this.buffer = '';
  }
}

interface Request {
  id: string;
  method: 'snapshot' | 'act' | 'close';
  steps?: unknown;
}
export function parseSessionRequest(line: string): Request {
  const value: unknown = JSON.parse(line);
  if (!value || typeof value !== 'object') throw new Error('Invalid request');
  const record = value as Record<string, unknown>;
  if (
    record['schemaVersion'] !== 1 ||
    typeof record['id'] !== 'string' ||
    !/^[\w-]{1,64}$/.test(record['id']) ||
    !['snapshot', 'act', 'close'].includes(String(record['method'])) ||
    Object.keys(record).some(
      (key) =>
        ![
          'schemaVersion',
          'id',
          'method',
          ...(record['method'] === 'act' ? ['steps'] : []),
        ].includes(key),
    ) ||
    (record['method'] === 'act' && !Array.isArray(record['steps']))
  )
    throw new Error('Invalid request');
  return record as unknown as Request;
}

function frameResult(frame: UiDebugFrame): Result {
  const unsupported = frame.errors.some((error) => error.source === 'host:unsupported');
  const failed =
    frame.steps.some((step) => !step.ok) || frame.errors.length > 0 || frame.errorsTruncated;
  return {
    data: frame,
    ...(failed
      ? {
          error: new CliError(
            unsupported ? 'unsupported' : 'task',
            unsupported ? 'UI_DEBUG_UNSUPPORTED' : 'UI_DEBUG_FAILED',
            'Inspect the screenshot and errors; the session accepts a corrected next request.',
          ),
        }
      : {}),
  };
}

export async function runUiSession(
  args: Arguments,
  input: Readable,
  write: (text: string) => void,
  externalSignal: AbortSignal,
  loadHost: () => Promise<UiDebugHost> = loadUiDebugHost,
): Promise<number> {
  const controller = new AbortController();
  const cancel = () =>
    controller.abort(new CliError('cancelled', 'CANCELLED', 'Session cancelled.'));
  externalSignal.addEventListener('abort', cancel, { once: true });
  if (externalSignal.aborted) cancel();
  const lifetime = setTimeout(
    () =>
      controller.abort(
        new CliError('timeout', 'TIMEOUT', 'Session lifetime exceeded --timeout-ms.'),
      ),
    args.timeoutMs,
  );
  const inbox = new SessionInput(input, (error) => controller.abort(error));
  const emit = (type: 'ready' | 'response' | 'closed', id: string | null, result: Result) =>
    write(`${JSON.stringify({ ...envelope('debug session', result), type, id })}\n`);
  let result: Result;
  let terminalError: CliError | undefined;
  try {
    controller.signal.throwIfAborted();
    const host = await loadHost();
    const report = await host.runUiDebug({
      output: args.output ?? '',
      steps: [],
      defaultJourney: false,
      signal: controller.signal,
      interact: async (session) => {
        try {
          const initial = await session.snapshot();
          emit('ready', null, {
            ...frameResult(initial),
            data: {
              ...initial,
              protocol: {
                methods: ['snapshot', 'act', 'close'],
                maxRequests: 200,
                maxSteps: 200,
                idleTimeoutMs: args.idleTimeoutMs ?? 300_000,
              },
            },
          });
          const ids = new Set<string>();
          let stepCount = 0;
          for (let count = 0; count < 200; count++) {
            const line = await inbox.next(session.signal, args.idleTimeoutMs ?? 300_000);
            if (line === undefined) return;
            let request: Request;
            let steps: ReturnType<UiDebugHost['validateUiSteps']> = [];
            let id: string | null = null;
            try {
              request = parseSessionRequest(line);
              id = request.id;
              if (ids.has(id)) throw new Error('Repeated ID');
              ids.add(id);
              if (request.method === 'act') {
                steps = host.validateUiSteps({ schemaVersion: 1, steps: request.steps });
                if (stepCount + steps.length > 200) throw new Error('Step limit exceeded');
                stepCount += steps.length;
              }
            } catch {
              emit('response', id, {
                data: undefined,
                error: new CliError(
                  'usage',
                  'INVALID_SESSION_REQUEST',
                  'Use schemaVersion 1, a unique id and snapshot/act/close; act requires 1–16 valid steps (200 per session).',
                ),
              });
              continue;
            }
            if (request.method === 'close') {
              emit('response', request.id, { data: { closing: true } });
              return;
            }
            const timer = setTimeout(
              () =>
                controller.abort(
                  new CliError(
                    'timeout',
                    'SESSION_REQUEST_TIMEOUT',
                    'UI request exceeded 60 seconds.',
                  ),
                ),
              60_000,
            );
            try {
              const frame =
                request.method === 'act' ? await session.act(steps) : await session.snapshot();
              emit('response', request.id, frameResult(frame));
            } finally {
              clearTimeout(timer);
            }
          }
          throw new CliError(
            'usage',
            'SESSION_REQUEST_LIMIT',
            'Session reached its 200 request limit.',
          );
        } catch (error) {
          terminalError = controller.signal.aborted
            ? safeError(controller.signal.reason)
            : safeError(error);
          throw error;
        }
      },
    });
    const unsupported = report.errors.some((error) => error.source === 'host:unsupported');
    result = {
      data: report,
      ...(report.ok
        ? {}
        : {
            error: new CliError(
              unsupported ? 'unsupported' : 'task',
              'UI_SESSION_FAILED',
              'Session evidence includes failures; inspect report.json.',
            ),
          }),
    };
  } catch (error) {
    result = {
      data: undefined,
      error:
        error instanceof CliError
          ? error
          : new CliError(
              'runtime',
              'UI_SESSION_SETUP_FAILED',
              'Use a new output directory with an accessible parent and rebuild desktop with --mode background-debug.',
            ),
    };
  } finally {
    clearTimeout(lifetime);
    inbox.dispose();
    externalSignal.removeEventListener('abort', cancel);
  }
  if (controller.signal.aborted) result.error = safeError(controller.signal.reason);
  else if (terminalError) result.error = terminalError;
  emit('closed', null, result);
  return result.error ? EXIT_CODES[result.error.category] : 0;
}
