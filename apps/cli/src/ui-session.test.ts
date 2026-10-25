import { PassThrough } from 'node:stream';
import { validatePreviewInput } from '@open-codesign/core';
import { describe, expect, it } from 'vitest';
import type { UiDebugFrame, UiDebugHost, UiDebugReport } from '../../desktop/src/debug/contract';
import { parseArguments } from './arguments';
import { MAX_SESSION_MESSAGE_BYTES, parseSessionRequest, runUiSession } from './ui-session';

const frame = (): UiDebugFrame => ({
  screenshot: 'test.png',
  elements: [],
  elementsTruncated: false,
  steps: [],
  errors: [],
  errorCount: 0,
  errorsTruncated: false,
  windows: { platform: 'test', available: false },
});
function harness(
  extraArgs: string[] = [],
  includeOperations = true,
  capabilityCount = 1,
  capabilityReasonLength = 128,
) {
  const input = new PassThrough();
  const controller = new AbortController();
  const messages: Record<string, unknown>[] = [];
  let notify: (() => void) | undefined;
  let cleaned = false;
  let actions = 0;
  const host: UiDebugHost = {
    loadUiSteps: async () => [],
    validateUiSteps: (input) => {
      const record = input as { steps: Parameters<UiDebugHost['runUiDebug']>[0]['steps'] };
      validatePreviewInput({ path: 'desktop-ui', steps: record.steps });
      if (!record.steps.length) throw new Error('Empty steps');
      return record.steps;
    },
    runUiDebug: async (options) => {
      const report: UiDebugReport = {
        schemaVersion: 1,
        ok: true,
        host: 'electron-offscreen',
        screenshots: [],
        steps: [],
        errors: [],
        errorsTruncated: false,
        windows: { platform: 'test', available: false },
        persistedDesigns: 0,
        workspacesContained: true,
        cleanup: false,
      };
      try {
        await options.interact?.({
          signal: options.signal,
          snapshot: async () => frame(),
          act: async () => {
            actions++;
            return frame();
          },
          ...(includeOperations
            ? {
                capabilities: () =>
                  Array.from({ length: capabilityCount }, (_, index) => ({
                    name: capabilityCount === 1 ? 'files.read' : `files.read.${index}`,
                    channel: 'files:read',
                    kind: 'call' as const,
                    domain: 'files',
                    mode: 'local' as const,
                    available: true,
                    reason: 'x'.repeat(capabilityReasonLength),
                    parameters: [],
                  })),
                call: (operation: string, args: unknown[]) => {
                  if (operation !== 'files.read')
                    throw Object.assign(new Error('do not expose arbitrary messages'), {
                      code: 'OPERATION_UNKNOWN',
                    });
                  return {
                    taskId: 'task-1',
                    operation,
                    status: 'running' as const,
                    startedAt: new Date(0).toISOString(),
                    args,
                  };
                },
                task: (taskId: string) => {
                  if (taskId !== 'task-1')
                    throw Object.assign(new Error('do not expose arbitrary messages'), {
                      code: 'TASK_UNKNOWN',
                    });
                  return {
                    taskId,
                    operation: 'files.read',
                    status: 'completed' as const,
                    startedAt: new Date(0).toISOString(),
                    finishedAt: new Date(1).toISOString(),
                    result: 'content',
                  };
                },
                cancel: async (taskId: string) => {
                  if (taskId !== 'task-1')
                    throw Object.assign(new Error('do not expose arbitrary messages'), {
                      code: 'TASK_UNKNOWN',
                    });
                  return {
                    taskId,
                    operation: 'files.read',
                    status: 'running' as const,
                    startedAt: new Date(0).toISOString(),
                    cancellationRequested: true,
                  };
                },
                events: (after: number, limit = 100) => ({
                  after,
                  cursor: after + 1,
                  dropped: 0,
                  events: [
                    {
                      cursor: after + 1,
                      type: 'operation.started',
                      operation: 'files.read',
                      at: new Date(0).toISOString(),
                    },
                  ].slice(0, limit),
                }),
              }
            : {}),
        });
      } catch {
        report.ok = false;
      } finally {
        cleaned = true;
        report.cleanup = true;
      }
      return report;
    },
  };
  const args = parseArguments(['debug', 'session', '--output', 'test-output', ...extraArgs]);
  const done = runUiSession(
    args,
    input,
    (line) => {
      messages.push(JSON.parse(line) as Record<string, unknown>);
      notify?.();
    },
    controller.signal,
    async () => host,
  );
  return {
    input,
    controller,
    messages,
    done,
    get cleaned() {
      return cleaned;
    },
    get actions() {
      return actions;
    },
    send: (id: string, method: string, steps?: unknown) =>
      input.write(
        `${JSON.stringify({ schemaVersion: 1, id, method, ...(steps === undefined ? {} : { steps }) })}\n`,
      ),
    sendRequest: (request: Record<string, unknown>) => input.write(`${JSON.stringify(request)}\n`),
    async until(count: number) {
      while (messages.length < count)
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      notify = undefined;
    },
  };
}

