import { randomUUID } from 'node:crypto';
import type {
  DebugOperationCapability,
  DebugOperationEvent,
  DebugOperationEventPage,
  DebugOperationTask,
} from './contract';
import { DEBUG_OPERATIONS, type DebugOperationEntry } from './operations';

export const DEBUG_MAX_ARGUMENT_BYTES = 28 * 1024 * 1024;
export const DEBUG_MAX_ACTIVE_TASKS = 8;
export const DEBUG_MAX_RETAINED_TASKS = 32;
export const DEBUG_MAX_RETAINED_TASK_RESULT_BYTES = 64 * 1024 * 1024;
export const DEBUG_MAX_TASK_RESULT_BYTES = 31 * 1024 * 1024;
export const DEBUG_MAX_SESSION_MESSAGE_BYTES = 32 * 1024 * 1024;
export const DEBUG_MAX_STRING_BYTES = 2 * 1024 * 1024;
export const DEBUG_MAX_EVENTS = 256;
export const DEBUG_MAX_EVENT_BYTES = 512 * 1024;
export const DEBUG_MAX_EVENT_PAGE = 100;

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SENSITIVE_KEY =
  /(?:api.?key|authorization|headers?|http.?headers?|query.?params?|refresh.?token|access.?token|client.?secret|password|credential|ciphertext|secret)/i;
const MAX_DEPTH = 16;
const MAX_COLLECTION_ITEMS = 256;
const MAX_STRING_LENGTH = DEBUG_MAX_STRING_BYTES;

export interface SafeDebugValueResult {
  value: unknown;
  truncated: boolean;
  bytes: number;
  limitBytes: number;
}

export class DebugOperationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DebugOperationError';
  }
}

function scrubDebugValueText(text: string): string {
  return text
    .replace(/(\bsk-[\w-]{12,}|Bearer\s+[^\s"']+|AIzaSy[\w-]+)/gi, '[REDACTED]')
    .replace(
      /((?:http[_-]?headers?|headers?|query[_-]?params?)["']?\s*[:=]\s*)(?:\{[^}]*\}|\[[^\]]*\]|"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1[REDACTED]',
    )
    .replace(
      /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|ciphertext|authorization|client[_-]?secret|credential)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1[REDACTED]',
    )
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|key|authorization|client[_-]?secret)=)[^&\s]+/gi,
      '$1[REDACTED]',
    );
}

function scrubDebugError(text: string): string {
  return scrubDebugValueText(text).slice(0, 3000);
}

function utf8Prefix(text: string, budget: number): string {
  if (budget <= 0) return '';
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.byteLength <= budget) return text;
  let end = Math.min(buffer.length, budget);
  while (end > 0 && ((buffer[end] ?? 0) & 0xc0) === 0x80) end--;
  return buffer.subarray(0, end).toString('utf8');
}

