import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hashJson } from './corpus.js';
import { prepareMemoryStudy, runMemoryStudy } from './memory-study.js';
import { prepareStateCalibration, runStateCalibration } from './state-reader-calibration.js';
import { prepareStateStress, runStateStress } from './state-stress.js';
import { assertExecutableConfig } from './unified-config.js';
import type { SessionDependencies, UnifiedCallResult } from './unified-session.js';

type Track = 'calibration' | 'stress' | 'memory-study';
interface RunOptions {
  execute?: boolean;
  signal?: AbortSignal;
  onCall?: (row: UnifiedCallResult) => void;
  onObservation?: (row: unknown) => void;
}
function parseArgs(values: string[]) {
  const flags = new Map<string, string>();
  let execute = false;
  for (let i = 0; i < values.length; i++) {
    const flag = values[i];
    if (flag === '--execute') {
      if (execute) throw new Error('duplicate-argument');
      execute = true;
      continue;
    }
    if (!flag || !['--output', '--config', '--track', '--preflight'].includes(flag))
      throw new Error('unknown-argument');
    const value = values[++i];
    if (!value || value.startsWith('--')) throw new Error('missing-argument-value');
    if (flags.has(flag)) throw new Error('duplicate-argument');
    flags.set(flag, value);
  }
  const output = flags.get('--output'),
    configPath = flags.get('--config'),
    preflight = flags.get('--preflight');
  const track = flags.get('--track') ?? 'stress';
  if (track !== 'calibration' && track !== 'stress' && track !== 'memory-study')
    throw new Error('unknown-track');
  if (!output) throw new Error('Explicit new output directory required');
  if (execute && (!configPath || !preflight || !flags.has('--track')))
    throw new Error('execute-requires-config-track-preflight');
  if (!execute && preflight) throw new Error('preflight-requires-execute');
  return { output: resolve(output), configPath, preflight, track, execute } as const;
}
function prepareTrack(track: Track, value: unknown) {
  if (track === 'memory-study') {
    const prepared = prepareMemoryStudy(value);
    return {
      plan: prepared.plan,
      run: (options: RunOptions, deps?: SessionDependencies) =>
        runMemoryStudy(prepared, options, deps),
    };
  }
  if (track === 'calibration') {
    const prepared = prepareStateCalibration(value);
    return {
      plan: prepared.plan,
      run: (options: RunOptions, deps?: SessionDependencies) =>
        runStateCalibration(prepared, options, deps),
    };
  }
  const prepared = prepareStateStress(value);
  return {
    plan: prepared.plan,
    run: (options: RunOptions, deps?: SessionDependencies) =>
      runStateStress(prepared, options, deps),
  };
}

/** Providers load only for explicit execution of a matching offline preflight. */
export async function stateEvaluationCli(
  values: string[],
  dependencies?: SessionDependencies,
  signal?: AbortSignal,
) {
  const options = parseArgs(values);
  const value = options.configPath
    ? JSON.parse(readFileSync(resolve(options.configPath), 'utf8'))
    : {
        budgets: [2048],
        trials: 1,
        maxCalls:
          options.track === 'calibration' ? 12 : options.track === 'memory-study' ? 112 : 64,
        maxOutputTokens: 4096,
        summaryMaxBytes: 1800,
        ...(options.track === 'memory-study' ? { study: 'short' } : {}),
      };
  const prepared = prepareTrack(options.track, value);
  const config = prepared.plan.config;
  if (options.execute) assertExecutableConfig(config);
  if (
    options.preflight &&
    hashJson(JSON.parse(readFileSync(resolve(options.preflight), 'utf8'))) !==
      hashJson(prepared.plan)
  )
    throw new Error('preflight-mismatch');
  const directory = options.output;
  mkdirSync(dirname(directory), { recursive: true });
  mkdirSync(directory);
  const write = (file: string, value: unknown, flag: 'wx' | 'w' = 'wx') =>
    writeFileSync(resolve(directory, file), `${JSON.stringify(value, null, 2)}\n`, { flag });
  const append = (file: string, value: unknown) =>
    appendFileSync(resolve(directory, file), `${JSON.stringify(value)}\n`);
  const mode = options.execute ? 'execute' : 'dry-run';
  const metadata = {
    schemaVersion: 1,
    executorPid: process.pid,
    protocol: prepared.plan.protocol,
    track: options.track,
    mode,
    planHash: prepared.plan.planHash,
    reviewId: prepared.plan.reviewId,
    reviewHash: prepared.plan.reviewHash,
    annotationStatus: prepared.plan.annotationStatus,
    readerContractId: prepared.plan.readerContractId,
    plannedCalls: prepared.plan.plannedCalls,
  };
  write('plan.json', prepared.plan);
  write('manifest.json', {
    ...metadata,
    fixtureHash: prepared.plan.fixtureHash,
    referenceHash: prepared.plan.referenceHash,
    implementationHash: prepared.plan.implementationHash,
    createdAt: new Date().toISOString(),
    preflightPlanHash: options.preflight ? prepared.plan.planHash : null,
    models: config.models,
  });
  for (const file of ['calls.jsonl', 'observations.jsonl'])
    writeFileSync(resolve(directory, file), '', { flag: 'wx' });
  write('report.json', {
    ...metadata,
    status: options.execute ? 'running' : 'preparing',
    actualProviderCalls: null,
    groups: null,
  });
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    let deps = dependencies;
    if (options.execute && !deps) {
      const { complete } = await import('../../packages/providers/src/index.js');
      deps = { complete, getCredential: (name) => process.env[name] };
    }
    const externalOnRequest = deps?.onRequest;
    const result = await prepared.run(
      {
        execute: options.execute,
        signal: controller.signal,
        onCall: (row) => append('calls.jsonl', { event: 'response', ...row }),
        onObservation: (row) => append('observations.jsonl', row),
      },
      deps && {
        ...deps,
        onRequest: (request) => {
          append('calls.jsonl', { event: 'about-to-call', request });
          externalOnRequest?.(request);
        },
      },
    );
    const incomplete =
      options.execute &&
      (controller.signal.aborted || result.observations.some((row) => row.status !== 'ok'));
    const readiness = 'readiness' in result.report ? result.report.readiness : null;
    write(
      'report.json',
      {
        ...metadata,
        ...result.report,
        status: incomplete ? 'incomplete' : options.execute ? 'complete' : 'prepared',
        interrupted: controller.signal.aborted,
      },
      'w',
    );
    return {
      output: directory,
      mode,
      plannedCalls: result.report.plannedCalls,
      actualProviderCalls: result.report.actualProviderCalls,
      readiness,
      exitCode: incomplete ? 2 : 0,
    };
  } catch {
    try {
      write(
        'report.json',
        {
          ...metadata,
          status: 'incomplete',
          reason: 'execution-or-journal-error; partial journals retained',
          actualProviderCalls: null,
          groups: null,
        },
        'w',
      );
    } catch {
      /* The initial running report and existing journals remain available. */
    }
    throw new Error('execution-failed');
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    signal?.removeEventListener('abort', cancel);
  }
}

/** Backward-compatible preparation function; never enables execution. */
export async function stateStressDryRun(values: string[]) {
  if (values.includes('--execute')) throw new Error('dry-run-only');
  return stateEvaluationCli(values);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  stateEvaluationCli(process.argv.slice(2))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exitCode = result.exitCode;
    })
    .catch(() => {
      process.stderr.write(
        'State evaluation failed: verify arguments, config, matching preflight and new output directory; partial journals are retained when available.\n',
      );
      process.exitCode = 1;
    });
}
