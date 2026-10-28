import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parseCorpus } from './corpus.js';
import { parseEvaluation } from './evaluation.js';
import { loadUnifiedData } from './unified-plan.js';
import { deriveHistoricalReports, rescoreCompression, verifyRunFiles } from './unified-rescore.js';
import { parseScoringPolicy } from './unified-scoring.js';

it('rescores all methods while retaining failed planned questions and exact human bindings', () => {
  const data = loadUnifiedData();
  const evaluation = parseEvaluation(data.evaluation, parseCorpus(data.corpus));
  const policy = parseScoringPolicy(data.scoring);
  const e1 = policy.humanReviews.find((r) => r.id === 'E1');
  if (!e1) throw new Error('Missing E1');
  const conditionId = e1.response.id.split('/read/')[0] ?? '';
  const conditions = [
    { id: conditionId, caseId: e1.caseId, method: 'production-matched' },
    { id: 'other', caseId: e1.caseId, method: 'ordinary-summary' },
  ];
  const observations = [
    { conditionId, group: 'compression', status: 'invalid-answer' },
    { conditionId: 'other', group: 'compression', status: 'over-budget' },
  ];
  const result = rescoreCompression(evaluation, policy, conditions, observations, [e1.response]);
  expect(result).toMatchObject({
    correct: 0,
    total: 8,
    questionMetrics: { contentCorrect: 1, unavailable: 7, successful: 0 },
  });
  expect(result.conditions[0]?.questions.find((q) => q.key === 'scope')).toMatchObject({
    content: 'correct',
    format: 'fail',
    reviewId: 'E1',
  });
  expect(() =>
    rescoreCompression(evaluation, policy, conditions, observations.slice(1), []),
  ).toThrow(/coverage/i);
});
it('fails closed when any pinned historical artifact changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'codesign-rescore-'));
  mkdirSync(join(root, 'run'));
  const path = join(root, 'run', 'report.json');
  writeFileSync(path, 'original');
  const hashes = { 'report.json': createHash('sha256').update('original').digest('hex') };
  expect(() => verifyRunFiles(join(root, 'run'), hashes)).not.toThrow();
  writeFileSync(path, 'changed');
  expect(() => verifyRunFiles(join(root, 'run'), hashes)).toThrow(/hash|artifact/i);
});

it('rejects historical-run child output directories even when the child starts with two dots', () => {
  const root = mkdtempSync(join(tmpdir(), 'codesign-output-guard-'));
  expect(() => deriveHistoricalReports(root, join(root, 'pilot-live-001', '..derived'))).toThrow(
    /inside historical run/,
  );
});
