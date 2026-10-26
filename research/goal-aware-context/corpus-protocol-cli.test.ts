import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('audits the frozen corpus offline and refuses to overwrite evidence', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const outputRoot = join(root, '.Codex/workspace/goal-aware-context/protocol-cli-verification');
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
        'research/goal-aware-context/run-corpus-protocol.ts',
        output,
      ],
      { cwd: root, windowsHide: true, encoding: 'utf8' },
    );
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  const original = readFileSync(output, 'utf8');
  const report = JSON.parse(original);
  expect(report.kind).toBe('synthetic-corpus-protocol-audit');
  expect(report.summary).toMatchObject({ sessions: 8, checkpoints: 10, questions: 35 });
  expect(report.modelCalls).toBe(0);
  for (const entry of report.cases) {
    expect(entry.questionMeasurements.length).toBeGreaterThanOrEqual(3);
    for (const question of entry.questionMeasurements) {
      expect(question.measurements.map((m: { unit: string }) => m.unit)).toEqual([
        'estimate',
        'estimate',
        'estimate',
      ]);
    }
  }
  const repeated = run();
  expect(repeated.status).not.toBe(0);
  expect(readFileSync(output, 'utf8')).toBe(original);
}, 20000);
