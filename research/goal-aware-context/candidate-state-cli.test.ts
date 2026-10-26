import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('exports a development-only oracle audit with frozen packs and no human approval claim', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const outputRoot = join(root, '.Codex/workspace/goal-aware-context/state-cli-verification');
  mkdirSync(outputRoot, { recursive: true });
  const output = join(mkdtempSync(join(outputRoot, 'run-')), 'report.json');
  const tsx = createRequire(import.meta.url).resolve('tsx/cli');
  const run = () =>
    spawnSync(
      process.execPath,
      [
        tsx,
        '--tsconfig',
        'research/goal-aware-context/tsconfig.json',
        'research/goal-aware-context/run-candidate-state.ts',
        output,
      ],
      { cwd: root, windowsHide: true, encoding: 'utf8' },
    );
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  const original = readFileSync(output, 'utf8'),
    report = JSON.parse(original);
  expect(report.kind).toBe('draft-oracle-state-audit');
  expect(report.modelCalls).toBe(0);
  expect(report.humanReview).toBe('pending');
  expect(report.conditions).toHaveLength(24);
  expect(new Set(report.conditions.map((c: { caseId: string }) => c.caseId)).size).toBe(8);
  for (const item of report.conditions) {
    expect(item.result.mode).toBe('candidate');
    expect(item.result.measurement.unit).toBe('estimate');
    expect(item.frozen.contextHash).toMatch(/^[a-f0-9]{64}$/u);
  }
  expect(run().status).not.toBe(0);
  expect(readFileSync(output, 'utf8')).toBe(original);
}, 20000);
