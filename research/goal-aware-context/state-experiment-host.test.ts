import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStateExperimentHost } from './state-experiment-host.js';
import { prepareStateCalibration } from './state-reader-calibration.js';
import { parseUnifiedConfig } from './unified-config.js';

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'state-experiment-host-')),
    directory = join(root, 'host');
  const target = {
    model: { provider: 'fixture', modelId: 'fixture' },
    credentialEnv: 'HOST_SMOKE_KEY_NEVER_SET',
    contextWindowTokens: 32768,
  };
  const config = parseUnifiedConfig({
    models: { compressor: target, reader: target },
    budgets: [2048],
    trials: 1,
    maxCalls: 12,
    maxOutputTokens: 4096,
    summaryMaxBytes: 1800,
    allowEstimatedBudget: true,
  });
  const plan = prepareStateCalibration(config).plan,
    configPath = join(root, 'config.json'),
    preflightPath = join(root, 'preflight.json');
  writeFileSync(configPath, JSON.stringify(config));
  writeFileSync(preflightPath, JSON.stringify(plan));
  const job = {
    id: 'calibration-001',
    track: 'calibration',
    config: configPath,
    preflight: preflightPath,
    output: join(root, 'output'),
  };
  return { root, directory, config, plan, configPath, preflightPath, job };
}
describe('local bounded experiment host', () => {
  it('is idle until an explicit request and reserves calls before executing snapshots', async () => {
    const f = fixture();
    let invoked = 0;
    const host = createStateExperimentHost({
      ...f,
      maxCalls: 24,
      runner: async (request) => {
        invoked++;
        expect(host.snapshot().reservedCalls).toBe(12);
        expect(read(join(f.directory, 'results', `${f.job.id}.json`)).status).toBe('running');
        expect(request.configPath).not.toBe(f.configPath);
        writeFileSync(f.configPath, 'source changed');
        expect(read(request.configPath).models).toEqual(f.config.models);
        mkdirSync(request.outputPath);
        writeFileSync(
          join(request.outputPath, 'report.json'),
          JSON.stringify({
            planHash: f.plan.planHash,
            actualProviderCalls: 12,
            executorPid: 12345,
            status: 'complete',
          }),
        );
        request.onStart(12345);
        return { exitCode: 0, signal: null };
      },
    });
    expect(await host.processNext()).toBe(false);
    expect(invoked).toBe(0);
    writeFileSync(join(f.directory, 'requests', `${f.job.id}.json`), JSON.stringify(f.job));
    expect(await host.processNext()).toBe(true);
    expect(host.snapshot()).toMatchObject({
      reservedCalls: 12,
      remainingCalls: 12,
      activeJob: null,
    });
    expect(read(join(f.directory, 'results', `${f.job.id}.json`))).toMatchObject({
      status: 'completed',
      actualProviderCalls: 12,
    });
    expect(await host.processNext()).toBe(false);
    expect(invoked).toBe(1);
  });
  it('rejects malformed and duplicate plans without invoking a runner or silently retrying', async () => {
    const f = fixture();
    let invoked = 0;
    const host = createStateExperimentHost({
      ...f,
      maxCalls: 24,
      runner: async () => {
        invoked++;
        return { exitCode: 1, signal: null };
      },
    });
    writeFileSync(join(f.directory, 'requests', 'bad.json'), '{');
    await host.processNext();
    expect(host.snapshot().reservedCalls).toBe(0);
    writeFileSync(join(f.directory, 'requests', `${f.job.id}.json`), JSON.stringify(f.job));
    await host.processNext();
    writeFileSync(
      join(f.directory, 'requests', 'same-plan.json'),
      JSON.stringify({ ...f.job, id: 'same-plan', output: join(f.root, 'other') }),
    );
    await host.processNext();
    expect(invoked).toBe(1);
    expect(host.snapshot().reservedCalls).toBe(12);
    expect(read(join(f.directory, 'results', 'same-plan.json')).status).toBe('rejected');
  });
  it('refuses an exhausted budget and preserves the original host directory on restart', async () => {
    const f = fixture(),
      host = createStateExperimentHost({
        ...f,
        maxCalls: 11,
        runner: async () => {
          throw Error('must not run');
        },
      });
    writeFileSync(join(f.directory, 'requests', `${f.job.id}.json`), JSON.stringify(f.job));
    await host.processNext();
    expect(host.snapshot().reservedCalls).toBe(0);
    expect(read(join(f.directory, 'results', `${f.job.id}.json`)).status).toBe('rejected');
    expect(() => createStateExperimentHost({ ...f, maxCalls: 300 })).toThrow();
  });
  it('keeps an accepted failed job charged, logs no exception detail, and supports stopping a live runner', async () => {
    const f = fixture();
    let started: () => void = () => {};
    const start = new Promise<void>((resolve) => {
      started = resolve;
    });
    const host = createStateExperimentHost({
      ...f,
      maxCalls: 24,
      runner: async (request) => {
        request.onStart(123);
        started();
        await new Promise<void>((resolve) =>
          request.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
        throw Error('DO_NOT_PERSIST_PRIVATE_ERROR');
      },
    });
    writeFileSync(join(f.directory, 'requests', `${f.job.id}.json`), JSON.stringify(f.job));
    const work = host.processNext();
    await start;
    host.stop();
    await work;
    expect(host.snapshot()).toMatchObject({
      status: 'stopped',
      reservedCalls: 12,
      activeJob: null,
    });
    const raw = readFileSync(join(f.directory, 'results', `${f.job.id}.json`), 'utf8');
    expect(raw).not.toContain('DO_NOT_PERSIST_PRIVATE_ERROR');
    expect(read(join(f.directory, 'results', `${f.job.id}.json`)).actualProviderCalls).toBeNull();
  });
  it('rejects an untrusted child report that claims more than the reserved cap', async () => {
    const f = fixture(),
      host = createStateExperimentHost({
        ...f,
        maxCalls: 12,
        runner: async (request) => {
          request.onStart(123);
          mkdirSync(request.outputPath);
          writeFileSync(
            join(request.outputPath, 'report.json'),
            JSON.stringify({
              planHash: f.plan.planHash,
              actualProviderCalls: 13,
              status: 'complete',
              executorPid: 123,
            }),
          );
          return { exitCode: 0, signal: null };
        },
      });
    writeFileSync(join(f.directory, 'requests', `${f.job.id}.json`), JSON.stringify(f.job));
    await host.processNext();
    expect(read(join(f.directory, 'results', `${f.job.id}.json`))).toMatchObject({
      status: 'failed',
      actualProviderCalls: null,
    });
  });
  it('uses the real fixed CLI child without provider access when credentials are absent', async () => {
    const f = fixture();
    expect(process.env['HOST_SMOKE_KEY_NEVER_SET']).toBeUndefined();
    const host = createStateExperimentHost({ ...f, maxCalls: 12 });
    writeFileSync(join(f.directory, 'requests', `${f.job.id}.json`), JSON.stringify(f.job));
    await host.processNext();
    const result = read(join(f.directory, 'results', `${f.job.id}.json`));
    expect(result).toMatchObject({ status: 'incomplete', actualProviderCalls: 0, exitCode: 2 });
    expect(result.childPid).toBeGreaterThan(0);
    expect(read(join(f.job.output, 'report.json')).executorPid).toBe(result.childPid);
    expect(read(join(f.job.output, 'report.json')).groups.fullPrefix.total).toBe(27);
    expect(existsSync(join(f.directory, 'logs', `${f.job.id}.stdout.log`))).toBe(true);
  }, 15000);
  it('aborts the active worker when heartbeat persistence fails', async () => {
    const f = fixture();
    let started: () => void = () => {},
      release: () => void = () => {};
    let signal: AbortSignal | undefined;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const host = createStateExperimentHost({
      ...f,
      maxCalls: 24,
      runner: (request) => {
        signal = request.signal;
        started();
        return new Promise((resolve) => {
          release = () => resolve({ exitCode: 1, signal: null });
        });
      },
    });
    writeFileSync(join(f.directory, 'requests', `${f.job.id}.json`), JSON.stringify(f.job));
    const work = host.processNext();
    await ready;
    const statusPath = join(f.directory, 'host.json');
    unlinkSync(statusPath);
    mkdirSync(statusPath);
    let failed = false;
    try {
      host.heartbeat();
    } catch {
      failed = true;
    }
    const aborted = signal?.aborted;
    rmdirSync(statusPath);
    writeFileSync(statusPath, '{}');
    release();
    await work;
    expect(failed).toBe(true);
    expect(aborted).toBe(true);
    expect(host.snapshot().status).toBe('stopped');
  });
  it('does not claim completion when child exit code and report completion disagree', async () => {
    const f = fixture(),
      host = createStateExperimentHost({
        ...f,
        maxCalls: 12,
        runner: async (request) => {
          request.onStart(123);
          mkdirSync(request.outputPath);
          writeFileSync(
            join(request.outputPath, 'report.json'),
            JSON.stringify({
              planHash: f.plan.planHash,
              actualProviderCalls: 0,
              status: 'incomplete',
              executorPid: 123,
            }),
          );
          return { exitCode: 0, signal: null };
        },
      });
    writeFileSync(join(f.directory, 'requests', `${f.job.id}.json`), JSON.stringify(f.job));
    await host.processNext();
    expect(read(join(f.directory, 'results', `${f.job.id}.json`)).status).not.toBe('completed');
  });
});
