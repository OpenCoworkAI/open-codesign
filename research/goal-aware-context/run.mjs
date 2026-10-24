import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { experiment } from './experiment.mjs';

const result = experiment();
const output = resolve(process.argv[2] || '.Codex/workspace/goal-aware-context/results.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.table(result.summary);
console.log(output);
if (result.rows.some((r) => !r.withinBudget)) process.exitCode = 1;
