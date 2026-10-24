import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function findPowerShell(env) {
  if (env.CODESIGN_TEST_POWERSHELL) {
    await access(env.CODESIGN_TEST_POWERSHELL);
    return env.CODESIGN_TEST_POWERSHELL;
  }
  const candidates = [
    join(env.ProgramFiles || 'C:/Program Files', 'PowerShell/7/pwsh.exe'),
    ...(env.PATH || env.Path || '')
      .split(delimiter)
      .filter(Boolean)
      .map((path) => join(path, 'pwsh.exe')),
    join(env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
  ];
  for (const path of candidates) {
    if (
      await access(path).then(
        () => true,
        () => false,
      )
    )
      return path;
  }
  throw new Error('UI_TEST_POWERSHELL_UNAVAILABLE');
}

/** Run Node and own its test descendants; never kill by executable name. */
export async function runOwnedNode({
  args,
  cwd,
  env = process.env,
  signal,
  timeoutMs = 30 * 60_000,
  stdout = process.stdout,
  stderr = process.stderr,
}) {
  signal?.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), 'codesign-test-owner-'));
  const reportPath = join(directory, 'report.json');
  let child;
  let reason;
  let timer;
  let forceTimer;
  let drainTimer;
  const stop = (value) => {
    reason ??= value;
    if (process.platform === 'win32') {
      child?.stdin.end();
      // A wedged supervisor must not hold the lease indefinitely. Closing its only
      // job handle kills the job; without its report, cleanup remains unconfirmed.
      forceTimer ??= setTimeout(() => child?.kill(), 8000);
    } else if (child?.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  };
  const abort = () => stop('cancelled');
  try {
    let executable = process.execPath;
    let childArgs = args;
    if (process.platform === 'win32') {
      const config = join(directory, 'config.json');
      await writeFile(
        config,
        JSON.stringify({ exe: executable, args, cwd: resolve(cwd), report: reportPath }),
      );
      executable = await findPowerShell(env);
      childArgs = [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-File',
        fileURLToPath(new URL('./windows-job.ps1', import.meta.url)),
        '-Config',
        config,
      ];
    }
    child = spawn(executable, childArgs, {
      cwd,
      env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.on('error', () => {});
    child.stdout.pipe(stdout, { end: false });
    child.stderr.pipe(stderr, { end: false });
    const ended = new Promise((resolveExit, reject) => {
      child.once('error', reject);
      // Do not wait for inherited stdout to close before killing orphan descendants.
      child.once('exit', (code) => resolveExit(code ?? 1));
    });
    const closed = new Promise((done) => child.once('close', () => done(true)));
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => stop('timeout'), timeoutMs);
    if (signal?.aborted) abort();
    const exitCode = await ended;
    let cleanup;
    let pid = child.pid;
    if (process.platform === 'win32') {
      const report = JSON.parse(await readFile(reportPath, 'utf8').catch(() => '{}'));
      cleanup = report.cleanup === true;
      pid = report.pid;
    } else {
      stop(reason);
      cleanup = true; // SIGKILL delivered to the owned process group, including orphan descendants.
    }
    const drained = await Promise.race([
      closed,
      new Promise((done) => {
        drainTimer = setTimeout(() => done(false), 5000);
      }),
    ]);
    cleanup &&= drained;
    return {
      schemaVersion: 1,
      ownership: process.platform === 'win32' ? 'windows-job' : 'posix-process-group',
      pid,
      exitCode: reason === 'timeout' ? 124 : reason ? 130 : exitCode,
      cleanup,
      reason,
    };
  } finally {
    clearTimeout(timer);
    clearTimeout(forceTimer);
    clearTimeout(drainTimer);
    signal?.removeEventListener('abort', abort);
    child?.stdin.end();
    await rm(directory, { recursive: true, force: true });
  }
}
