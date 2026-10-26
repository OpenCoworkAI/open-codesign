import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildProductionBaseline } from './production-baseline.js';
import { createProductionFixture } from './production-fixtures.js';

const OUTPUTS_ROOT = resolve('.Codex/workspace/goal-aware-context');

export function createProductionBaselineReport() {
  const input = createProductionFixture();
  return {
    schemaVersion: 1 as const,
    kind: 'production-context-baseline' as const,
    nodeVersion: process.version,
    input,
    pack: buildProductionBaseline(input),
  };
}

function main(): void {
  const output = resolve(process.argv[2] ?? resolve(OUTPUTS_ROOT, 'production-baseline.json'));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(createProductionBaselineReport(), null, 2)}\n`, {
    flag: 'wx',
  });
  process.stdout.write(`${output}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