export function safeDebugValueDetailed(
  value: unknown,
  maxBytes = DEBUG_MAX_TASK_RESULT_BYTES,
): SafeDebugValueResult {
  if (value === undefined) return { value: null, truncated: false, bytes: 0, limitBytes: maxBytes };
  const seen = new WeakSet<object>();
  let truncated = false;
  // Reserve room for an explicit truncation envelope when the business result is clipped.
  let remainingBytes = Math.max(0, maxBytes - 160);
  const inputBytes = (() => {
    try {
      return encodedBytes(value);
    } catch {
      return maxBytes + 1;
    }
  })();
  const take = (cost: number): boolean => {
    if (cost > remainingBytes) return false;
    remainingBytes -= cost;
    return true;
  };
  const clipString = (text: string): string => {
    const clean = scrubDebugValueText(text);
    const source = Buffer.from(clean, 'utf8');
    if (
      source.byteLength <= MAX_STRING_LENGTH &&
      take(Buffer.byteLength(JSON.stringify(clean), 'utf8'))
    )
      return clean;
    truncated = true;
    const available = Math.min(MAX_STRING_LENGTH, remainingBytes);
    let clipped = utf8Prefix(clean, available);
    while (clipped && Buffer.byteLength(JSON.stringify(clipped), 'utf8') > remainingBytes) {
      const bytes = Buffer.byteLength(clipped, 'utf8');
      clipped = utf8Prefix(clipped, Math.floor(bytes * 0.75));
    }
    if (clipped) take(Buffer.byteLength(JSON.stringify(clipped), 'utf8'));
    else remainingBytes = 0;
    return clipped;
  };
  const marker = (text: string): string => {
    truncated = true;
    const cost = Buffer.byteLength(JSON.stringify(text), 'utf8');
    if (take(cost)) return text;
    remainingBytes = 0;
    return '';
  };
  const consumeJson = (current: unknown): boolean =>
    take(Buffer.byteLength(JSON.stringify(current), 'utf8'));
  const visit = (current: unknown, depth: number, key = ''): unknown => {
    if (current === undefined) return null;
    if (SENSITIVE_KEY.test(key)) return clipString('[REDACTED]');
    if (typeof current === 'string') return clipString(current);
    if (current === null || typeof current === 'boolean') {
      if (consumeJson(current)) return current;
      truncated = true;
      return null;
    }
    if (typeof current === 'number') {
      const safeNumber = Number.isFinite(current) ? current : null;
      if (consumeJson(safeNumber)) return safeNumber;
      truncated = true;
      return null;
    }
    if (typeof current !== 'object') return marker(`[${typeof current} omitted]`);
    if (depth >= MAX_DEPTH) return marker('[DEPTH_LIMIT]');
    if (seen.has(current)) return marker('[CIRCULAR]');
    seen.add(current);
    if (Array.isArray(current)) {
      if (!take(2)) {
        truncated = true;
        return [];
      }
      const output: unknown[] = [];
      const count = Math.min(current.length, MAX_COLLECTION_ITEMS);
      if (count < current.length) truncated = true;
      for (let index = 0; index < count; index++) {
        if (index > 0 && !take(1)) {
          truncated = true;
          break;
        }
        output.push(visit(current[index], depth + 1));
        if (remainingBytes <= 0) {
          if (index + 1 < count) truncated = true;
          break;
        }
      }
      return output;
    }
    if (!take(2)) {
      truncated = true;
      return {};
    }
    const record: Record<string, unknown> = {};
    let count = 0;
    for (const [property, child] of Object.entries(current)) {
      if (child === undefined) continue;
      if (FORBIDDEN_KEYS.has(property)) continue;
      if (count++ >= MAX_COLLECTION_ITEMS) {
        truncated = true;
        break;
      }
      const keyText = property.slice(0, 200);
      const keyBytes = Buffer.byteLength(JSON.stringify(keyText), 'utf8') + 1 + (count > 1 ? 1 : 0);
      if (!take(keyBytes)) {
        truncated = true;
        break;
      }
      record[keyText] = visit(child, depth + 1, property);
      if (remainingBytes <= 0) {
        if (count < Object.keys(current).length) truncated = true;
        break;
      }
    }
    return record;
  };
  const safe = visit(value, 0);
  const wrapped = truncated
    ? { value: safe, truncated: true, bytes: inputBytes, limitBytes: maxBytes }
    : safe;
  const outputBytes = Buffer.byteLength(JSON.stringify(wrapped), 'utf8');
  if (outputBytes > maxBytes) {
    const fallback = {
      value: '[RESULT_TRUNCATED]',
      truncated: true,
      bytes: inputBytes,
      limitBytes: maxBytes,
    };
    return { value: fallback, truncated: true, bytes: inputBytes, limitBytes: maxBytes };
  }
  return { value: wrapped, truncated, bytes: inputBytes, limitBytes: maxBytes };
}

export function safeDebugValue(value: unknown, maxBytes = DEBUG_MAX_TASK_RESULT_BYTES): unknown {
  return safeDebugValueDetailed(value, maxBytes).value;
}

function encodedBytes(value: unknown): number {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new DebugOperationError('INVALID_JSON', 'Operation data must be JSON serializable.');
  }
  if (json === undefined)
    throw new DebugOperationError('INVALID_JSON', 'Operation data must be JSON serializable.');
  return Buffer.byteLength(json, 'utf8');
}

