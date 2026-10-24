import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { runOwnedNode } from './owned-process.mjs';

const fixture = fileURLToPath(new URL('./__fixtures__/owned-tree.mjs', import.meta.url));
async function eventually(fn) {
  for (let i = 0; i < 200; i++) {
    const result = await fn();
    if (result) return result;
    await delay(50);
  }
  assert.fail('Owned process did not reach the expected state within 10 seconds');
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

for (const mode of ['exit', 'cancel', 'timeout']) {
  test(`cleans up the Node descendant on ${mode}, even after the root exits`, {
    timeout: 30_000,
  }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codesign-owned-test-'));
    const file = join(directory, 'pids.json');
    const abort = new AbortController();
    const output = new PassThrough();
    output.resume();
    let pids;
    let running;
    try {
      const extra = ['space value', 'quote"value', 'trailing\\', '中文'];
      running = runOwnedNode({
        args: [fixture, file, mode, ...extra],
        cwd: directory,
        signal: abort.signal,
        timeoutMs: mode === 'timeout' ? 6000 : 20_000,
        stdout: output,
        stderr: output,
      });
      pids = await eventually(async () =>
        JSON.parse(await readFile(file, 'utf8').catch(() => 'null')),
      );
      assert.deepEqual(pids.args, extra);
      if (mode === 'cancel') abort.abort();
      const result = await running;
      assert.equal(result.exitCode, mode === 'exit' ? 7 : mode === 'cancel' ? 130 : 124);
      assert.equal(result.cleanup, true);
      await eventually(() => !alive(pids.parent) && !alive(pids.child));
    } finally {
      abort.abort();
      await running?.catch(() => {});
      for (const pid of pids ? [pids.parent, pids.child] : []) {
        if (alive(pid)) process.kill(pid, 'SIGKILL');
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('Windows supervisor cleans up when its Node launcher is terminated', {
  skip: process.platform !== 'win32',
  timeout: 30_000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codesign-owner-death-'));
  const file = join(directory, 'pids.json');
  const launcher = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('./__fixtures__/owned-launcher.mjs', import.meta.url)),
      fixture,
      file,
      'wait',
    ],
    {
      windowsHide: true,
      stdio: 'ignore',
    },
  );
  let pids;
  try {
    pids = await eventually(async () =>
      JSON.parse(await readFile(file, 'utf8').catch(() => 'null')),
    );
    launcher.kill();
    await eventually(() => !alive(pids.parent) && !alive(pids.child));
  } finally {
    launcher.kill();
    for (const pid of pids ? [pids.parent, pids.child] : []) {
      if (alive(pid)) process.kill(pid, 'SIGKILL');
    }
    await rm(directory, { recursive: true, force: true });
  }
});
