import { PassThrough } from 'node:stream';
import { validatePreviewInput } from '@open-codesign/core';
import { describe, expect, it } from 'vitest';
import type { UiDebugFrame, UiDebugHost, UiDebugReport } from '../../desktop/src/debug/contract';
import { parseArguments } from './arguments';
import { parseSessionRequest, runUiSession } from './ui-session';

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
function harness(extraArgs: string[] = []) {
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
    if (reason === 'overlarge') run.input.write('x'.repeat(65537));
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
