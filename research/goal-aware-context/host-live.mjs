import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostExperiment } from './host-experiment';

// Explicit embedding entry point; credentials stay in memory and are never serialized.
export async function runHostLive({
  experimentRoot,
  providerRoot,
  runnerRoot,
  config,
  apiKey,
  output,
}) {
  const { parseConfig } = await import(
    pathToFileURL(path.join(providerRoot, 'research/agent-behavior-evals/model-config.ts')).href
  );
  const checked = parseConfig(config);
  if (checked.maxCalls !== 24 || checked.timeoutMs !== 240000 || checked.maxOutputTokens !== 8192)
    throw new Error('Host pilot requires explicit 24-call, 240s, 8192-token budget');
  const { complete } = await import(
    pathToFileURL(path.join(providerRoot, 'packages/providers/src/index.ts')).href
  );
  const sharedFile = path.join(runnerRoot, 'research/scoped-design-edits/model-session.mjs');
  const { createModelSession, hash } = await import(pathToFileURL(sharedFile).href);
  const folder = path.join(experimentRoot, 'research/goal-aware-context');
  const sourceHashes = readdirSync(folder)
    .filter((file) => /^host.*\.(ts|mjs)$/.test(file))
    .map((file) => [file, hash(readFileSync(path.join(folder, file), 'utf8'))]);
  const head = (cwd) =>
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', windowsHide: true }).trim();
  mkdirSync(output);
  writeFileSync(
    path.join(output, 'manifest.json'),
    JSON.stringify(
      {
        version: 2,
        modelConfig: checked,
        maxCalls: 24,
        sourceHashes,
        sharedRunnerHash: hash(readFileSync(sharedFile, 'utf8')),
        providerHash: hash(
          readFileSync(path.join(providerRoot, 'packages/providers/src/index.ts'), 'utf8'),
        ),
        lockHash: hash(readFileSync(path.join(providerRoot, 'pnpm-lock.yaml'), 'utf8')),
        parentCommit: head(experimentRoot),
        runnerCommit: head(runnerRoot),
        providerCommit: head(providerRoot),
        node: process.version,
        createdAt: new Date().toISOString(),
        caveats: [
          'synthetic two-scenario replay, six checkpoints, one trial',
          'host inventory and verification receipts supplied by controlled fixtures, not visual tools',
          'equal summary byte caps, unequal total reader context',
          'model-only and hybrid share canonical-ID output protocol and host gate',
          'raw decisions scored before enforcement; refusal is not successful completion',
          'same existing Codex prompt-only / Ollama JSON Schema asymmetry and provider usage limitations',
        ],
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  const call = createModelSession({
    complete,
    config: checked,
    apiKey,
    maxCalls: checked.maxCalls,
    journal: path.join(output, 'calls.jsonl'),
  });
  const rows = await hostExperiment(path.join(output, 'experiment'), call);
  writeFileSync(
    path.join(output, 'complete.json'),
    JSON.stringify({ rows: rows.length, completedAt: new Date().toISOString() }),
    { flag: 'wx' },
  );
  return rows;
}
