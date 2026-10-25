import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertKnownOperationPath,
  cleanupCodesignEventsInPage,
  DEBUG_MAX_ACTIVE_TASKS,
  DEBUG_MAX_ARGUMENT_BYTES,
  DEBUG_MAX_SESSION_MESSAGE_BYTES,
  DEBUG_MAX_STRING_BYTES,
  DEBUG_MAX_TASK_RESULT_BYTES,
  DebugOperationClient,
  DebugOperationError,
  debugOperationCapabilities,
  invokeCodesignOperationInPage,
  safeDebugValueDetailed,
  subscribeCodesignEventsInPage,
  validateDebugOperation,
} from './operation-client';
import { DEBUG_OPERATIONS, type DebugOperationEntry } from './operations';

const operation = (
  name: string,
  parameters: DebugOperationEntry['parameters'] = [],
  mode: DebugOperationEntry['mode'] = 'local',
): DebugOperationEntry => ({
  name,
  kind: 'call',
  channel: `test:${name}`,
  domain: 'test',
  mode,
  parameters,
});

const catalog: DebugOperationEntry[] = [
  operation('echo'),
  operation('nullable', [{ name: 'value', type: 'string | null', required: true }]),
  operation('payload', [
    { name: 'value', type: 'object', definition: '{nested?: string | null}', required: true },
  ]),
  operation('nullablePayload', [
    { name: 'value', type: 'object', definition: '{generationId: string} | null', required: true },
  ]),
  operation(
    'generate',
    [{ name: 'input', type: 'object', definition: '{generationId: string}', required: true }],
    'model',
  ),
  operation('cancelGeneration', [{ name: 'id', type: 'string', required: true }]),
  { ...operation('changed'), kind: 'event' },
  operation('tooBig', [{ name: 'value', type: 'string', required: true }]),
];