it('exposes bounded JSONL sessions separately from batch commands', () => {
  expect(parseArguments(['debug', 'session', '--output', 'new'])).toMatchObject({
    json: true,
    timeoutMs: 1_800_000,
    idleTimeoutMs: 300_000,
  });
  for (const args of [
    [],
    ['--steps', 'x'],
    ['--idle-timeout-ms', 'NaN'],
    ['--idle-timeout-ms', '0'],
  ])
    expect(() =>
      parseArguments(['debug', 'session', ...(args.length ? ['--output', 'x', ...args] : [])]),
    ).toThrow();
  expect(() => parseArguments(['doctor', '--idle-timeout-ms', '1'])).toThrow();
});

it.each([
  '{}',
  'null',
  '{"schemaVersion":1,"id":"x","method":"eval"}',
  '{"schemaVersion":1,"id":"x","method":"snapshot","code":"secret"}',
  '{"schemaVersion":1,"id":"x","method":"call","operation":"files.read","code":"secret"}',
  '{"schemaVersion":1,"id":"x","method":"events","after":-1}',
  '{"schemaVersion":1,"id":"x","method":"task","taskId":"bad id"}',
])('rejects invalid protocol requests without executing them: %s', (line) =>
  expect(() => parseSessionRequest(line)).toThrow());

it('preserves multi-byte input, rejects duplicate IDs and invalid steps, and continues sequentially', async () => {
  const run = harness();
  await run.until(1);
  const line = Buffer.from(
    `${JSON.stringify({ schemaVersion: 1, id: 'fill', method: 'act', steps: [{ action: 'fill', selector: 'textarea', value: '你好' }] })}\n`,
  );
  const split = line.indexOf(Buffer.from('你好')) + 1;
  run.input.write(line.subarray(0, split));
  run.input.write(line.subarray(split));
  await run.until(2);
  run.send('fill', 'act', [{ action: 'click', selector: 'button' }]);
  run.send('bad', 'act', [{ action: 'eval', code: 'secret-sentinel' }]);
  run.send('snapshot', 'snapshot');
  await run.until(5);
  run.send('close', 'close');
  expect(await run.done).toBe(0);
  expect(run.actions).toBe(1);
  expect(run.messages.map((message) => [message['type'], message['id'], message['ok']])).toEqual([
    ['ready', null, true],
    ['response', 'fill', true],
    ['response', 'fill', false],
    ['response', 'bad', false],
    ['response', 'snapshot', true],
    ['response', 'close', true],
    ['closed', null, true],
  ]);
  expect(JSON.stringify(run.messages)).not.toContain('secret-sentinel');
  expect(run.cleaned).toBe(true);
});

it('exposes operation capabilities, async calls, task state, cancellation, and events over JSONL', async () => {
  const run = harness();
  await run.until(1);
  run.sendRequest({ schemaVersion: 1, id: 'caps', method: 'capabilities' });
  run.sendRequest({
    schemaVersion: 1,
    id: 'call',
    method: 'call',
    operation: 'files.read',
    args: ['App.jsx'],
  });
  run.sendRequest({ schemaVersion: 1, id: 'task', method: 'task', taskId: 'task-1' });
  run.sendRequest({ schemaVersion: 1, id: 'cancel', method: 'cancel', taskId: 'task-1' });
  run.sendRequest({ schemaVersion: 1, id: 'events', method: 'events', after: 0, limit: 10 });
  await run.until(6);
  run.sendRequest({ schemaVersion: 1, id: 'bad-op', method: 'call', operation: 'constructor' });
  await run.until(7);
  run.send('close', 'close');
  expect(await run.done).toBe(0);
  expect(run.messages[1]).toMatchObject({
    type: 'response',
    id: 'caps',
    data: { operations: [{ name: 'files.read', kind: 'call' }] },
  });
  expect(run.messages[2]).toMatchObject({
    type: 'response',
    id: 'call',
    data: { status: 'running' },
  });
  expect(run.messages[3]).toMatchObject({
    type: 'response',
    id: 'task',
    data: { result: 'content' },
  });
  expect(run.messages[4]).toMatchObject({
    type: 'response',
    id: 'cancel',
    data: { cancellationRequested: true },
  });
  expect(run.messages[5]).toMatchObject({ type: 'response', id: 'events', data: { cursor: 1 } });
  expect(run.messages[6]).toMatchObject({
    type: 'response',
    id: 'bad-op',
    error: { code: 'OPERATION_UNKNOWN', message: 'Unknown debug operation.' },
  });
});

