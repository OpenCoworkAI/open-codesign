import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { stateEvaluationCli } from './state-stress-cli.js';

it('prepares and executes the separate memory-study track through the journaled CLI', async () => {
  const root = mkdtempSync(join(tmpdir(), 'memory-study-cli-')),
    config = join(root, 'config.json'),
    dry = join(root, 'dry'),
    output = join(root, 'execute');
  const model = {
    model: { provider: 'fixture', modelId: 'fixture' },
    credentialEnv: 'MEMORY_CLI_KEY',
    contextWindowTokens: 32768,
  };
  writeFileSync(
    config,
    JSON.stringify({
      study: 'short',
      budgets: [2048],
      trials: 1,
      maxCalls: 112,
      maxOutputTokens: 4096,
      summaryMaxBytes: 1800,
      allowEstimatedBudget: true,
      models: { compressor: model, reader: model },
    }),
  );
  const result = await stateEvaluationCli([
    '--track',
    'memory-study',
    '--config',
    config,
    '--output',
    dry,
  ]);
  expect(result.plannedCalls.total).toBe(112);
  expect(result.actualProviderCalls).toBe(0);
  const executed = await stateEvaluationCli(
    [
      '--track',
      'memory-study',
      '--config',
      config,
      '--output',
      output,
      '--preflight',
      join(dry, 'plan.json'),
      '--execute',
    ],
    {
      getCredential: () => 'MEMORY_CLI_UNIQUE_SECRET',
      complete: async (_model, messages) => ({
        content: messages[0]?.content.startsWith('Maintain')
          ? '{"stableConstraints":"workspace w","handoff":"pending work"}'
          : messages[0]?.content.startsWith('Summarize')
            ? '{"summary":"workspace w pending work"}'
            : '{"states":[]}',
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0,
      }),
    },
  );
  expect(executed.exitCode).toBe(0);
  expect(executed.actualProviderCalls).toBe(112);
  const journal = readFileSync(join(output, 'calls.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((s) => JSON.parse(s));
  expect(journal.filter((r) => r.event === 'about-to-call')).toHaveLength(112);
  expect(journal.filter((r) => r.event === 'response')).toHaveLength(112);
  const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
  expect(report.track).toBe('memory-study');
  expect(report.status).toBe('complete');
  expect(report.groups).toHaveLength(8);
});
