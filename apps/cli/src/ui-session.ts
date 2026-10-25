import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import type { UiDebugFrame, UiDebugHost } from '../../desktop/src/debug/contract';
import type { Arguments } from './arguments';
import { CliError, EXIT_CODES, envelope, type Result, safeError } from './protocol';
import { loadUiDebugHost, modelSetupError, uiLeaseError } from './ui-debug';

export const MAX_SESSION_MESSAGE_BYTES = 32 * 1024 * 1024;

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
      'JSONL input exceeds 32 MiB per message or eight queued messages.',
    );
    this.input.pause();
    this.fail(this.failure);
    this.wake?.();
  }
  private data = (chunk: Buffer | string) => {
    if (this.failure) return;
    const text = typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    let offset = 0;
    while (offset < text.length) {
      const newline = text.indexOf('\n', offset);
      if (newline < 0) {
        this.buffer += text.slice(offset);
        if (Buffer.byteLength(this.buffer, 'utf8') > MAX_SESSION_MESSAGE_BYTES)
          return this.rejectInput();
        break;
      }
      const line = this.buffer + text.slice(offset, newline);
      this.buffer = '';
      if (Buffer.byteLength(line, 'utf8') > MAX_SESSION_MESSAGE_BYTES || this.queue.length >= 8)
        return this.rejectInput();
      this.queue.push(line);
      offset = newline + 1;
    }
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
  method: 'snapshot' | 'act' | 'close' | 'capabilities' | 'call' | 'task' | 'cancel' | 'events';
  steps?: unknown;
  operation?: string;
  args?: unknown[];
  taskId?: string;
  after?: number;
  limit?: number;
}
export function parseSessionRequest(line: string): Request {
  const value: unknown = JSON.parse(line);
  if (!value || typeof value !== 'object') throw new Error('Invalid request');
  const record = value as Record<string, unknown>;
  const method = record['method'];
  const allowedKeys: Record<string, string[]> = {
    snapshot: [],
    act: ['steps'],
    close: [],
    capabilities: [],
    call: ['operation', 'args'],
    task: ['taskId'],
    cancel: ['taskId'],
    events: ['after', 'limit'],
  };
  if (
    record['schemaVersion'] !== 1 ||
    typeof record['id'] !== 'string' ||
    !/^[\w-]{1,64}$/.test(record['id']) ||
    typeof method !== 'string' ||
    !Object.hasOwn(allowedKeys, method) ||
    Object.keys(record).some(
      (key) => !['schemaVersion', 'id', 'method', ...(allowedKeys[method] ?? [])].includes(key),
    ) ||
    (method === 'act' && !Array.isArray(record['steps'])) ||
    (method === 'call' &&
      (typeof record['operation'] !== 'string' ||
        record['operation'].length > 160 ||
        (record['args'] !== undefined && !Array.isArray(record['args'])))) ||
    (['task', 'cancel'].includes(method) &&
      (typeof record['taskId'] !== 'string' || !/^[\w-]{1,64}$/.test(record['taskId']))) ||
    (method === 'events' &&
      ((record['after'] !== undefined &&
        (!Number.isSafeInteger(record['after']) || (record['after'] as number) < 0)) ||
        (record['limit'] !== undefined &&
          (!Number.isSafeInteger(record['limit']) ||
            (record['limit'] as number) < 1 ||
            (record['limit'] as number) > 100))))
  )
    throw new Error('Invalid request');
  return record as unknown as Request;
}

const MAX_SESSION_RESPONSE_BYTES = MAX_SESSION_MESSAGE_BYTES;

