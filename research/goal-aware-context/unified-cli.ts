import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { assertExecutableConfig, parseUnifiedConfig } from './unified-config.js';
import { loadUnifiedData, prepareUnifiedPlan } from './unified-plan.js';
import { type RunDependencies, runUnified } from './unified-runner.js';

class CliError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
function args(values: string[]) {
  let output: string | undefined,
    config: string | undefined,
    execute = false;
  for (let i = 0; i < values.length; i++) {
    const flag = values[i];
    if (flag === '--execute') {
      execute = true;
      continue;
    }
    if (flag !== '--output' && flag !== '--config') throw new CliError('unknown-argument');
    const value = values[++i];
    if (!value || value.startsWith('--')) throw new CliError('missing-argument-value');
    if (flag === '--output') {
      if (output) throw new CliError('duplicate-argument');
      output = value;
    } else {
      if (config) throw new CliError('duplicate-argument');
      config = value;
    }
  }
  if (execute && !config) throw new CliError('execute-requires-config');
  return {
    execute,
    config,
    output: resolve(
      output ??
        '.Codex/workspace/goal-aware-context/unified-' +
          Date.now() +
          '-' +
          randomUUID().slice(0, 8),
    ),
  };
}
async function main() {
  const options = args(process.argv.slice(2));
  const config = parseUnifiedConfig(
    options.config ? JSON.parse(readFileSync(resolve(options.config), 'utf8')) : {},
  );
  if (options.execute) assertExecutableConfig(config);
  mkdirSync(dirname(options.output), { recursive: true });
  mkdirSync(options.output);
  const file = (name: string) => resolve(options.output, name);
  const write = (name: string, value: unknown) =>
    writeFileSync(file(name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  const append = (name: string, value: unknown) =>
    appendFileSync(file(name), `${JSON.stringify(value)}\n`);
  for (const journal of ['calls.jsonl', 'contexts.jsonl', 'observations.jsonl'])
    writeFileSync(file(journal), '', { flag: 'wx' });
  const workspace = file('workspaces');
  mkdirSync(workspace);
  const prepared = prepareUnifiedPlan(loadUnifiedData(), config, workspace);
  write('plan.json', prepared.plan);
  write('manifest.json', {
    schemaVersion: 1,
    protocol: prepared.plan.protocol,
    planHash: prepared.plan.planHash,
    sourceHashes: prepared.plan.sourceHashes,
    models: config.models,
    mode: options.execute ? 'execute' : 'dry-run',
    createdAt: new Date().toISOString(),
  });
  let dependencies: RunDependencies | undefined;
  if (options.execute) {
    const { complete } = await import('../../packages/providers/src/index.js');
    dependencies = {
      complete,
      getCredential: (name: string) => process.env[name],
      onRequest: (request: unknown) => append('calls.jsonl', { event: 'about-to-call', request }),
    };
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const result = await runUnified(
      prepared,
      {
        execute: options.execute,
        workspace,
        signal: controller.signal,
        onCall: (row) => append('calls.jsonl', { event: 'response', ...row }),
        onContext: (row) => append('contexts.jsonl', row),
        onObservation: (row) => append('observations.jsonl', row),
      },
      dependencies,
    );
    write('report.json', result.report);
    process.stdout.write(
      `${JSON.stringify({
        output: options.output,
        mode: result.report.mode,
        plannedCalls: result.report.plannedCalls,
        actualProviderCalls: result.report.actualProviderCalls,
      })}\n`,
    );
    if (options.execute && result.observations.some((row) => row.status !== 'ok'))
      process.exitCode = 2;
  } catch {
    write('report.json', {
      schemaVersion: 1,
      mode: options.execute ? 'execute' : 'dry-run',
      status: 'incomplete',
      planHash: prepared.plan.planHash,
      reason: 'execution-or-journal-error; partial journals retained',
    });
    throw new CliError('execution-failed');
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const ioCode =
      typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    const code =
      error instanceof CliError
        ? error.code
        : error instanceof z.ZodError
          ? 'invalid-config-or-data'
          : ioCode === 'EEXIST'
            ? 'output-exists'
            : 'preparation-failed';
    process.stderr.write(
      `Unified evaluation failed (${code}). No provider error details are logged.\n`,
    );
    process.exitCode = 1;
  });
}
