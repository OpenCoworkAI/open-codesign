import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type PreviewStep, validatePreviewInput } from '@open-codesign/core';
import { findSystemChrome } from '@open-codesign/exporters';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { runPreviewSteps } from '../main/preview-interactions';
import { uiSourceFingerprint } from './build-fingerprint';
import type {
  DebugModelOptions,
  UiDebugFrame,
  UiDebugReport,
  UiDebugSession,
  WindowsObservation,
} from './contract';
import { acquireUiLease } from './ui-lease.mjs';
import { collectUiElements } from './ui-outline';

const desktopRoot = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);

export const DEFAULT_UI_STEPS: PreviewStep[] = [
  { action: 'assert', selector: 'header[data-view="hub"]', visible: true },
  { action: 'click', selector: 'button[aria-label="New design"]' },
  { action: 'assert', selector: '[role="dialog"]', visible: true },
  { action: 'click', selector: '[role="document"] > div:last-child > button:last-child' },
  { action: 'assert', selector: 'header[data-view="workspace"]', visible: true },
  { action: 'fill', selector: 'textarea', value: 'Background UI verification — draft only' },
  { action: 'assert', selector: 'textarea', value: 'Background UI verification — draft only' },
  { action: 'press', selector: 'textarea', key: 'Tab' },
  { action: 'click', selector: 'button.codesign-topbar-brand' },
  { action: 'assert', selector: 'header[data-view="hub"]', visible: true },
  { action: 'assert', selector: '[data-codesign-hub-scroll-root]', text: 'Untitled design 1' },
];

export function observationPassed(observation: WindowsObservation, completed = true): boolean {
  return (
    observation.available &&
    observation.completed === completed &&
    (observation.samples ?? 0) > 0 &&
    observation.overflow === false &&
    observation.visibleWindowEvents === 0 &&
    observation.foregroundEvents === 0 &&
    observation.visibleSamples === 0 &&
    observation.focusSamples === 0 &&
    observation.injectedMouse === 0 &&
    observation.injectedKeyboard === 0
  );
}

export function isolatedEnvironment(root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    'PATH',
    'SystemRoot',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
    'TEMP',
    'TMP',
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'XDG_RUNTIME_DIR',
    'SYSTEMDRIVE',
    'ProgramFiles',
    'ProgramFiles(x86)',
  ]) {
    const entry = Object.entries(process.env).find(
      ([name]) => name.toLowerCase() === key.toLowerCase(),
    );
    if (entry) env[key] = entry[1];
  }
  return {
    ...env,
    HOME: join(root, 'home'),
    USERPROFILE: join(root, 'home'),
    APPDATA: join(root, 'home/AppData/Roaming'),
    LOCALAPPDATA: join(root, 'home/AppData/Local'),
    TEMP: join(root, 'temp'),
    TMP: join(root, 'temp'),
    XDG_CONFIG_HOME: join(root, 'config'),
    CODESIGN_BACKGROUND_DEBUG_ROOT: root,
    CODESIGN_BACKGROUND_DEBUG_PARENT: String(process.pid),
  };
}

