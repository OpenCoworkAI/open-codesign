import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parseUnifiedConfig } from './unified-config.js';
import { loadUnifiedData, prepareUnifiedPlan } from './unified-plan.js';

function root() {
  const base = fileURLToPath(
    new URL(
      '../../.Codex/workspace/goal-aware-context/unified-runner/plan-tests/',
      import.meta.url,
    ),
  );
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, 'run-'));
}
const pilot = () =>
  parseUnifiedConfig({
    caseIds: ['s01-c49'],
    hostCaseIds: ['signup-ready'],
    budgets: [2048],
    trials: 1,
  });
it('builds one source-bound plan with exact call upper bound and no evaluator answers in model inputs', () => {
  const prepared = prepareUnifiedPlan(loadUnifiedData(), pilot(), root());
  const plan = prepared.plan;
  expect(plan.plannedCalls).toEqual({ compressor: 3, reader: 22, total: 25 });
  expect(plan.compression).toHaveLength(5);
  expect(plan.hostPairs).toHaveLength(1);
  expect(new Set(plan.compression.map((c) => c.inputHash)).size).toBe(1);
  expect(new Set(plan.compression.map((c) => c.readerSystemPrompt)).size).toBe(1);
  expect(JSON.stringify(plan)).not.toContain('acceptedAnswers');
  expect(JSON.stringify(plan)).not.toContain('requiredChecks');
  for (const condition of plan.compression) {
    const source = plan.inputs.find((i) => i.caseId === condition.caseId);
    if (!source) throw new Error('Missing source');
    expect(source.contextInput.chatRows.every((r) => r.seq <= source.cutoffSeq)).toBe(true);
    if (condition.compressorMessages) {
      const body = JSON.parse(condition.compressorMessages[1]?.content ?? '{}');
      expect(Object.keys(body).sort()).toEqual(['goal', 'history']);
      expect(JSON.parse(body.history[0].text)).toEqual(source.contextInput);
    }
  }
  expect(plan.plannedCalls.total).toBeGreaterThan(plan.config.maxCalls);
});
it('rejects unknown or heldout tuning cases without reading credentials', () => {
  for (const caseIds of [['s07-c49'], ['nonexistent']]) {
    expect(() =>
      prepareUnifiedPlan(loadUnifiedData(), parseUnifiedConfig({ caseIds }), root()),
    ).toThrow(/development|unknown|heldout/i);
  }
});
it('pins original manifests, reference file, implementation and lock fingerprints', () => {
  const data = loadUnifiedData();
  const prepared = prepareUnifiedPlan(data, pilot(), root());
  expect(prepared.plan.sourceHashes.lock).toMatch(/^[a-f0-9]{64}$/u);
  expect(prepared.plan.sourceHashes.implementation).toMatch(/^[a-f0-9]{64}$/u);
  expect(() =>
    prepareUnifiedPlan({ ...data, evaluation: { changed: true } }, pilot(), root()),
  ).toThrow();
  const reference = JSON.parse(
    readFileSync(new URL('./corpus-evaluation.json', import.meta.url), 'utf8'),
  );
  expect(reference.cases.length).toBe(10);
});
