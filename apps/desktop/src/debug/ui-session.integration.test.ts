import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UiDebugFrame, UiDebugReport } from './contract';
import { findPowerShell, observationPassed } from './ui-debug';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const enabled = process.env['CODESIGN_UI_DEBUG_INTEGRATION'] === '1';
interface Message {
  type: string;
  id: string | null;
  ok: boolean;
  data: UiDebugFrame & UiDebugReport;
  error?: { exitCode: number };
}

describe.skipIf(!enabled)('continuous real Electron session', () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'codesign-ui-session-test-'));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function client(name: string, extra: string[] = []) {
    const output = join(root, name);
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        'apps/cli/src/main.ts',
        'debug',
        'session',
        '--output',
        output,
        '--timeout-ms',
        '60000',
        ...extra,
      ],
      {
        cwd: repository,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          OPENAI_API_KEY: 'session-secret-sentinel',
          XDG_CONFIG_HOME: join(root, 'sensitive'),
        },
      },
    );
    let buffer = '';
    let stdout = '';
    let stderr = '';
    const queue: Message[] = [];
    let wake: (() => void) | undefined;
    let ended = false;
    const closed = new Promise<number | null>((resolve) =>
      child.on('close', (code) => {
        ended = true;
        wake?.();
        resolve(code);
      }),
    );
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) queue.push(JSON.parse(line) as Message);
      wake?.();
    });
    async function next(): Promise<Message> {
      while (!queue.length) {
        if (ended) throw new Error(`Unexpected exit ${child.exitCode}: ${stdout} ${stderr}`);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            wake = undefined;
            reject(new Error(`No JSONL response: ${stdout} ${stderr}`));
          }, 40000);
          wake = () => {
            clearTimeout(timer);
            wake = undefined;
            resolve();
          };
        });
      }
      return queue.shift() as Message;
    }
    return {
      child,
      output,
      next,
      closed,
      async request(id: string, method: string, steps?: unknown) {
        child.stdin.write(
          `${JSON.stringify({ schemaVersion: 1, id, method, ...(steps === undefined ? {} : { steps }) })}\n`,
        );
        const message = await next();
        expect(message.id, JSON.stringify(message)).toBe(id);
        return message;
      },
      async finish(code: number) {
        const message = await next();
        expect(message.type).toBe('closed');
        expect(message.data.cleanup).toBe(true);
        expect(await closed, stdout).toBe(code);
        expect(stderr).toBe('');
        expect(stdout).not.toContain('session-secret-sentinel');
        if (process.platform === 'win32')
          expect(observationPassed(message.data.windows), stdout).toBe(true);
        return message;
      },
    };
  }

  it('preserves real UI state across separate observations/actions, recovers a failed selector, and keeps configuration isolated', async () => {
    await mkdir(join(root, 'sensitive/open-codesign'), { recursive: true });
    const config = join(root, 'sensitive/open-codesign/config.toml');
    await writeFile(config, 'apiKey="session-secret-sentinel"');
    const digest = async () =>
      createHash('sha256')
        .update(await readFile(config))
        .digest('hex');
    const before = await digest();
    const run = client('continuity');
    try {
      const ready = await run.next();
      expect(ready).toMatchObject({ type: 'ready', ok: true });
      if (process.platform === 'win32')
        expect(observationPassed(ready.data.windows, false)).toBe(true);
      const create = ready.data.elements.find((element) => element.label === 'New design');
      expect(create).toBeDefined();
      const dialog = await run.request('open', 'act', [
        { action: 'click', selector: create?.selector },
      ]);
      expect(dialog.ok, JSON.stringify(dialog)).toBe(true);
      const confirm = dialog.data.elements.find(
        (element) => element.tag === 'button' && element.text === 'Create',
      );
      expect(confirm).toBeDefined();
      const workspace = await run.request('create', 'act', [
        { action: 'click', selector: confirm?.selector },
        { action: 'assert', selector: 'textarea', visible: true },
      ]);
      expect(workspace.ok, JSON.stringify(workspace)).toBe(true);
      const input = workspace.data.elements.find((element) => element.tag === 'textarea');
      expect(input).toBeDefined();
      const filled = await run.request('fill', 'act', [
        { action: 'fill', selector: input?.selector, value: '持续会话 draft' },
      ]);
      expect(filled.ok).toBe(true);
      const snapshot = await run.request('observe', 'snapshot');
      expect(snapshot.data.elements.find((element) => element.tag === 'textarea')?.value).toBe(
        '持续会话 draft',
      );
      const failed = await run.request('wrong', 'act', [
        { action: 'click', selector: '#missing-control' },
      ]);
      expect(failed).toMatchObject({ ok: false, error: { exitCode: 5 } });
      const recovered = await run.request('corrected', 'act', [
        { action: 'assert', selector: 'textarea', value: '持续会话 draft' },
        { action: 'press', selector: 'textarea', key: 'Tab' },
      ]);
      expect(recovered.ok).toBe(true);
      for (const response of [ready, dialog, workspace, filled, snapshot, failed, recovered]) {
        const png = await readFile(response.data.screenshot);
        expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
        expect(png.length).toBeGreaterThan(10000);
      }
      await run.request('close', 'close');
      // The terminal report retains the failed attempt even though subsequent requests recovered.
      const final = await run.finish(5);
      expect(final.data).toMatchObject({ persistedDesigns: 1, workspacesContained: true });
      expect(await digest()).toBe(before);
    } finally {
      run.child.stdin.end();
      await run.closed;
    }
  }, 90000);

  it('collects native-operation rejection during the session, allows follow-up inspection, and cleans up on EOF', async () => {
    const run = client('unsupported');
    try {
      await run.next();
      const response = await run.request('native', 'act', [
        { action: 'click', selector: 'button[aria-label="New design"]' },
        { action: 'click', selector: '[role="document"] > div:nth-of-type(2) > button' },
      ]);
      expect(response).toMatchObject({ ok: false, error: { exitCode: 6 } });
      expect(response.data.errors.some((error) => error.source === 'host:unsupported')).toBe(true);
      const next = await run.request('after-rejection', 'snapshot');
      expect(next.data.elements.some((element) => element.role === 'dialog')).toBe(true);
      run.child.stdin.end();
      await run.finish(6);
    } finally {
      run.child.stdin.end();
      await run.closed;
    }
  }, 90000);

  it('expires an idle live session and returns final Windows/cleanup evidence', async () => {
    const run = client('idle', ['--idle-timeout-ms', '200']);
    try {
      expect(await run.next()).toMatchObject({ type: 'ready', ok: true });
      const final = await run.finish(124);
      expect(final.error).toMatchObject({ exitCode: 124 });
    } finally {
      run.child.stdin.end();
      await run.closed;
    }
  }, 90000);

  it('cleans up when the client disconnects stdout without closing stdin', async () => {
    const run = client('disconnected-output');
    try {
      expect(await run.next()).toMatchObject({ type: 'ready', ok: true });
      run.child.stdout.destroy();
      run.child.stdin.write(
        `${JSON.stringify({ schemaVersion: 1, id: 'after-disconnect', method: 'snapshot' })}\n`,
      );
      expect(await run.closed).toBe(130);
      const report = JSON.parse(
        await readFile(join(run.output, 'report.json'), 'utf8'),
      ) as UiDebugReport;
      expect(report.cleanup).toBe(true);
      if (process.platform === 'win32') expect(observationPassed(report.windows)).toBe(true);
    } finally {
      run.child.stdin.end();
      await run.closed;
    }
  }, 90000);
  it.skipIf(process.platform !== 'win32')(
    'stops an idle session when its Windows observer exits',
    async () => {
      const run = client('observer-disconnected');
      try {
        expect(await run.next()).toMatchObject({ type: 'ready', ok: true });
        if (!run.child.pid) throw new Error('Missing owned runner PID');
        const powershell = await findPowerShell();
        await new Promise<void>((resolve, reject) =>
          execFile(
            powershell,
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `$debugObservers = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = ${run.child.pid}" | Where-Object { $_.Name -in @('pwsh.exe', 'powershell.exe') }); if ($debugObservers.Count -ne 1) { throw 'Expected exactly one owned observer' }; Stop-Process -Id $debugObservers[0].ProcessId -ErrorAction Stop`,
            ],
            { windowsHide: true, timeout: 15000 },
            (error) => (error ? reject(error) : resolve()),
          ),
        );
        const final = await run.next();
        expect(final).toMatchObject({
          type: 'closed',
          ok: false,
          error: { exitCode: 4 },
          data: { cleanup: true },
        });
        expect(final.data.errors.some((error) => error.source === 'observer')).toBe(true);
        expect(await run.closed).toBe(4);
      } finally {
        run.child.stdin.end();
        await run.closed;
      }
    },
    90000,
  );
});
