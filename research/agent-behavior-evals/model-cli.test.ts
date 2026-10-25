import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures } from './fixtures.mjs';
import { main } from './model-cli';
import type { Completion } from './model-runner';

const providerBoundary = vi.hoisted(() => ({ complete: vi.fn<Completion>() }));
vi.mock('../../packages/providers/src/index', () => providerBoundary);

const directories: string[] = [];
const config = {
  schemaVersion: 1,
  model: { provider: 'openai', modelId: 'fixture-model' },
  credentialEnv: 'TEST_EVAL_KEY',
  caseIds: ['selection-1'],
  maxCalls: 1,
};
async function setup(input = config) {
  const root = await mkdtemp(join(tmpdir(), 'codesign-behavior-evals-'));
  directories.push(root);
  const file = join(root, 'config.json');
  const output = join(root, 'run');
  await writeFile(file, JSON.stringify(input));
  return { root, file, output, args: ['--config', file, '--output', output] };
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('model evaluation CLI', () => {
  it('loads the existing provider completion entry point in execute mode', async () => {
    const { args } = await setup();
    const positive = fixtures.find((f) => f.id === 'selection-1')?.positive;
    providerBoundary.complete.mockResolvedValue({
      content: JSON.stringify(positive),
      inputTokens: 2,
      outputTokens: 1,
      costUsd: 0,
    });
    expect(
      await main([...args, '--execute'], {
        environment: { TEST_EVAL_KEY: 'fixture-secret' },
        log: () => {},
      }),
    ).toBe(0);
    expect(providerBoundary.complete).toHaveBeenCalledWith(
      config.model,
      expect.any(Array),
      expect.objectContaining({ apiKey: 'fixture-secret', maxTokens: 1024 }),
    );
    providerBoundary.complete.mockReset();
  });
  it('defaults to dry-run, without credentials or completion calls', async () => {
    const { args, output } = await setup();
    const complete = vi.fn<Completion>();
    const environment = new Proxy(
      {},
      {
        get: () => {
          throw new Error('must not read credentials');
        },
      },
    );
    expect(await main(args, { environment, complete, log: () => {} })).toBe(0);
    expect(complete).not.toHaveBeenCalled();
    expect(await readdir(output)).toEqual(['manifest.json']);
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
    expect(manifest.mode).toBe('dry-run');
    expect(manifest.plan.authorizedCalls).toBe(1);
    expect(manifest.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('writes manifest, streaming observations and a scored report without secrets', async () => {
    const { args, output } = await setup();
    const positive = fixtures.find((f) => f.id === 'selection-1')?.positive;
    const complete = vi.fn<Completion>().mockResolvedValue({
      content: JSON.stringify(positive),
      inputTokens: 10,
      outputTokens: 4,
      costUsd: 0,
    });
    const dependencies = {
      complete,
      environment: { TEST_EVAL_KEY: 'private-cli-key' },
      log: () => {},
    };
    expect(await main([...args, '--execute'], dependencies)).toBe(0);
    const manifest = await readFile(join(output, 'manifest.json'), 'utf8');
    const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
    const journal = await readFile(join(output, 'observations.jsonl'), 'utf8');
    expect(report.summary).toMatchObject({ scheduled: 1, passed: 1 });
    expect(JSON.parse(journal.trim())).toEqual(report.rows[0]);
    expect(`${manifest}${JSON.stringify(report)}${journal}`).not.toContain('private-cli-key');
    await expect(main([...args, '--execute'], dependencies)).rejects.toThrow();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(await readFile(join(output, 'manifest.json'), 'utf8')).toBe(manifest);
  });
  it('refuses live mode without the explicitly selected credential', async () => {
    const { args } = await setup();
    const complete = vi.fn<Completion>();
    await expect(
      main([...args, '--execute'], { environment: {}, complete, log: () => {} }),
    ).rejects.toThrow('TEST_EVAL_KEY');
    expect(complete).not.toHaveBeenCalled();
  });
  it('reports wrong decisions as exit 1 and provider failures as exit 2', async () => {
    for (const providerFailure of [false, true]) {
      const { args } = await setup();
      const complete = vi.fn<Completion>();
      if (providerFailure) complete.mockRejectedValue(new Error('secret gateway details'));
      else
        complete.mockResolvedValue({ content: '{}', inputTokens: 1, outputTokens: 1, costUsd: 0 });
      expect(
        await main([...args, '--execute'], {
          complete,
          environment: { TEST_EVAL_KEY: 'secret' },
          log: () => {},
        }),
      ).toBe(providerFailure ? 2 : 1);
    }
  });
  it('flushes a complete denominator when cancelled and returns exit 130', async () => {
    const { args, output } = await setup();
    const controller = new AbortController();
    controller.abort();
    const complete = vi.fn<Completion>();
    expect(
      await main([...args, '--execute'], {
        complete,
        signal: controller.signal,
        environment: { TEST_EVAL_KEY: 'secret' },
        log: () => {},
      }),
    ).toBe(130);
    const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
    expect(report.rows[0].status).toBe('skipped_cancelled');
    expect(report.summary.scheduled).toBe(1);
    expect(complete).not.toHaveBeenCalled();
  });
});