export function scrubDebugText(text: string): string {
  return text
    .replace(/(sk-[\w-]{12,}|Bearer\s+[^\s"']+|AIzaSy[\w-]+)/gi, '[REDACTED]')
    .replace(
      /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|ciphertext|authorization)["']?\s*[:=]\s*)[^\s,;]+/gi,
      '$1[REDACTED]',
    )
    .slice(0, 3000);
}

export async function loadUiSteps(path?: string): Promise<PreviewStep[]> {
  if (path === undefined) return DEFAULT_UI_STEPS;
  const buffer = await readFile(path);
  if (buffer.length > 64 * 1024) throw new Error('Steps file exceeds 64 KiB');
  return validateUiSteps(JSON.parse(buffer.toString('utf8')));
}

export function validateUiSteps(input: unknown): PreviewStep[] {
  if (!input || typeof input !== 'object')
    throw new Error('Expected { schemaVersion: 1, steps: [...] }');
  const record = input as Record<string, unknown>;
  if (
    record['schemaVersion'] !== 1 ||
    Object.keys(record).some((key) => !['schemaVersion', 'steps'].includes(key)) ||
    !Array.isArray(record['steps']) ||
    record['steps'].length === 0
  ) {
    throw new Error('Expected { schemaVersion: 1, steps: [...] } with 1–16 steps');
  }
  validatePreviewInput({ path: 'desktop-ui', steps: record['steps'] });
  return record['steps'] as PreviewStep[];
}

async function until<T>(probe: () => Promise<T | undefined>, signal: AbortSignal): Promise<T> {
  for (;;) {
    signal.throwIfAborted();
    const result = await probe();
    if (result !== undefined) return result;
    await delay(50, undefined, { signal });
  }
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn(
      join(process.env['SystemRoot'] ?? 'C:/Windows', 'System32/taskkill.exe'),
      ['/pid', String(child.pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore' },
    );
    await new Promise<void>((resolve) => {
      killer.once('exit', () => resolve());
      killer.once('error', () => resolve());
    });
  } else child.kill('SIGKILL');
  await until(
    async () => (child.exitCode !== null || child.signalCode !== null ? true : undefined),
    AbortSignal.timeout(5000),
  );
}

async function startObserver(directory: string, signal: AbortSignal) {
  if (process.platform !== 'win32') return undefined;
  await mkdir(directory);
  await writeFile(join(directory, 'owner'), String(process.pid));
  const powershell = await findPowerShell();
  const child = spawn(
    powershell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(desktopRoot, 'scripts/observe-background-ui.ps1'),
      '-ControlDirectory',
      directory,
      '-Stream',
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  let latest: WindowsObservation | undefined;
  let updated = Date.now();
  let failure = false;
  let diagnostic = '';
  let closed = false;
  child.once('close', () => {
    closed = true;
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
    const lines = output.split('\n');
    output = lines.pop() ?? '';
    if (output.length > 32_000) failure = true;
    for (const line of lines) {
      try {
        latest = JSON.parse(line) as WindowsObservation;
        updated = Date.now();
      } catch {
        failure = true;
      }
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    failure = true;
    diagnostic = (diagnostic + chunk.toString()).slice(-6000);
  });
  child.on('error', () => {
    failure = true;
  });
  try {
    await until(async () => {
      if (failure || child.exitCode !== null)
        throw new Error(`Windows observer could not start: ${diagnostic}`);
      return access(join(directory, 'ready')).then(
        () => true,
        () => undefined,
      );
    }, signal);
  } catch (error) {
    await stopChild(child);
    throw error;
  }
  return {
    async attach(pid: number) {
      await writeFile(join(directory, 'pid.tmp'), String(pid));
      await rename(join(directory, 'pid.tmp'), join(directory, 'pid'));
      await until(async () => {
        if (failure || closed) throw new Error('Windows observer stopped');
        return latest && (latest.samples ?? 0) > 0 ? true : undefined;
      }, signal);
    },
    current(): WindowsObservation {
      if (failure || closed || !latest || Date.now() - updated > 5000)
        throw new Error('Windows observation lost or stale');
      if (!observationPassed(latest, false)) throw new Error('Windows interference observed');
      return { ...latest };
    },
    async stop(): Promise<WindowsObservation> {
      await writeFile(join(directory, 'stop'), 'stop');
      try {
        await until(async () => (closed ? true : undefined), AbortSignal.timeout(5000));
        if (failure || child.exitCode !== 0)
          throw new Error(`Windows observer exit ${child.exitCode}: ${diagnostic}`);
        if (!latest) throw new Error('Windows observation missing');
        return latest;
      } finally {
        await stopChild(child);
      }
    },
  };
}

export async function findPowerShell(): Promise<string> {
  const candidates = [
    process.env['CODESIGN_DEBUG_POWERSHELL'],
    process.env['ProgramFiles']
      ? join(process.env['ProgramFiles'], 'PowerShell/7/pwsh.exe')
      : undefined,
    process.env['LOCALAPPDATA']
      ? join(process.env['LOCALAPPDATA'], 'Microsoft/WindowsApps/pwsh.exe')
      : undefined,
    join(
      process.env['SystemRoot'] ?? 'C:/Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    ),
  ];
  for (const candidate of candidates) {
    if (
      candidate &&
      (await access(candidate).then(
        () => true,
        () => false,
      ))
    )
      return candidate;
  }
  throw new Error('PowerShell unavailable for Windows observation');
}

export async function runUiDebug(options: {
  output: string;
  steps: PreviewStep[];
  signal: AbortSignal;
  defaultJourney: boolean;
  interact?: (session: UiDebugSession) => Promise<void>;
  model?: DebugModelOptions;
}): Promise<UiDebugReport> {
  const lease = acquireUiLease('session');
  let cleanup = true;
  try {
    const report = await runOwnedUiDebug(options);
    cleanup = report.cleanup;
    return report;
  } finally {
    if (cleanup) lease.release();
  }
}

async function runOwnedUiDebug(options: Parameters<typeof runUiDebug>[0]): Promise<UiDebugReport> {
  const watchdog = new AbortController();
  const signal = AbortSignal.any([options.signal, watchdog.signal]);
  const entry = join(desktopRoot, 'out/main/index.js');
  await access(entry);
  const stamp = JSON.parse(
    await readFile(join(desktopRoot, 'out/background-debug-build.json'), 'utf8'),
  ) as { schemaVersion: number; fingerprint: string };
  if (stamp.schemaVersion !== 1 || stamp.fingerprint !== (await uiSourceFingerprint(desktopRoot))) {
    throw new Error('UI_DEBUG_BUILD_STALE: rebuild desktop with --mode background-debug');
  }
  const output = resolve(options.output);
  await mkdir(output); // Exclusive directory: never overwrite an earlier evidence bundle.
  const temp = await mkdtemp(join(tmpdir(), 'codesign-ui-debug-'));
  const root = join(temp, 'instance');
  await mkdir(root);
  const report: UiDebugReport = {
    schemaVersion: 1,
    ok: false,
    host: 'electron-offscreen',
    screenshots: [],
    steps: [],
    errors: [],
    errorsTruncated: false,
    windows: { platform: process.platform, available: false },
    persistedDesigns: 0,
    workspacesContained: false,
    cleanup: false,
  };
  const error = (source: string, message: string) => {
    if (report.errors.length >= 100) {
      report.errorsTruncated = true;
      return;
    }
    report.errors.push({ source, message: scrubDebugText(message) });
  };
  let observer: Awaited<ReturnType<typeof startObserver>>;
  let child: ChildProcess | undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  let endpoint: string | undefined;
  let spawnFailed = false;
  let stderr = '';
  let monitoring: ReturnType<typeof setInterval> | undefined;
  let hostLines = 0;
  let logLines = 0;
  const modelEvidence = async () =>
    options.model
      ? {
          model: JSON.parse(
            await readFile(join(root, 'model-evidence.json'), 'utf8'),
          ) as NonNullable<UiDebugReport['model']>,
          runs: JSON.parse(
            await readFile(join(root, 'model-runs.json'), 'utf8').catch(() => '[]'),
          ) as NonNullable<UiDebugReport['runs']>,
        }
      : {};
  let stopping: Promise<boolean> | undefined;
  const stopModel = () =>
    (stopping ??= new Promise<boolean>((resolveStop) => {
      if (!child?.connected) {
        resolveStop(false);
        return;
      }
      const timer = setTimeout(() => resolveStop(false), 10_000);
      child.on('message', (message: unknown) => {
        if (
          message &&
          typeof message === 'object' &&
          (message as { type?: unknown }).type === 'background-model-stopped'
        ) {
          clearTimeout(timer);
          resolveStop(true);
        }
      });
      child.send({ type: 'background-model-stop' }, (error) => {
        if (error) {
          clearTimeout(timer);
          resolveStop(false);
        }
      });
    }));
  const collectHostErrors = async (final = false) => {
    const hostEvents = await readFile(join(root, 'host-events.jsonl'), 'utf8').catch(() => '');
    // Only consume complete lines while the host can still append to the log.
    const lines = hostEvents.split('\n');
    if (!final || lines.at(-1) === '') lines.pop();
    for (const line of lines.slice(hostLines)) {
      try {
        const event = JSON.parse(line) as { kind: string; detail: string };
        if (typeof event.kind === 'string' && typeof event.detail === 'string')
          error(`host:${event.kind}`, event.detail);
        else error('host-log', 'Invalid host event');
      } catch {
        error('host-log', 'Invalid host event');
      }
    }
    hostLines = lines.length;
    const mainLog = await readFile(join(root, 'logs/main.log'), 'utf8').catch(() => '');
    const entries = mainLog.split('\n');
    if (!final || entries.at(-1) === '') entries.pop();
    for (const line of entries.slice(logLines).filter((line) => /\]\s+\[error\]/i.test(line)))
      error('main', line);
    logLines = entries.length;
  };
  const cancel = () => {
    if (options.model) void stopModel();
    else void browser?.close().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  const capture = async (name: string) => {
    if (!page || page.isClosed()) return;
    const path = join(output, `${name}.png`);
    await page.screenshot({ path, type: 'png' });
    report.screenshots.push(path);
    return path;
  };
  try {
    observer = await startObserver(join(temp, 'observer'), signal);
    const chrome = options.model ? await findSystemChrome() : undefined;
    child = spawn(
      require('electron') as string,
      [
        entry,
        '--remote-debugging-port=0',
        '--remote-debugging-address=127.0.0.1',
        '--no-first-run',
        '--no-default-browser-check',
      ],
      {
        cwd: desktopRoot,
        env: {
          ...isolatedEnvironment(root),
          ...(chrome ? { CODESIGN_CHROME_PATH: chrome } : {}),
          ...(options.model
            ? {
                CODESIGN_BACKGROUND_MODEL: JSON.stringify({
                  ...options.model,
                  ...(options.model.config ? { config: resolve(options.model.config) } : {}),
                  ...(options.model.credentialState
                    ? { credentialState: resolve(options.model.credentialState) }
                    : {}),
                  ...(options.model.codexAuth
                    ? { codexAuth: resolve(options.model.codexAuth) }
                    : {}),
                }),
              }
            : {}),
        },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      },
    );
    child.on('error', () => {
      spawnFailed = true;
    });
    child.stdout?.resume();
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr = (stderr + text).slice(-32_000);
      endpoint ??=
        /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/.exec(
          stderr,
        )?.[1];
    });
    if (child.pid !== undefined) await observer?.attach(child.pid);
    monitoring = setInterval(() => {
      try {
        observer?.current();
        if (spawnFailed || child?.exitCode !== null || child?.signalCode !== null)
          throw new Error('Background application exited');
      } catch (issue) {
        watchdog.abort(issue);
      }
    }, 250);
    const ws = await until(async () => {
      if (spawnFailed || child?.exitCode !== null || child?.signalCode !== null)
        throw new Error(`Electron could not start. ${stderr}`);
      return endpoint;
    }, signal);
    browser = await puppeteer.connect({
      browserWSEndpoint: ws,
      defaultViewport: null,
      protocolTimeout: 10_000,
    });
    const target = await browser.waitForTarget(
      (target) =>
        target.type() === 'page' &&
        target.url() === pathToFileURL(join(desktopRoot, 'out/renderer/index.html')).href,
      { timeout: 20_000, signal },
    );
    page = (await target.page()) ?? undefined;
    if (!page) throw new Error('Application page unavailable');
    page.on('pageerror', (issue) => error('pageerror', String(issue)));
    page.on('console', (message) => {
      if (message.type() === 'error') error('console', message.text());
    });
    page.on('requestfailed', (request) =>
      error('requestfailed', `${request.url()} ${request.failure()?.errorText ?? ''}`),
    );
    page.on('response', (response) => {
      if (response.status() >= 400) error('response', `${response.status()} ${response.url()}`);
    });
    // Reload with collectors attached so startup errors are included, too.
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForSelector('header[data-view="hub"]', { timeout: 20_000, signal });
    await capture('00-initial');
    const activePage = page;
    const perform = async (steps: PreviewStep[]) => {
      for (const step of steps) {
        signal.throwIfAborted();
        observer?.current();
        const index = report.steps.length;
        const result = (await runPreviewSteps(activePage, [step], signal))[0];
        if (!result) throw new Error('Missing step result');
        report.steps.push({
          ...result,
          index,
          ...(result.reason ? { reason: scrubDebugText(result.reason) } : {}),
        });
        signal.throwIfAborted();
        await capture(`${String(report.screenshots.length).padStart(2, '0')}-${step.action}`);
        if (!result.ok) break;
      }
    };
    if (options.interact) {
      let deliveredErrors = 0;
      const frame = async (steps: PreviewStep[] = []): Promise<UiDebugFrame> => {
        signal.throwIfAborted();
        if (steps.length) validatePreviewInput({ path: 'desktop-ui', steps });
        if (report.steps.length + steps.length > 200)
          throw new Error('Session step limit exceeded');
        const start = report.steps.length;
        await perform(steps);
        const screenshot = await capture(
          `${String(report.screenshots.length).padStart(2, '0')}-snapshot`,
        );
        if (!screenshot) throw new Error('Application page closed');
        const outline = await activePage.evaluate(collectUiElements);
        for (const element of outline.elements) {
          element.label = scrubDebugText(element.label);
          element.text = scrubDebugText(element.text);
          if (element.value !== undefined) element.value = scrubDebugText(element.value);
        }
        await collectHostErrors();
        const errors = report.errors.slice(deliveredErrors);
        deliveredErrors = report.errors.length;
        return {
          screenshot,
          ...outline,
          steps: report.steps.slice(start),
          errors,
          errorCount: report.errors.length,
          errorsTruncated: report.errorsTruncated,
          windows: observer?.current() ?? report.windows,
          ...(await modelEvidence()),
        };
      };
      await options.interact({ signal, snapshot: () => frame(), act: (steps) => frame(steps) });
      signal.throwIfAborted();
    } else await perform(options.steps);
    const store = JSON.parse(
      await readFile(join(root, 'userData/design-store.json'), 'utf8').catch(
        () => '{"designs":[]}',
      ),
    ) as {
      designs: { workspacePath?: string | null }[];
    };
    report.persistedDesigns = store.designs.length;
    report.workspacesContained = store.designs.every((design) => {
      if (!design.workspacePath) return false;
      const path = relative(join(root, 'documents'), design.workspacePath);
      return path !== '..' && !path.startsWith(`..${sep}`) && !path.includes(':');
    });
    if (options.defaultJourney && (report.persistedDesigns !== 1 || !report.workspacesContained)) {
      error(
        'persistence',
        'Expected one design persisted through real IPC inside the isolated Documents directory',
      );
    }
  } catch (issue) {
    const modelSetupCode =
      /BACKGROUND_MODEL_(?:CONFIG_INVALID|CONFIG_REQUIRED|CONFIG_UNREADABLE|SELECTION_MISSING|CREDENTIAL_MISSING|CREDENTIAL_UNREADABLE|CREDENTIAL_STATE_INVALID|CREDENTIAL_STATE_UNREADABLE|CREDENTIAL_STATE_UNSUPPORTED|AUTH_INVALID|AUTH_EXPIRED|AUTH_UNREADABLE|OAUTH_ENDPOINT_UNSUPPORTED|OAUTH_UNSUPPORTED|KEYCHAIN_INTERACTION_UNSUPPORTED|ENDPOINT_UNSUPPORTED)/.exec(
        stderr,
      )?.[0];
    if (modelSetupCode) error('model-setup', modelSetupCode);
    error(
      options.signal.aborted ? 'cancelled' : watchdog.signal.aborted ? 'observer' : 'runtime',
      issue instanceof Error ? issue.message : String(issue),
    );
    await capture('failure').catch(() => undefined);
  } finally {
    signal.removeEventListener('abort', cancel);
    if (options.model && child?.connected) {
      if (!(await stopModel())) error('cleanup', 'Model generation did not settle before shutdown');
      browser?.disconnect();
      await until(
        async () => (child?.exitCode !== null ? true : undefined),
        AbortSignal.timeout(3000),
      ).catch(() => undefined);
    } else if (browser) await Promise.race([browser.close().catch(() => undefined), delay(3000)]);
    clearInterval(monitoring);
    let processStopped = true;
    if (child) {
      try {
        await stopChild(child);
      } catch {
        processStopped = false;
        error('cleanup', 'Electron process did not exit');
      }
    }
    if (observer) {
      try {
        report.windows = await observer.stop();
      } catch (issue) {
        error(
          'observer',
          `Windows observation did not complete: ${issue instanceof Error ? issue.message : String(issue)}`,
        );
      }
    }
    await collectHostErrors(true);
    if (options.model) {
      try {
        Object.assign(report, await modelEvidence());
        report.artifacts = [];
        const store = JSON.parse(
          await readFile(join(root, 'userData/design-store.json'), 'utf8'),
        ) as { designs: { workspacePath?: string }[] };
        for (const [index, design] of store.designs.entries()) {
          if (!design.workspacePath) continue;
          for (const name of ['App.jsx', 'DESIGN.md', 'index.html']) {
            const source = await realpath(join(design.workspacePath, name)).catch(() => undefined);
            if (!source) continue;
            const local = relative(await realpath(join(root, 'documents')), source);
            if (local === '..' || local.startsWith(`..${sep}`) || local.includes(':')) {
              error('evidence', 'Artifact escaped workspace');
              continue;
            }
            if ((await stat(source)).size > 1024 * 1024) {
              error('evidence', 'Artifact evidence exceeds 1 MiB');
              continue;
            }
            const content = await readFile(source);
            const directory = join(output, 'artifacts', String(index + 1));
            await mkdir(directory, { recursive: true });
            const path = join(directory, name);
            await writeFile(path, content, { flag: 'wx' });
            report.artifacts.push({
              path,
              bytes: content.length,
              sha256: createHash('sha256').update(content).digest('hex'),
            });
          }
        }
      } catch {
        error('evidence', 'Model/artifact evidence could not be collected');
      }
    }
    try {
      await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      report.cleanup = processStopped;
    } catch {
      error('cleanup', 'Temporary application data could not be removed');
    }
    report.ok =
      report.errors.length === 0 &&
      (options.interact !== undefined || report.steps.length === options.steps.length) &&
      report.steps.every((step) => step.ok) &&
      report.cleanup &&
      (process.platform !== 'win32' || observationPassed(report.windows));
    await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, {
      flag: 'wx',
    });
  }
  return report;
}
