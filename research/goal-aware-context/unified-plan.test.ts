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

it('pins scoring policy independently and never exposes adjudication metadata to models', () => {
  const data = loadUnifiedData();
  const prepared = prepareUnifiedPlan(data, pilot(), root());
  expect(prepared.plan.protocol).toBe('unified-context@2');
  expect(prepared.plan.sourceHashes.scoring).toMatch(/^[a-f0-9]{64}$/u);
  const requests = JSON.stringify(
    prepared.plan.compression.map((c) => ({
      questions: c.questions,
      prompt: c.readerSystemPrompt,
      compressor: c.compressorMessages,
    })),
  );
  expect(requests).not.toContain('aliasExtensions');
  expect(requests).not.toContain('humanReviews');
  expect(requests).not.toContain('A—D全部接受');
  expect(requests).not.toContain('acceptedAnswers');
});

it('binds model identity, clarified questions and the 169-call development configuration', () => {
  const config = parseUnifiedConfig(
    JSON.parse(
      readFileSync(new URL('./unified-development.example.json', import.meta.url), 'utf8'),
    ),
  );
  const prepared = prepareUnifiedPlan(loadUnifiedData(), config, root());
  expect(prepared.plan.plannedCalls).toEqual({ compressor: 22, reader: 147, total: 169 });
  expect(prepared.plan.inputs).toHaveLength(8);
  expect(prepared.plan.hostPairs).toHaveLength(6);
  expect(prepared.plan.inputs.some((input) => ['s07-c49', 's08-c49'].includes(input.caseId))).toBe(
    false,
  );
  const color = prepared.plan.compression
    .find((c) => c.caseId === 's05-c49')
    ?.questions.find((q) => q.key === 'diskColor');
  expect(color?.text).toContain('JSON 中该字段的值仅填写 hex');
  expect(config.maxOutputTokens).toBe(4096);
  const withIdentity = parseUnifiedConfig({
    ...config,
    models: {
      ...config.models,
      reader: {
        ...config.models.reader,
        modelIdentity: {
          displayName: 'Doubao-Seed-2.0-mini',
          source: 'user-confirmed',
          selection: 'manual-fixed',
          confirmedAt: '2026-10-27',
          backendVersion: null,
        },
      },
    },
  });
  const identified = prepareUnifiedPlan(loadUnifiedData(), withIdentity, root());
  expect(identified.plan.config.models.reader.modelIdentity?.displayName).toBe(
    'Doubao-Seed-2.0-mini',
  );
  expect(identified.plan.planHash).not.toBe(prepared.plan.planHash);
});