const flush = async () => {
  for (let index = 0; index < 8; index++) await Promise.resolve();
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('page operation bridge functions', () => {
  it('invokes only whitelisted nested wrappers with their original receiver and arguments', async () => {
    const snapshots = {
      read(this: unknown, ...args: unknown[]) {
        return { boundToSnapshots: this === snapshots, args };
      },
    };
    vi.stubGlobal('codesign', { snapshots });
    const args = ['design-7', { includeFiles: true }];
    await expect(
      invokeCodesignOperationInPage({
        name: 'snapshots.read',
        args,
        allowedNames: ['snapshots.read'],
      }),
    ).resolves.toEqual({ boundToSnapshots: true, args });
    await expect(
      invokeCodesignOperationInPage({
        name: 'snapshots.read',
        args: [],
        allowedNames: [],
      }),
    ).rejects.toThrow('OPERATION_UNKNOWN');
    await expect(
      invokeCodesignOperationInPage({
        name: 'snapshots.__proto__',
        args: [],
        allowedNames: ['snapshots.__proto__'],
      }),
    ).rejects.toThrow('OPERATION_UNKNOWN');
  });

  it('routes fixed test adapters through debugOperation', async () => {
    const debugOperation = vi.fn(async (input: unknown) => ({ accepted: input }));
    vi.stubGlobal('codesign', { debugOperation });
    const args = ['/temporary/downloads/design.html'];
    await expect(
      invokeCodesignOperationInPage({
        name: 'test.exportDestination',
        args,
        allowedNames: ['test.exportDestination'],
      }),
    ).resolves.toEqual({
      accepted: { operation: 'test.exportDestination', args },
    });
    expect(debugOperation).toHaveBeenCalledTimes(1);
  });

  it('subscribes to catalogue events, forwards payloads, and runs the disposer', () => {
    let listener: ((event: unknown) => void) | undefined;
    let disposed = 0;
    const onChanged = (callback: (event: unknown) => void) => {
      listener = callback;
      return () => {
        disposed++;
      };
    };
    const forwarded: unknown[] = [];
    vi.stubGlobal('codesign', { files: { onChanged } });
    vi.stubGlobal('__codesignDebugEventV1', async (event: unknown) => {
      forwarded.push(event);
    });

    expect(
      subscribeCodesignEventsInPage({
        names: ['files.onChanged'],
        allowedNames: ['files.onChanged'],
      }),
    ).toEqual([]);
    const payload = { designId: 'design-9' };
    listener?.(payload);
    expect(forwarded).toEqual([{ operation: 'files.onChanged', data: payload }]);
    cleanupCodesignEventsInPage();
    expect(disposed).toBe(1);
  });
});

describe('debug operation catalogue validation', () => {
  it('rejects unknown paths, event calls, unsafe names, and non-JSON arguments', () => {
    expect(() => validateDebugOperation('constructor', [], undefined, catalog)).toThrow(
      'Unknown debug operation.',
    );
    expect(() => validateDebugOperation('changed', [], undefined, catalog)).toThrow(
      'event subscription',
    );
    expect(() => assertKnownOperationPath('x.__proto__', catalog)).toThrow();
    expect(() => validateDebugOperation('echo', [undefined], undefined, catalog)).toThrow();
    expect(() => validateDebugOperation('echo', [new Date()], undefined, catalog)).toThrow();
  });

  it('enforces model modes and reports capability availability', () => {
    expect(() => validateDebugOperation('generate', [{}], undefined, catalog)).toThrow(
      'Select fixture or live model mode',
    );
    expect(
      debugOperationCapabilities(undefined, catalog).find((item) => item.name === 'generate'),
    ).toMatchObject({ available: false, mode: 'model' });
    expect(
      debugOperationCapabilities('fixture', catalog).find((item) => item.name === 'generate'),
    ).toMatchObject({ available: true, mode: 'model' });
  });

  it('accepts only top-level nullable type declarations', () => {
    expect(() => validateDebugOperation('nullable', [null], undefined, catalog)).not.toThrow();
    expect(() =>
      validateDebugOperation('nullablePayload', [null], undefined, catalog),
    ).not.toThrow();
    expect(() => validateDebugOperation('payload', [null], undefined, catalog)).toThrow();
  });

  it('enforces argument byte limits without modifying accepted arguments', () => {
    const text = 'x'.repeat(DEBUG_MAX_STRING_BYTES + 1);
    expect(() => validateDebugOperation('tooBig', [text], undefined, catalog)).toThrow(
      'An operation string is too large',
    );
    const accepted = { value: 'kept exactly' };
    const checked = validateDebugOperation('echo', [accepted], undefined, [
      operation('echo', [{ name: 'value', type: 'object', required: true }]),
    ]);
    expect(checked.args[0]).toBe(accepted);
  });

  it('accepts a full 2 MiB file and expectedContent within JSON argument budgets', () => {
    const content = '\u0000'.repeat(2 * 1024 * 1024);
    const checked = validateDebugOperation(
      'files.write',
      ['design-1', 'App.jsx', content, { expectedContent: content }],
      undefined,
      DEBUG_OPERATIONS,
    );

    expect(checked.args[2]).toBe(content);
    expect((checked.args[3] as { expectedContent: string }).expectedContent).toBe(content);
    expect(Buffer.byteLength(JSON.stringify(checked.args), 'utf8')).toBeLessThanOrEqual(
      DEBUG_MAX_ARGUMENT_BYTES,
    );
    expect(DEBUG_MAX_SESSION_MESSAGE_BYTES).toBe(32 * 1024 * 1024);
  });
});

describe('debug operation task execution', () => {
  it('preserves ask request IDs for round trips while still masking standalone API keys', () => {
    const requestId = 'ask-2b03d65f-f07d-4800-874f-5eaf233b0431';
    const secret = 'sk-12345678901234567890';
    expect(
      safeDebugValueDetailed({ requestId, message: `Question ${requestId}; key=${secret}` }).value,
    ).toEqual({ requestId, message: `Question ${requestId}; key=[REDACTED]` });
    const sensitive = JSON.stringify(safeDebugValueDetailed({ apiKey: requestId }).value);
    expect(sensitive).not.toContain(requestId);
    expect(sensitive).toContain('[REDACTED]');
  });

  it('redacts sensitive fields and returns observable truncation while preserving a bounded prefix', () => {
    const secret = 'never-show-this';
    const redacted = safeDebugValueDetailed(
      {
        apiKey: secret,
        authorization: `Bearer ${secret}`,
        queryParams: { token: secret },
        source: `a${'b'.repeat(50_000)}`,
      },
      2048,
    );
    expect(JSON.stringify(redacted.value)).not.toContain(secret);
    expect(redacted.truncated).toBe(true);
    expect(redacted.bytes).toBeGreaterThan(50_000);
    expect(redacted.limitBytes).toBe(2048);
    expect(JSON.stringify(redacted.value)).toContain('"truncated":true');
    expect(Buffer.byteLength(JSON.stringify(redacted.value), 'utf8')).toBeLessThanOrEqual(2048);
    const short = safeDebugValueDetailed({ source: 'App.jsx\nexport default 1' });
    expect(short.value).toEqual({ source: 'App.jsx\nexport default 1' });
    expect(short.truncated).toBe(false);
  });

  it.each([
    true,
    false,
  ])('preserves requiresApiKey=%s while redacting provider credentials', async (requiresApiKey) => {
    const client = new DebugOperationClient(
      undefined,
      async () => [
        {
          provider: 'selected',
          requiresApiKey,
          apiKey: 'private-sentinel',
          defaultModel: 'model',
        },
      ],
      catalog,
    );
    const started = client.call('echo');
    await flush();
    const task = client.task(started.taskId);
    expect(task).toMatchObject({
      taskId: started.taskId,
      status: 'completed',
      result: [
        {
          provider: 'selected',
          requiresApiKey,
          apiKey: '[REDACTED]',
          defaultModel: 'model',
        },
      ],
    });
    expect(task).not.toHaveProperty('truncated');
    expect(JSON.stringify(task)).not.toContain('private-sentinel');
    expect(client.task(started.taskId)).toEqual(task);
  });

  it.each([
    'files.read',
    'files.write',
  ])('preserves raw source in %s results through repeated task polling', async (name) => {
    const content =
      '<style>:root{--color-token: #123456;}</style><script>const token = "label"; const authorization = "Bearer example-label";</script>';
    const client = new DebugOperationClient(undefined, async () => ({
      content,
      apiKey: 'private-sentinel',
      metadata: { authorization: 'Bearer private-sentinel' },
    }));
    const args = name === 'files.read' ? ['design', 'App.jsx'] : ['design', 'App.jsx', content];
    const started = client.call(name, args);
    await flush();
    const task = client.task(started.taskId);
    expect(task).toMatchObject({
      status: 'completed',
      result: {
        content,
        apiKey: '[REDACTED]',
        metadata: { authorization: '[REDACTED]' },
      },
    });
    expect(client.task(started.taskId)).toEqual(task);
    expect(safeDebugValueDetailed({ content: 'Bearer private-sentinel' }).value).toEqual({
      content: '[REDACTED]',
    });
  });

  it('preserves a 2 MiB file result and represents void results using JSON null semantics', async () => {
    const content = 'x'.repeat(2 * 1024 * 1024);
    const fileResult = {
      path: 'App.jsx',
      kind: 'text',
      size: Buffer.byteLength(content),
      updatedAt: new Date(0).toISOString(),
      content,
    };
    const safeFileResult = safeDebugValueDetailed(fileResult, DEBUG_MAX_TASK_RESULT_BYTES);
    expect(safeFileResult.truncated).toBe(false);
    expect(safeFileResult.value).toEqual(fileResult);

    expect(safeDebugValueDetailed(undefined)).toEqual({
      value: null,
      truncated: false,
      bytes: 0,
      limitBytes: DEBUG_MAX_TASK_RESULT_BYTES,
    });
    expect(safeDebugValueDetailed({ optional: undefined, values: [undefined] }).value).toEqual({
      values: [null],
    });

    const client = new DebugOperationClient(undefined, async () => undefined, catalog);
    const task = client.call('echo');
    await flush();
    expect(client.task(task.taskId)).toMatchObject({ status: 'completed', result: null });
    expect(client.summary()).toMatchObject({ completed: 1, failed: 0, active: 0 });
  });

  it('marks returned rejections and sanitizer failures as failed tasks without escaping callbacks', async () => {
    const rejectClient = new DebugOperationClient(
      undefined,
      async () => {
        throw new DebugOperationError('CONTROLLED', 'controlled failure');
      },
      catalog,
    );
    const rejected = rejectClient.call('echo');
    await flush();
    expect(rejectClient.task(rejected.taskId)).toMatchObject({
      status: 'failed',
      error: { code: 'CONTROLLED', message: 'controlled failure' },
    });

    const secret = 'sk-12345678901234567890';
    const validationClient = new DebugOperationClient(
      undefined,
      async () => {
        throw new Error(`Preview validation failed for request apiKey=${secret}`);
      },
      catalog,
    );
    const validation = validationClient.call('echo');
    await flush();
    const validationError = validationClient.task(validation.taskId).error;
    expect(validationError?.message).toContain('Preview validation failed');
    expect(validationError?.message).toContain('[REDACTED]');
    expect(validationError?.message).not.toContain(secret);

    let clockCalls = 0;
    const sanitizerClient = new DebugOperationClient(
      undefined,
      async () => 'completed output',
      catalog,
      () => {
        clockCalls++;
        if (clockCalls === 3) throw new Error('controlled clock failure');
        return new Date();
      },
    );
    const task = sanitizerClient.call('echo');
    await flush();
    expect(sanitizerClient.task(task.taskId)).toMatchObject({ status: 'failed' });
    expect(sanitizerClient.summary()).toMatchObject({ calls: 1, active: 0, failed: 1 });
  });

  it('caps active tasks and only cancels model generation through its generation ID', async () => {
    let resolveGeneration: ((value: unknown) => void) | undefined;
    const invocationOrder: string[] = [];
    const client = new DebugOperationClient(
      'fixture',
      (entry) => {
        invocationOrder.push(entry.name);
        if (entry.name === 'generate')
          return new Promise((resolve) => {
            resolveGeneration = resolve;
          });
        return Promise.resolve(undefined);
      },
      catalog,
    );
    const running = client.call('generate', [{ generationId: 'run-1' }]);
    await expect(client.cancel(running.taskId)).resolves.toMatchObject({
      status: 'running',
      cancellationRequested: true,
    });
    expect(invocationOrder).toEqual(['generate', 'cancelGeneration']);
    resolveGeneration?.('done');
    await flush();
    expect(client.task(running.taskId)).toMatchObject({ status: 'cancelled' });

    const pending = new DebugOperationClient(undefined, () => new Promise(() => {}), catalog);
    const first = pending.call('echo');
    for (let index = 1; index < DEBUG_MAX_ACTIVE_TASKS; index++) pending.call('echo');
    expect(() => pending.call('echo')).toThrow('already has eight active operations');
    await expect(pending.cancel(first.taskId)).rejects.toMatchObject({
      code: 'TASK_NOT_CANCELLABLE',
    });
  });

  it('bounds event history and reports the dropped cursor gap', () => {
    const client = new DebugOperationClient(undefined, async () => undefined, catalog);
    for (let index = 0; index < 300; index++) client.recordApplicationEvent('changed', { index });
    const page = client.events(0, 100);
    expect(page.dropped).toBeGreaterThan(0);
    expect(page.events).toHaveLength(100);
    expect(page.cursor).toBe(page.events.at(-1)?.cursor);
    expect(client.summary().eventsDropped).toBeGreaterThan(0);
  });
});
