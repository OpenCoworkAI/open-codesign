import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createModelSession, hash } from './model-session.mjs';

/** Explicit embedding entry point: the caller supplies credentials in memory, never in config/output. */
export async function runLive({
  experiment,
  experimentRoot,
  providerRoot,
  config,
  apiKey,
  output,
}) {
  if (!['scope', 'context'].includes(experiment)) throw new Error('Unknown experiment');
  const directory = experiment === 'scope' ? 'scoped-design-edits' : 'goal-aware-context';
  const moduleRoot = path.join(experimentRoot, 'research', directory);
  const module = await import(
    pathToFileURL(
      path.join(moduleRoot, experiment === 'scope' ? 'live-experiment.ts' : 'live-experiment.mjs'),
    ).href
  );
  const { complete } = await import(
    pathToFileURL(path.join(providerRoot, 'packages/providers/src/index.ts')).href
  );
  const { parseConfig } = await import(
    pathToFileURL(path.join(providerRoot, 'research/agent-behavior-evals/model-config.ts')).href
  );
  const checkedConfig = parseConfig(config);
  const maxCalls = experiment === 'scope' ? 12 : 20;
  const files = readdirSync(moduleRoot)
    .filter((file) => /\.(mjs|ts)$/.test(file))
    .map((file) => [file, hash(readFileSync(path.join(moduleRoot, file), 'utf8'))]);
  const providerFiles = [
    'packages/providers/src/index.ts',
    'pnpm-lock.yaml',
    'research/agent-behavior-evals/model-config.ts',
  ].map((file) => [file, hash(readFileSync(path.join(providerRoot, file), 'utf8'))]);
  const sourceFiles =
    experiment === 'scope'
      ? [
          'apps/desktop/src/main/source-edit-engine.ts',
          'apps/desktop/src/main/source-edit-provenance.ts',
          'packages/shared/src/source-edits.ts',
        ].map((file) => [file, hash(readFileSync(path.join(experimentRoot, file), 'utf8'))])
      : [];
  const gitHead = (cwd) =>
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', windowsHide: true }).trim();
  mkdirSync(output);
  writeFileSync(
    path.join(output, 'manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        experiment,
        model: checkedConfig,
        maxCalls,
        sourceFiles: files,
        engineFiles: sourceFiles,
        providerFiles,
        parentCommit: gitHead(experimentRoot),
        providerCommit: gitHead(providerRoot),
        node: process.version,
        createdAt: new Date().toISOString(),
        plan: experiment === 'scope' ? module.scopePlan() : module.contextPlan(),
        limits: { timeoutMs: 240000, maxOutputTokens: 8192, localContext: 16384 },
        caveats: [
          'one trial; synthetic development cases',
          'Codex prompt-only; Ollama JSON Schema',
          'Codex adapter may not enforce server-side output cap',
          'provider usage may exclude cache-read tokens; zero cost is not billing evidence',
        ],
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  const call = createModelSession({
    complete,
    config: checkedConfig,
    apiKey,
    maxCalls,
    journal: path.join(output, 'calls.jsonl'),
  });
  const rows = await (experiment === 'scope' ? module.scopeExperiment : module.contextExperiment)(
    path.join(output, 'experiment'),
    call,
  );
  writeFileSync(
    path.join(output, 'complete.json'),
    JSON.stringify({ completedAt: new Date().toISOString(), rows: rows.length }, null, 2),
    { flag: 'wx' },
  );
  return rows;
}
