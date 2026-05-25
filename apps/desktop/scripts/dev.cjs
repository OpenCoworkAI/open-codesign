#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { dirname, join } = require('node:path');

const electronVitePackageJson = require.resolve('electron-vite/package.json');
const electronViteBin = join(dirname(electronVitePackageJson), 'bin', 'electron-vite.js');
const env = { ...process.env };

// Some hosts, including automation agents, run Electron tooling with this set
// so Electron behaves like Node. The desktop dev app must launch real Electron.
env.ELECTRON_RUN_AS_NODE = undefined;

// Electron exits fatally when launched as uid 0 unless --no-sandbox is passed.
// Containers, dev VMs, and CI runners commonly run as root; without this they
// can never `pnpm dev` at all. electron-vite reads NO_SANDBOX=1 and forwards
// --no-sandbox to the spawned Electron process (see electron-vite/dist startElectron).
if (process.getuid && process.getuid() === 0 && !env.NO_SANDBOX) {
  env.NO_SANDBOX = '1';
}

if (process.env.REMOTE_DEBUGGING_PORT) {
  env.ELECTRON_CLI_ARGS = JSON.stringify([
    `--remote-debugging-port=${process.env.REMOTE_DEBUGGING_PORT}`,
    '--remote-allow-origins=*',
  ]);
}

const child = spawn(process.execPath, [electronViteBin, 'dev', ...process.argv.slice(2)], {
  env,
  stdio: ['inherit', 'inherit', 'pipe'],
  windowsHide: false,
});

// Chromium emits `ERROR:debug_utils.cc(14)] Hit debug scenario: 4` from iframe
// srcdoc navigations — a known regression (electron/electron#44368) closed by
// upstream as "not planned". Harmless but floods the terminal on every preview
// render, so drop just that line. Everything else passes through untouched.
const NOISY_STDERR = /Hit debug scenario:\s*4/;
let stderrTail = '';
child.stderr.on('data', (chunk) => {
  const combined = stderrTail + chunk.toString('utf8');
  const lastNewline = combined.lastIndexOf('\n');
  const complete = lastNewline >= 0 ? combined.slice(0, lastNewline + 1) : '';
  stderrTail = lastNewline >= 0 ? combined.slice(lastNewline + 1) : combined;
  if (complete.length === 0) return;
  const filtered = complete
    .split('\n')
    .filter((line, index, arr) => {
      if (index === arr.length - 1 && line === '') return true;
      return !NOISY_STDERR.test(line);
    })
    .join('\n');
  if (filtered.length > 0) process.stderr.write(filtered);
});
child.stderr.on('end', () => {
  if (stderrTail.length > 0 && !NOISY_STDERR.test(stderrTail)) {
    process.stderr.write(stderrTail);
  }
  stderrTail = '';
});

// Forward termination signals to the child. Without this, Ctrl+C on the parent
// node process leaves the Electron main + helpers as orphans on macOS/Linux.
let forwarding = false;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    if (forwarding) return;
    forwarding = true;
    try {
      child.kill(sig);
    } catch {
      // child already gone
    }
  });
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