it('keeps compatibility with hosts that implement only snapshot/act/close', async () => {
  const run = harness([], false);
  await run.until(1);
  expect(
    (run.messages[0]?.['data'] as { protocol: { methods: string[] } }).protocol.methods,
  ).toEqual(['snapshot', 'act', 'close']);
  run.sendRequest({ schemaVersion: 1, id: 'caps', method: 'capabilities' });
  await run.until(2);
  expect(run.messages[1]).toMatchObject({
    type: 'response',
    id: 'caps',
    error: { code: 'SESSION_METHOD_UNSUPPORTED' },
  });
  run.send('close', 'close');
  expect(await run.done).toBe(0);
});

it('accepts large JSONL calls and responses above the former 64 KiB and 1 MiB limits', async () => {
  const run = harness();
  await run.until(1);
  const content = 'x'.repeat(2 * 1024 * 1024);
  run.sendRequest({
    schemaVersion: 1,
    id: 'large',
    method: 'call',
    operation: 'files.read',
    args: [content],
  });
  await run.until(2);
  const response = run.messages[1];
  expect(response).toMatchObject({
    type: 'response',
    id: 'large',
    ok: true,
  });
  expect((response?.['data'] as { args: unknown[] }).args[0]).toBe(content);
  expect(Buffer.byteLength(JSON.stringify(response), 'utf8')).toBeGreaterThan(1024 * 1024);
  run.send('close', 'close');
  await run.done;
});

it('caps JSONL responses above 32 MiB with a fixed safe error', async () => {
  const run = harness([], true, 1, MAX_SESSION_MESSAGE_BYTES);
  await run.until(1);
  run.sendRequest({ schemaVersion: 1, id: 'large', method: 'capabilities' });
  await run.until(2);
  expect(run.messages[1]).toMatchObject({
    type: 'response',
    id: 'large',
    error: { code: 'SESSION_RESPONSE_TOO_LARGE' },
  });
  run.send('close', 'close');
  await run.done;
  expect(Buffer.byteLength(JSON.stringify(run.messages[1]), 'utf8')).toBeLessThan(1024 * 1024);
});

it('drains queued commands on EOF then cleans up', async () => {
  const run = harness();
  run.send('one', 'snapshot');
  run.input.end();
  expect(await run.done).toBe(0);
  expect(run.messages.map((message) => message['type'])).toEqual(['ready', 'response', 'closed']);
  expect(run.cleaned).toBe(true);
});

describe('terminal conditions preserve cleanup and stable codes', () => {
  it.each([
    ['idle', 124],
    ['lifetime', 124],
    ['cancel', 130],
    ['overlarge', 2],
    ['queue', 2],
    ['input-error', 4],
  ] as const)('%s', async (reason, code) => {
    const run = harness(
      reason === 'idle'
        ? ['--idle-timeout-ms', '20']
        : reason === 'lifetime'
          ? ['--timeout-ms', '20']
          : [],
    );
    await run.until(1);
    if (reason === 'cancel') run.controller.abort();
    if (reason === 'overlarge') run.input.write('x'.repeat(MAX_SESSION_MESSAGE_BYTES + 1));
    if (reason === 'queue')
      run.input.write(
        `${Array.from({ length: 10 }, (_, index) =>
          JSON.stringify({ schemaVersion: 1, id: String(index), method: 'snapshot' }),
        ).join('\n')}\n`,
      );
    if (reason === 'input-error') run.input.destroy(new Error('secret-sentinel'));
    expect(await run.done).toBe(code);
    expect(run.messages.at(-1)).toMatchObject({
      type: 'closed',
      ok: false,
      data: { cleanup: true },
      error: { exitCode: code },
    });
    expect(JSON.stringify(run.messages)).not.toContain('secret-sentinel');
    expect(run.cleaned).toBe(true);
  });
});
