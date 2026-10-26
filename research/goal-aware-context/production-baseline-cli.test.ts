import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const tsx = require.resolve('tsx/cli');
const outputRoot = join(root, '.Codex/workspace/goal-aware-context/cli-verification');

function outputPath(): string {
  mkdirSync(outputRoot, { recursive: true });
  return join(mkdtempSync(join(outputRoot, 'run-')), 'nested', 'report.json');
}

function run(output: string) {
  return spawnSync(
    process.execPath,
    [
      tsx,
      '--tsconfig',
      'research/goal-aware-context/tsconfig.json',
      'research/goal-aware-context/run-production-baseline.ts',
      output,
    ],
    { cwd: root, encoding: 'utf8', windowsHide: true },
  );
}

describe('production baseline report CLI', () => {
  it('creates a JSON report in a new nested directory using the current runtime', () => {
    const output = outputPath();
    const result = run(output);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(readFileSync(output, 'utf8'));
    expect(report.kind).toBe('production-context-baseline');
    expect(report.nodeVersion).toBe(process.version);
    expect(report.pack.trace.selectedMessages).toBe(report.pack.history.length);
    expect(report.input.workspaceState.sourcePath).toBe('App.jsx');
  });

  it('refuses to overwrite existing evidence and preserves its exact bytes', () => {
    const output = outputPath();
    mkdirSync(dirname(output), { recursive: true });
    const evidence = 'existing evidence\r\n保留原始报告\n';
    writeFileSync(output, evidence);
    const result = run(output);
    expect(result.status).not.toBe(0);
    expect(readFileSync(output, 'utf8')).toBe(evidence);
  });
});
