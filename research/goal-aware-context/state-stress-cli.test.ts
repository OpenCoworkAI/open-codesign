import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashJson } from './corpus.js';
import { stateEvaluationCli } from './state-stress-cli.js';
import type { SessionDependencies } from './unified-session.js';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'trace-state-cli-'));
  const config = join(root, 'config.json');
  const target = {
    model: { provider: 'fixture', modelId: 'fixture' },
    credentialEnv: 'CLI_FIXTURE_KEY',
    contextWindowTokens: 32768,
  };
  writeFileSync(
    config,
    JSON.stringify({
      models: { compressor: target, reader: target },
      budgets: [2048],
      trials: 1,
      maxCalls: 64,
      maxOutputTokens: 4096,
      summaryMaxBytes: 1800,
      allowEstimatedBudget: true,
    }),
  );
  return { root, config, output: join(root, 'execute'), dry: join(root, 'dry') };
}
const read = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const lines = (file: string) =>
  readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const deps: SessionDependencies = {
  getCredential: () => 'CLI_UNIQUE_SECRET',
  complete: async (_model, messages) => ({
    content: messages[0]?.content.includes('Summarize') ? '"unused"' : '{"states":[]}',
    inputTokens: 1,
    outputTokens: 1,
    costUsd: 0,
  }),
};
async function preflight(track = 'calibration') {
  const paths = setup();
  const result = await stateEvaluationCli(
    ['--track', track, '--config', paths.config, '--output', paths.dry],
    {
      getCredential: () => {
        throw Error('key');
      },
      complete: async () => {
        throw Error('provider');
      },
    },
  );
  return {
    ...paths,
    result,
    args: [
      '--track',
      track,
      '--config',
      paths.config,
      '--preflight',
      join(paths.dry, 'plan.json'),
      '--output',
      paths.output,
      '--execute',
    ],
  };
}
describe('state evaluation live entry', () => {
  it('prepares calibration with empty journals and no credential or provider access', async () => {
    const p = await preflight();
    expect(p.result.mode).toBe('dry-run');
    expect(p.result.plannedCalls.total).toBe(12);
    expect(p.result.actualProviderCalls).toBe(0);
    expect(p.result.exitCode).toBe(0);
    expect(read(join(p.dry, 'report.json')).groups).toBeNull();
    expect(readFileSync(join(p.dry, 'calls.jsonl'), 'utf8')).toBe('');
    expect(readFileSync(join(p.dry, 'observations.jsonl'), 'utf8')).toBe('');
    expect(JSON.stringify(read(join(p.dry, 'plan.json')))).not.toContain('acceptedValues');
  });
  it('records request intent before every provider call and every result immediately', async () => {
    const p = await preflight();
    let calls = 0;
    const result = await stateEvaluationCli(p.args, {
      ...deps,
      complete: async () => {
        calls++;
        const journal = lines(join(p.output, 'calls.jsonl'));
        expect(journal.at(-1)?.event).toBe('about-to-call');
        expect(journal.filter((r) => r.event === 'about-to-call')).toHaveLength(calls);
        return { content: '{"states":[]}', inputTokens: 1, outputTokens: 1, costUsd: 0 };
      },
    });
    expect(result.actualProviderCalls).toBe(12);
    expect(result.exitCode).toBe(0);
    const report = read(join(p.output, 'report.json'));
    expect(report.status).toBe('complete');
    expect(report.readiness.passed).toBe(false);
    expect(report.groups.fullPrefix.total).toBe(27);
    expect(lines(join(p.output, 'calls.jsonl'))).toHaveLength(24);
    expect(lines(join(p.output, 'observations.jsonl'))).toHaveLength(12);
    expect(read(join(p.output, 'manifest.json')).preflightPlanHash).toBe(
      read(join(p.dry, 'plan.json')).planHash,
    );
  });
  it('executes the separate 64-call stress track using the same durable entry', async () => {
    const p = await preflight('stress');
    const result = await stateEvaluationCli(p.args, {
      ...deps,
      complete: async (_model, messages) => ({
        content: messages[0]?.content.includes('Summarize')
          ? '{"summary":"fixture memory"}'
          : '{"states":[]}',
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0,
      }),
    });
    expect(result.plannedCalls.total).toBe(64);
    expect(result.actualProviderCalls).toBe(64);
    expect(result.exitCode).toBe(0);
    expect(read(join(p.output, 'report.json')).groups).toHaveLength(4);
    expect(lines(join(p.output, 'observations.jsonl'))).toHaveLength(32);
  });
  it.each([
    'provider-error',
    'missing-credential',
    'cancelled',
    'call-limit',
  ])('persists incomplete runtime results for %s', async (failure) => {
    const p = setup();
    const settings = read(p.config);
    if (failure === 'call-limit') settings.maxCalls = 2;
    writeFileSync(p.config, JSON.stringify(settings));
    await stateEvaluationCli(['--track', 'calibration', '--config', p.config, '--output', p.dry]);
    const controller = new AbortController();
    if (failure === 'cancelled') controller.abort();
    const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    const result = await stateEvaluationCli(
      [
        '--track',
        'calibration',
        '--config',
        p.config,
        '--preflight',
        join(p.dry, 'plan.json'),
        '--output',
        p.output,
        '--execute',
      ],
      {
        getCredential: () => (failure === 'missing-credential' ? undefined : 'CLI_UNIQUE_SECRET'),
        complete: async () => {
          if (failure === 'provider-error') throw Error('DO_NOT_LOG_API_PRIVATE_DETAILS');
          return { content: '{"states":[]}', inputTokens: 1, outputTokens: 1, costUsd: 0 };
        },
      },
      controller.signal,
    );
    expect(result.exitCode).toBe(2);
    const report = read(join(p.output, 'report.json'));
    expect(report.status).toBe('incomplete');
    expect(report.groups.fullPrefix.total).toBe(27);
    expect(lines(join(p.output, 'observations.jsonl'))).toHaveLength(12);
    expect(readFileSync(join(p.output, 'calls.jsonl'), 'utf8')).not.toContain(
      'DO_NOT_LOG_API_PRIVATE_DETAILS',
    );
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before);
  });
  it('redacts echoed credentials before durable response logging', async () => {
    const p = await preflight();
    const result = await stateEvaluationCli(p.args, {
      ...deps,
      complete: async () => ({
        content: '{"echo":"CLI_UNIQUE_SECRET"}',
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0,
      }),
    });
    expect(result.exitCode).toBe(2);
    expect(result.actualProviderCalls).toBe(1);
    expect(readFileSync(join(p.output, 'calls.jsonl'), 'utf8')).not.toContain('CLI_UNIQUE_SECRET');
  });
  it('retains partial calls and a safe incomplete report if observation persistence fails', async () => {
    const p = await preflight();
    await expect(
      stateEvaluationCli(p.args, {
        ...deps,
        complete: async () => {
          const observationPath = join(p.output, 'observations.jsonl');
          unlinkSync(observationPath);
          mkdirSync(observationPath);
          return { content: '{"states":[]}', inputTokens: 1, outputTokens: 1, costUsd: 0 };
        },
      }),
    ).rejects.toThrow(/execution-failed/);
    expect(lines(join(p.output, 'calls.jsonl'))).toHaveLength(2);
    expect(read(join(p.output, 'report.json'))).toMatchObject({
      status: 'incomplete',
      actualProviderCalls: null,
    });
  });
  it('refuses stale or modified preflights before creating output or using the provider', async () => {
    const p = await preflight();
    const planPath = join(p.dry, 'plan.json');
    const plan = read(planPath);
    plan.probePrompt += ' changed';
    const { planHash: _hash, ...body } = plan;
    plan.planHash = hashJson(body);
    writeFileSync(planPath, JSON.stringify(plan));
    await expect(
      stateEvaluationCli(p.args, {
        getCredential: () => {
          throw Error('key');
        },
        complete: async () => {
          throw Error('provider');
        },
      }),
    ).rejects.toThrow(/preflight/);
    expect(existsSync(p.output)).toBe(false);
  });
  it.each(
    [
      ['--execute'],
      ['--execute', '--track', 'calibration'],
      ['--track', 'unknown'],
      ['--execute', '--execute'],
      ['--api-key', 'DO_NOT_ECHO'],
      ['--track', 'calibration', '--track', 'stress'],
    ].map((args) => ({ args })),
  )('rejects incomplete or ambiguous arguments: %j', async ({ args }) => {
    const p = setup();
    await expect(stateEvaluationCli([...args, '--output', p.output])).rejects.toThrow();
    expect(existsSync(p.output)).toBe(false);
  });
  it('rejects a zero cap and preserves existing output', async () => {
    const p = await preflight();
    const original = read(p.config);
    original.maxCalls = 0;
    writeFileSync(p.config, JSON.stringify(original));
    await expect(stateEvaluationCli(p.args)).rejects.toThrow();
    expect(existsSync(p.output)).toBe(false);
    writeFileSync(p.config, JSON.stringify({ ...original, maxCalls: 64 }));
    await expect(
      stateEvaluationCli(['--track', 'calibration', '--config', p.config, '--output', p.dry]),
    ).rejects.toThrow();
    expect(read(join(p.dry, 'plan.json')).planHash).toBeDefined();
  });
});
