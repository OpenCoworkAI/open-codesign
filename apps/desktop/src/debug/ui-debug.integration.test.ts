import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UiDebugHost, UiDebugReport } from './contract';
import { findPowerShell } from './ui-debug';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const enabled = process.env['CODESIGN_UI_DEBUG_INTEGRATION'] === '1';

describe.skipIf(!enabled)('real Electron background UI contract', () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'codesign-ui-integration-'));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function cli(output: string, steps?: object) {
    const args = [
      '--import',
      'tsx',
      'apps/cli/src/main.ts',
      'debug',
      'ui',
      '--output',
      output,
      '--json',
    ];
    if (steps) {
      const path = `${output}-steps.json`;
      await writeFile(path, JSON.stringify({ schemaVersion: 1, steps }));
      args.push('--steps', path);
    }
    return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      execFile(
        process.execPath,
        args,
        {
          cwd: repository,
          timeout: 150_000,
          windowsHide: true,
          env: {
            ...process.env,
            OPENAI_API_KEY: 'debug-secret-sentinel',
            XDG_CONFIG_HOME: join(root, 'sensitive'),
          },
        },
        (error, stdout, stderr) => {
          if (error && typeof error.code !== 'number') return reject(error);
          resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr });
        },
      );
    });
  }

  function expectIsolated(report: UiDebugReport) {
    expect(report.cleanup).toBe(true);
    if (process.platform === 'win32')
      expect(report.windows, JSON.stringify(report)).toMatchObject({
        available: true,
        completed: true,
        overflow: false,
        visibleWindowEvents: 0,
        foregroundEvents: 0,
        visibleSamples: 0,
        focusSamples: 0,
        injectedMouse: 0,
        injectedKeyboard: 0,
      });
  }

  it('creates a design through real IPC, fills the real composer, captures PNGs, and preserves user configuration', async () => {
    await mkdir(join(root, 'sensitive/open-codesign'), { recursive: true });
    const config = join(root, 'sensitive/open-codesign/config.toml');
    await writeFile(config, 'apiKey = "debug-secret-sentinel"');
    const hash = (content: Buffer) => createHash('sha256').update(content).digest('hex');
    const before = hash(await readFile(config));
    const output = join(root, 'real journey with spaces');
    const result = await cli(output);
    const response = JSON.parse(result.stdout) as { ok: boolean; data: UiDebugReport };
    expect(response, result.stdout).toMatchObject({
      ok: true,
      data: { persistedDesigns: 1, workspacesContained: true, errors: [] },
    });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('debug-secret-sentinel');
    expectIsolated(response.data);
    expect(response.data.steps).toHaveLength(11);
    expect(response.data.steps.every((step) => step.ok)).toBe(true);
    expect(response.data.screenshots).toHaveLength(12);
    for (const path of response.data.screenshots) {
      const png = await readFile(path);
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(960);
      expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(640);
      expect(png.length).toBeGreaterThan(10_000);
    }
    expect(hash(await readFile(config))).toBe(before);
    expect(await readFile(join(output, 'report.json'), 'utf8')).not.toContain(
      'debug-secret-sentinel',
    );
  }, 150_000);

  it('returns task failure with a screenshot for a missing control', async () => {
    const result = await cli(join(root, 'missing'), [
      { action: 'click', selector: '#missing-debug-control' },
    ]);
    expect(result.code).toBe(5);
    const response = JSON.parse(result.stdout) as { data: UiDebugReport };
    expect(response.data.steps[0]).toMatchObject({ ok: false });
    expect(response.data.screenshots.length).toBeGreaterThan(0);
    expectIsolated(response.data);
  }, 150_000);

  it('collects the real rejected UI error and refuses a native folder picker without displaying it', async () => {
    const result = await cli(join(root, 'unsupported'), [
      { action: 'click', selector: 'button[aria-label="New design"]' },
      { action: 'click', selector: '[role="document"] > div:nth-of-type(2) > button' },
    ]);
    expect(result.code, result.stdout).toBe(6);
    const response = JSON.parse(result.stdout) as { data: UiDebugReport };
    expect(response.data.errors.some((error) => error.source === 'host:unsupported')).toBe(true);
    expect(
      response.data.errors.some((error) => ['pageerror', 'console'].includes(error.source)),
    ).toBe(true);
    expectIsolated(response.data);
  }, 150_000);

  it('cancels after the first screenshot and cleans the process and profile', async () => {
    const entry = pathToFileURL(join(repository, 'apps/desktop/out/main/ui-debug.js')).href;
    const host = (await import(/* @vite-ignore */ entry)) as UiDebugHost;
    const controller = new AbortController();
    const output = join(root, 'cancelled');
    const running = host.runUiDebug({
      output,
      signal: controller.signal,
      defaultJourney: false,
      steps: [{ action: 'assert', selector: '#wait-until-cancelled', visible: true }],
    });
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
      if (
        await access(join(output, '00-initial.png')).then(
          () => true,
          () => false,
        )
      )
        break;
      await delay(25);
    }
    controller.abort(new Error('Test cancellation'));
    const report = await running;
    expect(report.ok).toBe(false);
    expect(report.errors.some((error) => error.source === 'cancelled')).toBe(true);
    expectIsolated(report);
  }, 150_000);

  it.skipIf(process.platform !== 'win32')(
    'keeps observing while the PID marker is briefly locked by its writer',
    async () => {
      const control = join(root, 'observer-sharing');
      await mkdir(control);
      await writeFile(join(control, 'owner'), String(process.pid));
      const child = spawn(
        await findPowerShell(),
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(repository, 'apps/desktop/scripts/observe-background-ui.ps1'),
          '-ControlDirectory',
          control,
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
      try {
        const deadline = Date.now() + 20_000;
        while (
          await access(join(control, 'ready')).then(
            () => false,
            () => true,
          )
        ) {
          if (Date.now() > deadline || child.exitCode !== null)
            throw new Error(`Observer did not start: ${stderr}`);
          await delay(20);
        }
        const writer = await open(join(control, 'pid'), 'w');
        try {
          await writer.writeFile(String(process.pid));
          await delay(300);
        } finally {
          await writer.close();
        }
        await delay(100);
        await writeFile(join(control, 'stop'), 'stop');
        await closed;
        expect(child.exitCode, stderr).toBe(0);
        expect(JSON.parse(stdout)).toMatchObject({ available: true, completed: true });
        expect((JSON.parse(stdout) as { samples: number }).samples).toBeGreaterThan(0);
      } finally {
        if (child.exitCode === null) child.kill();
        await closed;
      }
    },
    30_000,
  );
});