function assertJsonValue(value: unknown, depth = 0): void {
  if (depth > MAX_DEPTH)
    throw new DebugOperationError(
      'INVALID_ARGUMENTS',
      'Operation arguments are too deeply nested.',
    );
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > MAX_STRING_LENGTH)
      throw new DebugOperationError('INVALID_ARGUMENTS', 'An operation string is too large.');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_COLLECTION_ITEMS)
      throw new DebugOperationError('INVALID_ARGUMENTS', 'An operation array has too many items.');
    for (const item of value) assertJsonValue(item, depth + 1);
    return;
  }
  if (typeof value !== 'object')
    throw new DebugOperationError(
      'INVALID_ARGUMENTS',
      'Operation arguments must contain only JSON data.',
    );
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new DebugOperationError(
      'INVALID_ARGUMENTS',
      'Operation objects must be plain JSON objects.',
    );
  const entries = Object.entries(value);
  if (entries.length > MAX_COLLECTION_ITEMS)
    throw new DebugOperationError('INVALID_ARGUMENTS', 'An operation object has too many fields.');
  for (const [key, child] of entries) {
    if (FORBIDDEN_KEYS.has(key))
      throw new DebugOperationError(
        'INVALID_ARGUMENTS',
        'Prototype-related argument keys are forbidden.',
      );
    assertJsonValue(child, depth + 1);
  }
}

