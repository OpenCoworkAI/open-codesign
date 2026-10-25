import { type ExecFileSyncOptionsWithStringEncoding, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { buildPlan, type Completion, hash, runModelEvaluation } from './model-runner';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const sourceFiles = [
  'model-cli.ts',
  'model-config.ts',
  'model-runner.ts',
  'evaluate.mjs',
  'fixtures.mjs',
  'datasets.mjs',
  'session-fixtures.mjs',
  'response-schema.ts',
  'decision-shape.ts',
  'execution-guard.ts',
  'guard-scenarios.ts',
  '../../packages/providers/src/index.ts',
  '../../pnpm-lock.yaml',
];

async function sourceProvenance() {
  const sources = await Promise.all(
    sourceFiles.map(async (file) => ({
      file,
      hash: hash(await readFile(resolve(here, file), 'utf8')),
    })),
  );
  let gitCommit: string | null = null;
  let worktreeDirty: boolean | null = null;
  try {
    const options: ExecFileSyncOptionsWithStringEncoding = {
      cwd: repo,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    };
    gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], options).trim();
    worktreeDirty = execFileSync('git', ['status', '--porcelain'], options).trim().length > 0;
  } catch {
    /* Source hashes remain available outside a Git checkout. */
  }
  return { gitCommit, worktreeDirty, sourceHash: hash(sources), sources };
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export async function main(
  args: string[],
  dependencies: {
    environment?: NodeJS.ProcessEnv;
    complete?: Completion;
    signal?: AbortSignal;
    log?: (message: string) => void;
  } = {},
): Promise<number> {
  let values: { config?: string; output?: string; execute?: boolean; help?: boolean };
  try {
    ({ values } = parseArgs({
      args,
      options: {
        config: { type: 'string' },
        output: { type: 'string' },
        execute: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    throw new Error('Invalid CLI arguments; use --help');
  }
  const log = dependencies.log ?? console.log;
  if (values.help) {
    log(
      'Usage: pnpm exec tsx research/agent-behavior-evals/model-cli.ts --config config.json [--output NEW_DIRECTORY] [--execute]\nDefault: dry run, no credential reads or provider calls.',
    );
    return 0;
  }
  if (!values.config) throw new Error('--config is required');
  let config: unknown;
  const configText = await readFile(resolve(values.config), 'utf8');
  try {
    config = JSON.parse(configText) as unknown;
  } catch {
    throw new Error('Config must be valid JSON');
  }
  const plan = buildPlan(config);
  let apiKey = '';
  if (values.execute) {
    apiKey = (dependencies.environment ?? process.env)[plan.config.credentialEnv]?.trim() ?? '';
    if (!apiKey)
      throw new Error(
        `Set the selected environment variable ${plan.config.credentialEnv} before --execute`,
      );
    if (plan.config.model.modelId === 'REPLACE_WITH_EXACT_MODEL_ID')
      throw new Error('Replace the example model ID before --execute');
  }
  const runId = randomUUID();
  const output = resolve(values.output ?? `.Codex/workspace/agent-behavior-evals/model-${runId}`);
  await mkdir(dirname(output), { recursive: true });
  // Never overwrite or append to another run's evidence.
  await mkdir(output);
  const manifest = {
    schemaVersion: 1,
    runId,
    startedAt: new Date().toISOString(),
    mode: values.execute ? 'execute' : 'dry-run',
    node: process.version,
    ...(await sourceProvenance()),
    plan,
  };
  await writeFile(resolve(output, 'manifest.json'), json(manifest), { flag: 'wx' });
  log(
    `${values.execute ? 'Execute' : 'Dry run'}: ${plan.plannedCalls} scheduled; at most ${plan.authorizedCalls} provider calls. ${output}`,
  );
  if (!values.execute) return 0;

  // Loading the existing provider module is deliberately after the dry-run return.
  const completion =
    dependencies.complete ?? (await import('../../packages/providers/src/index')).complete;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  const signal = dependencies.signal
    ? AbortSignal.any([controller.signal, dependencies.signal])
    : controller.signal;
  try {
    await writeFile(resolve(output, 'observations.jsonl'), '', { flag: 'wx' });
    const report = await runModelEvaluation(plan, {
      complete: completion,
      apiKey,
      signal,
      onObservation: async (row) => {
        await appendFile(resolve(output, 'observations.jsonl'), `${JSON.stringify(row)}\n`);
      },
    });
    await writeFile(
      resolve(output, 'report.json'),
      json({
        ...report,
        runId,
        sourceHash: manifest.sourceHash,
        finishedAt: new Date().toISOString(),
      }),
      { flag: 'wx' },
    );
    log(
      `Passed ${report.summary.passed}/${report.summary.scheduled}; attempted ${report.summary.attempted}. Report: ${resolve(output, 'report.json')}`,
    );
    if (signal.aborted) return 130;
    if (
      report.rows.some((r) =>
        ['provider_error', 'truncated', 'timeout', 'skipped_call_limit'].includes(r.status),
      )
    )
      return 2;
    return report.summary.passed === report.summary.scheduled ? 0 : 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Evaluation runner failed');
      process.exitCode = 2;
    },
  );
}
