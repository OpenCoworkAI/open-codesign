import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashJson } from './corpus.js';
import { validateHostJob } from './state-host-policy.js';
import { parseUnifiedConfig } from './unified-config.js';

function fixture() {
  const parent = mkdtempSync(join(tmpdir(), 'state-host-policy-')),
    root = join(parent, 'goal');
  mkdirSync(root);
  const target = {
    model: { provider: 'fixture', modelId: 'fixture' },
    credentialEnv: 'TEST_KEY',
    allowKeyless: true,
    contextWindowTokens: 32768,
    baseUrl: 'https://fixture.example/v1',
  };
  const config = parseUnifiedConfig({
    models: { compressor: target, reader: target },
    budgets: [2048],
    trials: 1,
    maxCalls: 12,
    maxOutputTokens: 4096,
    summaryMaxBytes: 1800,
  });
  const configPath = join(root, 'config.json'),
    preflightPath = join(root, 'plan.json');
  const save = () => {
    writeFileSync(configPath, JSON.stringify(config));
    const body = {
      protocol: 'test-plan@1',
      config,
      plannedCalls: { compressor: 0, reader: 12, total: 12 },
    };
    writeFileSync(preflightPath, JSON.stringify({ ...body, planHash: hashJson(body) }));
  };
  save();
  const seedConfig = structuredClone(config);
  const policy = { root, seedConfig, remainingCalls: 300, seenPlans: new Set<string>() };
  const job = {
    id: 'calibration-v2-001',
    track: 'calibration',
    config: configPath,
    preflight: preflightPath,
    output: join(root, 'new-output'),
  };
  return { root, parent, config, configPath, preflightPath, save, policy, job };
}
describe('bounded experiment host policy', () => {
  it('preserves future experiment dimensions while leaving executable validation to the fixed child CLI', () => {
    const f = fixture();
    const config = {
      ...f.config,
      experiment: { methods: ['ordinary-summary', 'stable-handoff'], schedule: [1, 3] },
      repetition: 2,
    };
    const body = {
      protocol: 'future-plan@1',
      config,
      plannedCalls: { compressor: 8, reader: 4, total: 12 },
    };
    writeFileSync(f.configPath, JSON.stringify(config));
    writeFileSync(f.preflightPath, JSON.stringify({ ...body, planHash: hashJson(body) }));
    const result = validateHostJob(f.job, f.policy);
    expect(result.config).toMatchObject({ experiment: config.experiment, repetition: 2 });
    expect(result.preflight).toMatchObject({
      config: { experiment: config.experiment, repetition: 2 },
    });
  });
  it('accepts only a frozen local plan and returns independent snapshots', () => {
    const f = fixture(),
      result = validateHostJob(f.job, f.policy);
    expect(result.reserveCalls).toBe(12);
    expect(result.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.outputPath).toBe(f.job.output);
    writeFileSync(f.configPath, 'changed after validation');
    expect(result.config.models).toEqual(f.policy.seedConfig.models);
    expect(result.preflight.config.models).toEqual(f.policy.seedConfig.models);
  });
  it.each(['config', 'preflight', 'output'])('refuses cwd-external %s paths', (field) => {
    const f = fixture(),
      outside = join(f.parent, 'outside.json');
    writeFileSync(outside, readFileSync(f.configPath));
    expect(() => validateHostJob({ ...f.job, [field]: outside }, f.policy)).toThrow(
      /path|root|outside/i,
    );
  });
  it('rejects a junction/symlink escaping the allowed root, including future output', () => {
    const f = fixture(),
      outside = join(f.parent, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'config.json'), readFileSync(f.configPath));
    const link = join(f.root, 'escape');
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    for (const job of [
      { ...f.job, config: join(link, 'config.json') },
      { ...f.job, output: join(link, 'future', 'result') },
    ])
      expect(() => validateHostJob(job, f.policy)).toThrow(/path|root|outside/i);
  });
  it.each([
    'model',
    'endpoint',
    'credentialEnv',
    'window',
    'outputTokens',
    'summaryBytes',
    'timeout',
  ])('locks the existing %s configuration', (field) => {
    const f = fixture();
    if (field === 'model') f.config.models.reader.model.modelId = 'different';
    if (field === 'endpoint') f.config.models.reader.baseUrl = 'https://other.example/v1';
    if (field === 'credentialEnv') f.config.models.reader.credentialEnv = 'OTHER_KEY';
    if (field === 'window') f.config.models.reader.contextWindowTokens = 65536;
    if (field === 'outputTokens') f.config.maxOutputTokens = 8192;
    if (field === 'summaryBytes') f.config.summaryMaxBytes = 3600;
    if (field === 'timeout') f.config.timeoutMs = 120000;
    f.save();
    expect(() => validateHostJob(f.job, f.policy)).toThrow(/model|policy|config|limit/i);
  });
  it('reserves the configured hard cap, refuses budget exhaustion and duplicate plans', () => {
    const f = fixture();
    expect(() => validateHostJob(f.job, { ...f.policy, remainingCalls: 11 })).toThrow(
      /budget|cap|calls/i,
    );
    const first = validateHostJob(f.job, f.policy);
    f.policy.seenPlans.add(first.planHash);
    expect(() =>
      validateHostJob(
        { ...f.job, id: 'another-output', output: join(f.root, 'different') },
        f.policy,
      ),
    ).toThrow(/duplicate|seen|replay/i);
  });
  it('rejects modified preflights, mismatched config and existing output', () => {
    const f = fixture(),
      plan = JSON.parse(readFileSync(f.preflightPath, 'utf8'));
    plan.config.trials = 2;
    writeFileSync(f.preflightPath, JSON.stringify(plan));
    expect(() => validateHostJob(f.job, f.policy)).toThrow(/hash|preflight|plan/i);
    f.save();
    f.config.maxCalls = 11;
    writeFileSync(f.configPath, JSON.stringify(f.config));
    expect(() => validateHostJob(f.job, f.policy)).toThrow(/config|preflight|plan/i);
    f.save();
    mkdirSync(f.job.output);
    expect(() => validateHostJob(f.job, f.policy)).toThrow(/exist|output/i);
  });
  it.each([
    { command: 'arbitrary shell' },
    { track: 'stress; echo secret' },
    { id: '../escape' },
  ])('rejects commands or unsafe identifiers: %j', (extra) => {
    const f = fixture();
    expect(() => validateHostJob({ ...f.job, ...extra }, f.policy)).toThrow();
  });
});