function operationFailure(error: unknown): CliError {
  const known = new Map<string, { category: 'task' | 'unsupported'; message: string }>([
    ['OPERATION_UNKNOWN', { category: 'task', message: 'Unknown debug operation.' }],
    ['OPERATION_KIND', { category: 'task', message: 'This operation is an event subscription.' }],
    ['OPERATION_UNSUPPORTED', { category: 'unsupported', message: 'Operation is unavailable.' }],
    [
      'MODEL_MODE_REQUIRED',
      { category: 'unsupported', message: 'Select fixture or live model mode for this operation.' },
    ],
    [
      'LIVE_MODE_REQUIRED',
      { category: 'unsupported', message: 'This operation requires explicit live model mode.' },
    ],
    ['INVALID_ARGUMENTS', { category: 'task', message: 'Operation arguments are invalid.' }],
    ['ARGUMENTS_TOO_LARGE', { category: 'task', message: 'Operation arguments exceed 28 MiB.' }],
    [
      'TASK_LIMIT',
      { category: 'task', message: 'The session already has eight active operations.' },
    ],
    ['TASK_UNKNOWN', { category: 'task', message: 'Unknown or expired operation task.' }],
    [
      'TASK_NOT_CANCELLABLE',
      {
        category: 'unsupported',
        message: 'This operation cannot be cancelled through the protocol.',
      },
    ],
    [
      'CANCEL_UNAVAILABLE',
      { category: 'unsupported', message: 'Generation cancellation is unavailable.' },
    ],
    [
      'INVALID_EVENT_CURSOR',
      { category: 'task', message: 'Event cursor is outside this session.' },
    ],
    ['INVALID_EVENT_LIMIT', { category: 'task', message: 'Event limit must be from 1 to 100.' }],
  ]);
  if (error && typeof error === 'object') {
    const code = (error as Record<string, unknown>)['code'];
    if (typeof code === 'string') {
      const detail = known.get(code);
      if (detail) return new CliError(detail.category, code, detail.message);
    }
  }
  return new CliError('task', 'OPERATION_FAILED', 'Debug operation failed.');
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
  const emit = (type: 'ready' | 'response' | 'closed', id: string | null, result: Result) => {
    const response = { ...envelope('debug session', result), type, id };
    let serialized = JSON.stringify(response);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_SESSION_RESPONSE_BYTES) {
      serialized = JSON.stringify({
        ...envelope('debug session', {
          data: undefined,
          error: new CliError(
            'task',
            'SESSION_RESPONSE_TOO_LARGE',
            'Session response exceeded the 32 MiB limit.',
          ),
        }),
        type,
        id,
      });
    }
    write(`${serialized}\n`);
  };
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
      ...(args.modelMode
        ? {
            model: {
              mode: args.modelMode,
              ...(args.config ? { config: args.config } : {}),
              ...(args.provider ? { provider: args.provider } : {}),
              ...(args.model ? { model: args.model } : {}),
              ...(args.credentialState ? { credentialState: args.credentialState } : {}),
              ...(args.codexAuth ? { codexAuth: args.codexAuth } : {}),
            },
          }
        : {}),
      interact: async (session) => {
        try {
          const initial = await session.snapshot();
          emit('ready', null, {
            ...frameResult(initial),
            data: {
              ...initial,
              protocol: {
                methods: [
                  'snapshot',
                  'act',
                  'close',
                  ...(session.capabilities
                    ? ['capabilities', 'call', 'task', 'cancel', 'events']
                    : []),
                ],
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
                  'Use schemaVersion 1, a unique id and a supported session method; act requires 1–16 valid steps (200 per session).',
                ),
              });
              continue;
            }
            if (request.method === 'close') {
              emit('response', request.id, { data: { closing: true } });
              return;
            }
            const operationMethod =
              request.method === 'capabilities' ||
              request.method === 'call' ||
              request.method === 'task' ||
              request.method === 'cancel' ||
              request.method === 'events';
            if (operationMethod) {
              try {
                if (request.method === 'capabilities') {
                  if (!session.capabilities)
                    throw new CliError(
                      'unsupported',
                      'SESSION_METHOD_UNSUPPORTED',
                      'This host does not support operation capabilities.',
                    );
                  emit('response', request.id, { data: { operations: session.capabilities() } });
                } else if (request.method === 'call') {
                  if (!session.call)
                    throw new CliError(
                      'unsupported',
                      'SESSION_METHOD_UNSUPPORTED',
                      'This host does not support operation calls.',
                    );
                  emit('response', request.id, {
                    data: session.call(request.operation ?? '', request.args ?? []),
                  });
                } else if (request.method === 'task') {
                  if (!session.task)
                    throw new CliError(
                      'unsupported',
                      'SESSION_METHOD_UNSUPPORTED',
                      'This host does not support operation tasks.',
                    );
                  emit('response', request.id, { data: session.task(request.taskId ?? '') });
                } else if (request.method === 'cancel') {
                  if (!session.cancel)
                    throw new CliError(
                      'unsupported',
                      'SESSION_METHOD_UNSUPPORTED',
                      'This host does not support task cancellation.',
                    );
                  emit('response', request.id, {
                    data: await session.cancel(request.taskId ?? ''),
                  });
                } else {
                  if (!session.events)
                    throw new CliError(
                      'unsupported',
                      'SESSION_METHOD_UNSUPPORTED',
                      'This host does not support operation events.',
                    );
                  emit('response', request.id, {
                    data: session.events(request.after ?? 0, request.limit ?? 100),
                  });
                }
              } catch (error) {
                emit('response', request.id, {
                  data: undefined,
                  error: error instanceof CliError ? error : operationFailure(error),
                });
              }
              continue;
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
            error:
              modelSetupError(report.errors) ??
              new CliError(
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
          : (uiLeaseError(error) ??
            new CliError(
              'runtime',
              'UI_SESSION_SETUP_FAILED',
              'Use a new output directory with an accessible parent and rebuild desktop with --mode background-debug.',
            )),
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
