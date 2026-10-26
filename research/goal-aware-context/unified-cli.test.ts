import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const base = join(root, '.Codex/workspace/goal-aware-context/unified-runner/cli-tests');
mkdirSync(base, { recursive: true });
const tsx = createRequire(import.meta.url).resolve('tsx/cli');
function run(args: string[]) {
  return spawnSync(
    process.execPath,
    [
      tsx,
      '--tsconfig',
      'research/goal-aware-context/tsconfig.json',
      'research/goal-aware-context/unified-cli.ts',
      ...args,
    ],
    {
      cwd: root,
      windowsHide: true,
      encoding: 'utf8',
      env: { ...process.env, CODESIGN_RESEARCH_API_KEY: 'DO_NOT_READ_OR_WRITE_THIS_PRIVATE_VALUE' },
    },
  );
}
describe('unified one-command dry-run', () => {
  it('writes an auditable plan, zero-call report and empty journals without credentials', () => {
    const folder = mkdtempSync(join(base, 'run-')),
      config = join(folder, 'config.json'),
      output = join(folder, 'output');
    writeFileSync(
      config,
      JSON.stringify({
        caseIds: ['s01-c49'],
        hostCaseIds: ['signup-ready'],
        budgets: [2048],
        trials: 1,
      }),
    );
    const result = run(['--config', config, '--output', output]);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
    const plan = JSON.parse(readFileSync(join(output, 'plan.json'), 'utf8'));
    expect(report.mode).toBe('dry-run');
    expect(report.plannedCalls.total).toBe(25);
    expect(report.actualProviderCalls).toBe(0);
    expect(plan.config.models.reader.model.provider).toBe('unconfigured');
    expect(JSON.stringify(plan)).not.toContain('acceptedAnswers');
    expect(JSON.stringify(plan)).not.toContain('DO_NOT_READ_OR_WRITE_THIS_PRIVATE_VALUE');
    for (const journal of ['calls.jsonl', 'contexts.jsonl', 'observations.jsonl'])
      expect(readFileSync(join(output, journal), 'utf8')).toBe('');
    const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
    expect(manifest.planHash).toBe(plan.planHash);
  });
  it('refuses an existing output directory and preserves its contents', () => {
    const output = mkdtempSync(join(base, 'existing-'));
    const file = join(output, 'report.json');
    writeFileSync(file, 'original evidence');
    expect(run(['--output', output]).status).not.toBe(0);
    expect(readFileSync(file, 'utf8')).toBe('original evidence');
  });
  it('requires an explicit config and call cap for execute and rejects unknown flags', () => {
    const folder = mkdtempSync(join(base, 'blocked-')),
      output = join(folder, 'output');
    expect(run(['--execute', '--output', output]).status).not.toBe(0);
    expect(existsSync(output)).toBe(false);
    expect(run(['--api-key', 'NO_SECRET_ON_COMMAND_LINE']).status).not.toBe(0);
  });
});
