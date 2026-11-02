import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
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
        '120000',
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

  async function openDesign(run: ReturnType<typeof client>) {
    expect(await run.next()).toMatchObject({ type: 'ready', ok: true });
    const result = await run.request('new', 'act', [
      { action: 'click', selector: 'button[aria-label="New design"]' },
      { action: 'click', selector: '[role="document"] > div:last-child > button:last-child' },
      { action: 'assert', selector: 'textarea', visible: true },
    ]);
    expect(result.ok, JSON.stringify(result)).toBe(true);
  }

  async function submit(run: ReturnType<typeof client>, id: string, prompt: string) {
    return run.request(id, 'act', [
      { action: 'fill', selector: 'textarea', value: prompt },
      { action: 'press', selector: 'textarea', key: 'Enter' },
    ]);
  }

  async function settled(run: ReturnType<typeof client>, prefix: string, count: number) {
    for (let index = 0; index < 90; index++) {
      const frame = await run.request(`${prefix}-${index}`, 'snapshot');
      if (
        (frame.data.runs?.length ?? 0) >= count &&
        frame.data.runs?.every((entry) => entry.status !== 'running')
      )
        return frame;
      await delay(500);
    }
    throw new Error('Generation did not settle');
  }

  it('runs controlled model tools through real UI and persists artifacts across two turns', async () => {
    const run = client('model-success', ['--model-mode', 'fixture']);
    try {
      await openDesign(run);
      await submit(
        run,
        'send-first',
        'Build a simple background test page. No images, tweaks or reusable system.',
      );
      const first = await settled(run, 'first', 1);
      expect(first.data.runs, JSON.stringify(first)).toMatchObject([{ status: 'completed' }]);
      expect(first.data.model?.completed).toBeGreaterThan(5);
      await submit(run, 'send-second', 'Keep the same page and verify it again.');
      const second = await settled(run, 'second', 2);
      expect(second.data.runs, JSON.stringify(second)).toMatchObject([
        { status: 'completed' },
        { status: 'completed' },
      ]);
      const history = (frame: Message) =>
        Math.max(
          ...(frame.data.model?.events
            .filter((event) => event.tools)
            .map((event) => event.historyMessages) ?? [0]),
        );
      expect(history(second)).toBeGreaterThan(history(first));
      await run.request('close', 'close');
      const final = await run.finish(0);
      expect(final.data.model?.active).toBe(0);
      const source = final.data.artifacts?.find((artifact) => artifact.path.endsWith('App.jsx'));
      expect(source).toBeDefined();
      expect(await readFile(source?.path ?? '', 'utf8')).toContain('Background model verified');
      expect(final.data.artifacts?.some((artifact) => artifact.path.endsWith('DESIGN.md'))).toBe(
        true,
      );
    } finally {
      run.child.stdin.end();
      await run.closed;
    }
  }, 150000);

  it('keeps a controlled model error and permits a later successful generation', async () => {
    const run = client('model-recovery', ['--model-mode', 'fixture']);
    try {
      await openDesign(run);
      await submit(run, 'send-error', '[fixture:error] Fail this controlled request.');
      const failed = await settled(run, 'failed', 1);
      expect(failed.data.runs, JSON.stringify(failed)).toMatchObject([{ status: 'failed' }]);
      await submit(run, 'send-recovery', 'Build a simple background test page.');
      const recovered = await settled(run, 'recovered', 2);
      expect(recovered.data.runs, JSON.stringify(recovered)).toMatchObject([
        { status: 'failed' },
        { status: 'completed' },
      ]);
      await run.request('close', 'close');
      const final = await run.finish(5);
      expect(final.data.model?.failed).toBeGreaterThan(0);
      expect(final.data.model?.active).toBe(0);
    } finally {
      run.child.stdin.end();
      await run.closed;
    }
  }, 150000);

  it('cancels an active model generation before closing on EOF', async () => {
    const run = client('model-cancel', ['--model-mode', 'fixture']);
    try {
      await openDesign(run);
      await submit(run, 'send-wait', '[fixture:wait] Wait for cancellation.');
      let frame: Message | undefined;
      for (let index = 0; index < 30; index++) {
        frame = await run.request(`pending-${index}`, 'snapshot');
        if (frame.data.model?.events.some((event) => event.tools && event.status === 'running'))
          break;
        await delay(100);
      }
      expect(frame?.data.runs).toMatchObject([{ status: 'running' }]);
      run.child.stdin.end();
      const final = await run.next();
      expect(final.type).toBe('closed');
      expect(final.data.cleanup, JSON.stringify(final)).toBe(true);
      expect(final.data.model).toMatchObject({ active: 0, cancelled: 1 });
      expect(final.data.runs).toMatchObject([{ status: 'cancelled' }]);
      if (process.platform === 'win32') expect(observationPassed(final.data.windows)).toBe(true);
      expect([0, 5]).toContain(await run.closed);
    } finally {
      run.child.stdin.end();
      await run.closed;
    }
  }, 90000);

  it('answers a controlled model question through the real hidden UI', async () => {
    const run = client('model-question', ['--model-mode', 'fixture']);
    try {
      await openDesign(run);
      await submit(
        run,
        'send-question',
        '[fixture:ask] Ask for one synthetic fact, then build the page.',
      );
      const answer = await run.request('answer', 'act', [
        { action: 'assert', selector: '#ask-q-fact', visible: true },
        { action: 'fill', selector: '#ask-q-fact', value: 'Synthetic answer' },
        {
          action: 'click',
          selector: 'section[aria-labelledby="ask-title"] footer button:last-child',
        },
      ]);
      expect(answer.ok, JSON.stringify(answer)).toBe(true);
      expect((await settled(run, 'answered', 1)).data.runs).toMatchObject([
        { status: 'completed' },
      ]);
      await run.request('close', 'close');
      await run.finish(0);
    } finally {
      run.child.stdin.end();
      await run.closed;
    }
  }, 90000);

  it('loads only the explicit live config without writes, credential output or automatic calls', async () => {
    const config = join(root, 'selected-config.toml');
    await writeFile(
      config,
      `version = 3
activeProvider = "test"
activeModel = "test-model"
[providers.test]
id = "test"
name = "Test"
builtin = false
wire = "openai-chat"
baseUrl = "http://127.0.0.1:1/v1"
defaultModel = "test-model"
[secrets.test]
ciphertext = "plain:session-secret-sentinel"
`,
    );
    const before = await readFile(config);
    const mtime = (await stat(config)).mtimeMs;
    const run = client('model-live-config', ['--model-mode', 'live', '--config', config]);
    try {
      const ready = await run.next();
      expect(ready, JSON.stringify(ready)).toMatchObject({ type: 'ready', ok: true });
      expect(ready.data.model).toMatchObject({ mode: 'live', calls: 0 });
      await run.request('close', 'close');
      await run.finish(0);
      expect(await readFile(config)).toEqual(before);
      expect((await stat(config)).mtimeMs).toBe(mtime);
    } finally {
      run.child.stdin.end();
      await run.closed;
    }
  }, 90000);

  it('loads an explicit current login without network calls or source writes', async () => {
    const config = join(root, 'login-config.toml');
    const auth = join(root, 'current-login.json');
    await writeFile(
      config,
      `version = 3
activeProvider = "chatgpt-codex"
activeModel = "test-model"
[providers.chatgpt-codex]
id = "chatgpt-codex"
name = "Test subscription"
builtin = false
wire = "openai-codex-responses"
baseUrl = "https://chatgpt.com/backend-api"
requiresApiKey = false
defaultModel = "test-model"
`,
    );
    await writeFile(
      auth,
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: `head.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.session-secret-sentinel`,
          refresh_token: 'session-secret-sentinel',
          id_token: 'session-secret-sentinel',
        },
      }),
    );
    const sources = await Promise.all(
      [config, auth].map(async (path) => ({
        path,
        content: await readFile(path),
        mtime: (await stat(path)).mtimeMs,
      })),
    );
    const run = client('current-login', [
      '--model-mode',
      'live',
      '--config',
      config,
      '--codex-auth',
      auth,
    ]);
    try {
      expect(await run.next()).toMatchObject({
        type: 'ready',
        ok: true,
        data: { model: { mode: 'live', calls: 0 } },
      });
      await run.request('close', 'close');
      await run.finish(0);
      for (const source of sources) {
        expect(await readFile(source.path)).toEqual(source.content);
        expect((await stat(source.path)).mtimeMs).toBe(source.mtime);
      }
    } finally {
      run.child.stdin.end();
      await run.closed;
    }
  }, 90000);

  it('rejects invalid credential state without an Electron startup dialog or source writes', async () => {
    const state = join(root, 'invalid-local-state.json');
    await writeFile(state, 'private-sentinel-invalid-json');
    const before = await stat(state);
    const run = client('invalid-credential-state', [
      '--model-mode',
      'live',
      '--config',
      join(root, 'unused.toml'),
      '--credential-state',
      state,
    ]);
    try {
      const final = await run.next();
      const code = process.platform === 'win32' ? 3 : 6;
      expect(final).toMatchObject({ type: 'closed', ok: false, error: { exitCode: code } });
      expect(JSON.stringify(final)).not.toContain('private-sentinel');
      expect(final.data.errors).toContainEqual({
        source: 'model-setup',
        message:
          process.platform === 'win32'
            ? 'BACKGROUND_MODEL_CREDENTIAL_STATE_INVALID'
            : 'BACKGROUND_MODEL_CREDENTIAL_STATE_UNSUPPORTED',
      });
      expect(final.data.cleanup).toBe(true);
      expect(await run.closed).toBe(code);
      expect(await readFile(state, 'utf8')).toBe('private-sentinel-invalid-json');
      expect((await stat(state)).mtimeMs).toBe(before.mtimeMs);
      if (process.platform === 'win32') expect(observationPassed(final.data.windows)).toBe(true);
    } finally {
      run.child.stdin.end();
      await run.closed;
    }
  }, 90000);

  it('reports missing live configuration with exit 3 and no foreground fallback', async () => {
    const run = client('model-missing-config', [
      '--model-mode',
      'live',
      '--config',
      join(root, 'missing.toml'),
    ]);
    try {
      const final = await run.next();
      expect(final).toMatchObject({ type: 'closed', ok: false, error: { exitCode: 3 } });
      expect(final.data.errors).toContainEqual({
        source: 'model-setup',
        message: 'BACKGROUND_MODEL_CONFIG_UNREADABLE',
      });
      expect(final.data.cleanup).toBe(true);
      expect(await run.closed).toBe(3);
      if (process.platform === 'win32') expect(observationPassed(final.data.windows)).toBe(true);
    } finally {
      run.child.stdin.end();
      await run.closed;
    }
  }, 90000);

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
