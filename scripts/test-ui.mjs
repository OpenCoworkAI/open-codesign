import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { acquireUiLease } from '../apps/desktop/src/debug/ui-lease.mjs';
import { runOwnedNode } from './testing/owned-process.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const suites = {
  browser: ['apps/desktop', 'packages/exporters'],
  'desktop-browser': ['apps/desktop'],
  'exporters-browser': ['packages/exporters'],
  debug: ['apps/desktop'],
};

export function parseUiTestArgs(args) {
  if (args.length > 2 || (args[1] !== undefined && args[1] !== '--list')) {
    throw new Error('UI_TEST_USAGE: expected a suite and optional --list');
  }
  return { mode: args[0], list: args[1] === '--list' };
}

export async function runUiTests(mode, list = false) {
  if (!Object.hasOwn(suites, mode)) throw new Error('UI_TEST_USAGE: expected browser or debug');
  const lease = acquireUiLease('suite');
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  const output = join(root, '.Codex/workspace', `ui-tests-${Date.now()}-${randomUUID()}`);
  const report = { schemaVersion: 1, mode, listOnly: list, cleanup: true, suites: [] };
  try {
    await mkdir(output, { recursive: true });
    await writeFile(
      join(output, 'report.json'),
      JSON.stringify({ ...report, status: 'running', cleanup: false }),
    );
    process.stderr.write(`UI test report: ${join(output, 'report.json')}\n`);
    for (const relative of suites[mode]) {
      const cwd = join(root, relative);
      const require = createRequire(join(cwd, 'package.json'));
      const logName = `${relative.replaceAll('/', '-')}.log`;
      const log = createWriteStream(join(output, logName), { flags: 'wx' });
      const logDone = finished(log);
      const transcript = new PassThrough();
      transcript.pipe(process.stdout, { end: false });
      transcript.pipe(log);
      const result = await runOwnedNode({
        cwd,
        args: [
          join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'),
          ...(list ? ['list', '--filesOnly'] : ['run']),
          '--config',
          mode === 'debug' ? 'vitest.debug.config.ts' : 'vitest.browser.config.ts',
        ],
        env: { ...process.env, ...lease.env },
        signal: abort.signal,
        stdout: transcript,
        stderr: transcript,
      }).finally(async () => {
        transcript.end();
        await logDone;
      });
      report.suites.push({ package: relative, log: logName, ...result });
      report.cleanup &&= result.cleanup;
      if (!result.cleanup || result.exitCode !== 0) return result.cleanup ? result.exitCode : 1;
    }
    return 0;
  } catch {
    report.cleanup = false;
    process.stderr.write(
      'UI_TEST_RUN_FAILED: inspect the report; no fallback to foreground input\n',
    );
    return 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    try {
      await writeFile(
        join(output, 'report.json'),
        `${JSON.stringify({ ...report, status: 'finished' }, null, 2)}\n`,
      );
    } finally {
      if (report.cleanup) lease.release();
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const args = parseUiTestArgs(process.argv.slice(2));
    process.exitCode = await runUiTests(args.mode, args.list);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