function topLevelUnionMembers(type: string): string[] {
  const members: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | undefined;
  for (let index = 0; index < type.length; index++) {
    const character = type[index];
    if (quote) {
      if (character === '\\') index++;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{' || character === '[' || character === '(' || character === '<') depth++;
    else if (character === '}' || character === ']' || character === ')' || character === '>')
      depth = Math.max(0, depth - 1);
    else if (character === '|' && depth === 0) {
      members.push(type.slice(start, index).trim());
      start = index + 1;
    }
  }
  members.push(type.slice(start).trim());
  return members;
}

function parameterAllowsNull(parameter: DebugOperationEntry['parameters'][number]): boolean {
  const typeMembers = topLevelUnionMembers(parameter.type);
  const definitionMembers = parameter.definition ? topLevelUnionMembers(parameter.definition) : [];
  return [...typeMembers, ...definitionMembers].some((member) =>
    /^(?:null|undefined|unknown|any)$/.test(member),
  );
}

function matchesParameter(
  value: unknown,
  parameter: DebugOperationEntry['parameters'][number],
): boolean {
  const normalized = parameter.type.trim().replace(/\s+/g, ' ');
  if (value === null) return parameterAllowsNull(parameter);
  if (normalized === 'unknown' || normalized === 'any') return true;
  if (/\bstring\b/.test(normalized) || /^['"].*['"](?:\s*\|.*)?$/.test(normalized))
    return typeof value === 'string';
  if (/\bnumber\b/.test(normalized)) return typeof value === 'number' && Number.isFinite(value);
  if (/\bboolean\b/.test(normalized)) return typeof value === 'boolean';
  if (/\b(?:array|unknown\[\]|[A-Za-z_$][\w$]*\[\])\b/i.test(normalized))
    return Array.isArray(value);
  if (/\bobject\b/.test(normalized) || normalized.startsWith('{') || normalized.includes('Record<'))
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  return true;
}

export function validateDebugOperation(
  operationName: string,
  rawArgs: unknown,
  modelMode?: 'fixture' | 'live',
  catalog: readonly DebugOperationEntry[] = DEBUG_OPERATIONS,
): { operation: DebugOperationEntry; args: unknown[] } {
  const operation = catalog.find((entry) => entry.name === operationName);
  if (!operation) throw new DebugOperationError('OPERATION_UNKNOWN', 'Unknown debug operation.');
  if (operation.kind !== 'call')
    throw new DebugOperationError('OPERATION_KIND', 'This operation is an event subscription.');
  if (operation.mode === 'unsupported')
    throw new DebugOperationError(
      'OPERATION_UNSUPPORTED',
      operation.reason ?? 'Operation is unavailable.',
    );
  if (operation.mode === 'model' && !modelMode)
    throw new DebugOperationError(
      'MODEL_MODE_REQUIRED',
      'Select fixture or live model mode for this operation.',
    );
  if (operation.mode === 'live' && modelMode !== 'live')
    throw new DebugOperationError(
      'LIVE_MODE_REQUIRED',
      'This operation requires explicit live model mode.',
    );
  if (!Array.isArray(rawArgs))
    throw new DebugOperationError('INVALID_ARGUMENTS', 'Operation args must be an array.');
  if (rawArgs.length > operation.parameters.length)
    throw new DebugOperationError('INVALID_ARGUMENTS', 'Operation received too many arguments.');
  for (let index = 0; index < operation.parameters.length; index++) {
    const parameter = operation.parameters[index];
    if (!parameter) continue;
    const value = rawArgs[index];
    if (value === undefined && !parameter.required) continue;
    if (value === undefined || !matchesParameter(value, parameter))
      throw new DebugOperationError(
        'INVALID_ARGUMENTS',
        `Argument ${parameter.name} must match the declared ${parameter.type} type.`,
      );
    assertJsonValue(value);
  }
  if (encodedBytes(rawArgs) > DEBUG_MAX_ARGUMENT_BYTES)
    throw new DebugOperationError('ARGUMENTS_TOO_LARGE', 'Operation arguments exceed 28 MiB.');
  return { operation, args: rawArgs };
}

export function debugOperationCapabilities(
  modelMode?: 'fixture' | 'live',
  catalog: readonly DebugOperationEntry[] = DEBUG_OPERATIONS,
): DebugOperationCapability[] {
  return catalog.map((operation) => ({
    name: operation.name,
    channel: operation.channel,
    kind: operation.kind,
    domain: operation.domain,
    mode: operation.mode,
    available:
      operation.mode === 'local' ||
      (operation.mode === 'model' && modelMode !== undefined) ||
      (operation.mode === 'live' && modelMode === 'live'),
    ...(operation.reason ? { reason: operation.reason } : {}),
    parameters: operation.parameters.map((parameter) => ({ ...parameter })),
  }));
}

export type DebugOperationInvoker = (
  operation: DebugOperationEntry,
  args: unknown[],
) => Promise<unknown>;

interface StoredTask {
  public: DebugOperationTask;
  resultBytes?: number;
  cancelGenerationId?: string;
}

interface PageDebugGlobal extends Record<string, unknown> {
  codesign?: Record<string, unknown>;
  __codesignDebugEventV1?: (event: { operation: string; data: unknown }) => Promise<void>;
  __codesignDebugDisposersV1?: (() => void)[];
}

export class DebugOperationClient {
  private readonly tasks = new Map<string, StoredTask>();
  private readonly eventRing: { event: DebugOperationEvent; bytes: number }[] = [];
  private nextCursor = 1;
  private droppedEvents = 0;
  private callCount = 0;
  private completedCount = 0;
  private failedCount = 0;
  private cancelledCount = 0;

  constructor(
    private readonly modelMode: 'fixture' | 'live' | undefined,
    private readonly invoke: DebugOperationInvoker,
    private readonly catalog: readonly DebugOperationEntry[] = DEBUG_OPERATIONS,
    private readonly now: () => Date = () => new Date(),
    private readonly makeId: () => string = randomUUID,
  ) {}

  capabilities(): DebugOperationCapability[] {
    return debugOperationCapabilities(this.modelMode, this.catalog);
  }

  eventNames(): string[] {
    return this.capabilities()
      .filter((entry) => entry.kind === 'event' && entry.available)
      .map((entry) => entry.name);
  }

  call(name: string, args: unknown[] = []): DebugOperationTask {
    const { operation, args: checkedArgs } = validateDebugOperation(
      name,
      args,
      this.modelMode,
      this.catalog,
    );
    const active = [...this.tasks.values()].filter(
      ({ public: task }) => task.status === 'running',
    ).length;
    if (active >= DEBUG_MAX_ACTIVE_TASKS)
      throw new DebugOperationError(
        'TASK_LIMIT',
        'The session already has eight active operations.',
      );
    const id = this.makeId();
    const task: DebugOperationTask = {
      taskId: id,
      operation: name,
      status: 'running',
      startedAt: this.now().toISOString(),
    };
    const firstArgument = checkedArgs[0];
    const generationId =
      name === 'generate' &&
      typeof firstArgument === 'object' &&
      firstArgument !== null &&
      typeof (firstArgument as Record<string, unknown>)['generationId'] === 'string'
        ? ((firstArgument as Record<string, unknown>)['generationId'] as string)
        : undefined;
    this.tasks.set(id, {
      public: task,
      ...(generationId ? { cancelGenerationId: generationId } : {}),
    });
    this.callCount++;
    this.appendEvent('operation.started', name, { taskId: id });
    const failTask = (issue: unknown) => {
      if (task.status !== 'running') return;
      const status = task.cancellationRequested ? 'cancelled' : 'failed';
      let finishedAt: string;
      try {
        finishedAt = this.now().toISOString();
      } catch {
        finishedAt = new Date().toISOString();
      }
      let code = 'OPERATION_FAILED';
      let message = 'Operation failed; inspect the sanitized application logs.';
      try {
        if (issue instanceof DebugOperationError) code = issue.code;
        if (issue instanceof Error) message = scrubDebugError(issue.message);
      } catch {
        code = 'OPERATION_FAILED';
        message = 'Operation failed.';
      }
      task.status = status;
      task.finishedAt = finishedAt;
      task.error = { code, message };
      if (status === 'cancelled') this.cancelledCount++;
      else this.failedCount++;
      this.appendEvent(`operation.${status}`, name, { taskId: id, code });
      this.pruneTasks();
    };
    void Promise.resolve()
      .then(() => this.invoke(operation, checkedArgs))
      .then((result) => {
        let safe: SafeDebugValueResult;
        let finishedAt: string;
        let resultBytes: number;
        try {
          safe = safeDebugValueDetailed(result, DEBUG_MAX_TASK_RESULT_BYTES);
          resultBytes = encodedBytes(safe.value);
          finishedAt = this.now().toISOString();
        } catch (issue) {
          failTask(issue);
          return;
        }
        const status = task.cancellationRequested ? 'cancelled' : 'completed';
        task.status = status;
        task.finishedAt = finishedAt;
        task.result = safe.value;
        const stored = this.tasks.get(id);
        if (stored) stored.resultBytes = resultBytes;
        if (status === 'cancelled') this.cancelledCount++;
        else this.completedCount++;
        this.appendEvent(`operation.${status}`, name, { taskId: id });
        this.pruneTasks();
      }, failTask)
      .catch(failTask);
    return { ...task };
  }

  task(taskId: string): DebugOperationTask {
    const task = this.tasks.get(taskId)?.public;
    if (!task) throw new DebugOperationError('TASK_UNKNOWN', 'Unknown or expired operation task.');
    return safeDebugValue(task, DEBUG_MAX_TASK_RESULT_BYTES + 4096) as DebugOperationTask;
  }

  async cancel(taskId: string): Promise<DebugOperationTask> {
    const stored = this.tasks.get(taskId);
    if (!stored)
      throw new DebugOperationError('TASK_UNKNOWN', 'Unknown or expired operation task.');
    if (stored.public.status !== 'running') return this.task(taskId);
    if (!stored.cancelGenerationId)
      throw new DebugOperationError(
        'TASK_NOT_CANCELLABLE',
        'Only an active generation task can be cancelled through this protocol.',
      );
    const cancelOperation = this.catalog.find((entry) => entry.name === 'cancelGeneration');
    if (!cancelOperation)
      throw new DebugOperationError(
        'CANCEL_UNAVAILABLE',
        'Generation cancellation is unavailable.',
      );
    validateDebugOperation(
      'cancelGeneration',
      [stored.cancelGenerationId],
      this.modelMode,
      this.catalog,
    );
    // The generation invoke is queued in a microtask; let it enter the renderer before IPC cancel.
    await Promise.resolve();
    if (stored.public.status !== 'running') return this.task(taskId);
    await this.invoke(cancelOperation, [stored.cancelGenerationId]);
    stored.public.cancellationRequested = true;
    this.appendEvent('operation.cancel-requested', stored.public.operation, { taskId });
    return this.task(taskId);
  }

  recordApplicationEvent(name: string, data: unknown): void {
    const operation = this.catalog.find((entry) => entry.name === name);
    if (!operation || operation.kind !== 'event' || operation.mode === 'unsupported') return;
    this.appendEvent('application.event', name, { value: data });
  }

  events(after = 0, limit = DEBUG_MAX_EVENT_PAGE): DebugOperationEventPage {
    if (!Number.isSafeInteger(after) || after < 0 || after >= this.nextCursor)
      throw new DebugOperationError(
        'INVALID_EVENT_CURSOR',
        'Event cursor is outside this session.',
      );
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > DEBUG_MAX_EVENT_PAGE)
      throw new DebugOperationError('INVALID_EVENT_LIMIT', 'Event limit must be from 1 to 100.');
    const first = this.eventRing[0]?.event.cursor ?? this.nextCursor;
    const cursorGap = Math.max(0, first - after - 1);
    const events = this.eventRing
      .filter(({ event }) => event.cursor > after)
      .slice(0, limit)
      .map(({ event }) => event);
    return {
      after,
      cursor: events.at(-1)?.cursor ?? Math.min(Math.max(after, first - 1), this.nextCursor - 1),
      dropped: cursorGap,
      events,
    };
  }

  summary(): {
    calls: number;
    active: number;
    completed: number;
    failed: number;
    cancelled: number;
    eventsDropped: number;
  } {
    return {
      calls: this.callCount,
      active: [...this.tasks.values()].filter(({ public: task }) => task.status === 'running')
        .length,
      completed: this.completedCount,
      failed: this.failedCount,
      cancelled: this.cancelledCount,
      eventsDropped: this.droppedEvents,
    };
  }

  private appendEvent(type: string, operation: string, data?: unknown): void {
    try {
      const safeData = data === undefined ? undefined : safeDebugValue(data, 8192);
      let event: DebugOperationEvent = {
        cursor: this.nextCursor++,
        type,
        operation,
        at: this.now().toISOString(),
        ...(safeData === undefined ? {} : { data: safeData }),
      };
      let bytes = encodedBytes(event);
      if (bytes > 8192) {
        event = { ...event, data: { truncated: true, bytes } };
        bytes = encodedBytes(event);
      }
      this.eventRing.push({ event, bytes });
      while (
        this.eventRing.length > DEBUG_MAX_EVENTS ||
        this.eventRing.reduce((total, entry) => total + entry.bytes, 0) > DEBUG_MAX_EVENT_BYTES
      ) {
        this.eventRing.shift();
        this.droppedEvents++;
      }
    } catch {
      this.droppedEvents++;
    }
  }

  private pruneTasks(): void {
    const completed = [...this.tasks.entries()].filter(
      ([, stored]) => stored.public.status !== 'running',
    );
    let retainedResultBytes = completed.reduce(
      (total, [, stored]) => total + (stored.resultBytes ?? 0),
      0,
    );
    while (
      completed.length > DEBUG_MAX_RETAINED_TASKS ||
      retainedResultBytes > DEBUG_MAX_RETAINED_TASK_RESULT_BYTES
    ) {
      const [id, stored] = completed.shift() ?? [];
      if (id) this.tasks.delete(id);
      retainedResultBytes -= stored?.resultBytes ?? 0;
    }
  }
}

export function assertKnownOperationPath(
  name: string,
  catalog: readonly DebugOperationEntry[] = DEBUG_OPERATIONS,
): void {
  if (!catalog.some((operation) => operation.name === name))
    throw new DebugOperationError('OPERATION_UNKNOWN', 'Unknown debug operation.');
  if (
    name.split('.').some((part) => !/^[A-Za-z][A-Za-z0-9]*$/.test(part) || FORBIDDEN_KEYS.has(part))
  )
    throw new DebugOperationError('OPERATION_UNKNOWN', 'Unknown debug operation.');
}

export interface PageOperationInput {
  name: string;
  args: unknown[];
  allowedNames: string[];
}

/** This function is serialized by Puppeteer; keep it closure-free and only call allowlisted APIs. */
export async function invokeCodesignOperationInPage(input: PageOperationInput): Promise<unknown> {
  const forbidden = ['__proto__', 'prototype', 'constructor'];
  if (!input.allowedNames.includes(input.name)) throw new Error('OPERATION_UNKNOWN');
  const root = (globalThis as unknown as PageDebugGlobal).codesign;
  if (!root) throw new Error('OPERATION_API_UNAVAILABLE');
  if (input.name.startsWith('test.')) {
    const adapter = Object.getOwnPropertyDescriptor(root, 'debugOperation')?.value;
    if (typeof adapter !== 'function') throw new Error('TEST_ADAPTER_UNAVAILABLE');
    return await Reflect.apply(adapter, root, [{ operation: input.name, args: input.args }]);
  }
  let receiver: Record<string, unknown> = root;
  const parts = input.name.split('.');
  for (const part of parts.slice(0, -1)) {
    if (forbidden.includes(part) || !/^[A-Za-z][A-Za-z0-9]*$/.test(part))
      throw new Error('OPERATION_UNKNOWN');
    const descriptor = Object.getOwnPropertyDescriptor(receiver, part);
    if (
      !descriptor ||
      !('value' in descriptor) ||
      !descriptor.value ||
      typeof descriptor.value !== 'object'
    )
      throw new Error('OPERATION_UNKNOWN');
    receiver = descriptor.value as Record<string, unknown>;
  }
  const methodName = parts.at(-1);
  if (!methodName || forbidden.includes(methodName) || !/^[A-Za-z][A-Za-z0-9]*$/.test(methodName))
    throw new Error('OPERATION_UNKNOWN');
  const descriptor = Object.getOwnPropertyDescriptor(receiver, methodName);
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function')
    throw new Error('OPERATION_UNKNOWN');
  return await Reflect.apply(descriptor.value, receiver, input.args);
}

export interface PageEventSubscriptionInput {
  names: string[];
  allowedNames: string[];
}

/** Install only catalogue event wrappers; the returned disposer is owned by this page. */
export function subscribeCodesignEventsInPage(input: PageEventSubscriptionInput): string[] {
  const forbidden = ['__proto__', 'prototype', 'constructor'];
  const pageGlobal = globalThis as unknown as PageDebugGlobal;
  const root = pageGlobal.codesign;
  if (!root) throw new Error('OPERATION_API_UNAVAILABLE');
  const bridge = pageGlobal;
  if (!bridge.__codesignDebugEventV1) throw new Error('EVENT_BRIDGE_UNAVAILABLE');
  if (bridge.__codesignDebugDisposersV1) return [];
  const disposers: (() => void)[] = [];
  const failed: string[] = [];
  for (const name of input.names) {
    if (!input.allowedNames.includes(name)) {
      failed.push(name);
      continue;
    }
    let receiver: Record<string, unknown> = root;
    const parts = name.split('.');
    let valid = true;
    for (const part of parts.slice(0, -1)) {
      const descriptor = Object.getOwnPropertyDescriptor(receiver, part);
      if (
        forbidden.includes(part) ||
        !descriptor ||
        !('value' in descriptor) ||
        !descriptor.value ||
        typeof descriptor.value !== 'object'
      ) {
        valid = false;
        break;
      }
      receiver = descriptor.value as Record<string, unknown>;
    }
    const methodName = parts.at(-1);
    const methodDescriptor = methodName
      ? Object.getOwnPropertyDescriptor(receiver, methodName)
      : undefined;
    if (
      !valid ||
      !methodName ||
      forbidden.includes(methodName) ||
      !methodDescriptor ||
      !('value' in methodDescriptor) ||
      typeof methodDescriptor.value !== 'function'
    ) {
      failed.push(name);
      continue;
    }
    try {
      const disposer = Reflect.apply(methodDescriptor.value, receiver, [
        (data: unknown) => {
          void bridge.__codesignDebugEventV1?.({ operation: name, data }).catch(() => undefined);
        },
      ]);
      if (typeof disposer === 'function') disposers.push(disposer as () => void);
      else failed.push(name);
    } catch {
      failed.push(name);
    }
  }
  Object.defineProperty(bridge, '__codesignDebugDisposersV1', {
    configurable: true,
    value: disposers,
  });
  return failed;
}

export function cleanupCodesignEventsInPage(): void {
  const bridge = globalThis as unknown as PageDebugGlobal;
  for (const dispose of bridge.__codesignDebugDisposersV1 ?? []) {
    try {
      dispose();
    } catch {
      // Disposing an event subscription is best-effort during page teardown.
    }
  }
  delete bridge.__codesignDebugDisposersV1;
}
