import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { evaluate } from './evaluate.mjs';
import { blindTasks, fixtures } from './fixtures.mjs';

const [mode = 'controls', input, output] = process.argv.slice(2);
let result;
if (mode === 'export') result = blindTasks();
else if (mode === 'controls') {
  result = {
    schemaVersion: 1,
    node: process.version,
    kind: 'synthetic-scorer-calibration',
    positive: evaluate({
      schemaVersion: 1,
      provenance: 'hand-authored positive controls',
      responses: fixtures.map((f) => ({ id: f.id, decision: f.positive })),
    }),
    negative: evaluate({
      schemaVersion: 1,
      provenance: 'hand-authored negative controls',
      responses: fixtures.map((f) => ({ id: f.id, decision: f.negative })),
    }),
  };
} else if (mode === 'score' && input) result = evaluate(JSON.parse(readFileSync(input, 'utf8')));
else throw new Error('Usage: node run.mjs controls | export | score responses.json [report.json]');
const destination = resolve(output || `.Codex/workspace/agent-behavior-evals/${mode}.json`);
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, `${JSON.stringify(result, null, 2)}\n`);
console.log(destination);
if (
  mode === 'controls' &&
  (result.positive.passed !== fixtures.length || result.negative.passed !== 0)
)
  process.exitCode = 1;
if (mode === 'score' && result.passed !== result.total) process.exitCode = 1;
