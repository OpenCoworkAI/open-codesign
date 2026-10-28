import { z } from 'zod';
import { hashJson } from './corpus.js';
import type { EvaluationCase } from './evaluation.js';

const text = z.string().min(1);
const binding = z.strictObject({ caseId: text, key: text });
const response = z.strictObject({
  id: text,
  requestHash: text,
  status: text,
  value: z.unknown(),
  raw: z.string().nullable(),
});
const evidence = z.array(z.number().int().nonnegative()).min(1);
const policySchema = z.strictObject({
  schemaVersion: z.literal(1),
  protocol: z.literal('unified-scoring@2'),
  confirmedAt: text,
  confirmation: text,
  reviewStatus: text,
  aliasExtensions: z.array(
    binding.extend({ answers: z.array(text).min(1), evidenceSeqs: evidence, reviewId: text }),
  ),
  questionOverrides: z.array(binding.extend({ text })),
  humanReviews: z.array(
    binding.extend({
      id: text,
      runId: text,
      evidenceSeqs: evidence,
      decision: z.literal('content-correct; format-fail; overall-fail'),
      response,
    }),
  ),
  historicalSha256: z.record(text, z.record(text, z.string().regex(/^[a-f0-9]{64}$/u))),
});
export type ScoringPolicy = z.infer<typeof policySchema>;
export type ScorableResponse = z.infer<typeof response>;
export type ReferenceQuestion = EvaluationCase['questions'][number];
export interface QuestionJudgment {
  key: string;
  callId: string | null;
  runtimeStatus: string;
  runtimeValid: boolean;
  content: 'correct' | 'incorrect' | 'pending-review' | 'unavailable';
  format: 'pass' | 'fail' | 'not-observed';
  success: boolean;
  source: 'frozen-reference' | 'approved-alias' | 'human-review' | 'pending-review' | 'unavailable';
  reviewId: string | null;
  predicted: string | null;
}
export function parseScoringPolicy(value: unknown): ScoringPolicy {
  const policy = policySchema.parse(value);
  for (const rows of [policy.aliasExtensions, policy.questionOverrides]) {
    const ids = rows.map((row) => `${row.caseId}/${row.key}`);
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate scoring override');
  }
  const reviewIds = policy.humanReviews.map((row) => row.id);
  const responses = policy.humanReviews.map((row) => row.response.id);
  if (new Set(reviewIds).size !== reviewIds.length || new Set(responses).size !== responses.length)
    throw new Error('Duplicate human review');
  return policy;
}
export function validateScoringPolicy(
  policy: ScoringPolicy,
  evaluation: { cases: EvaluationCase[] },
  developmentIds: readonly string[],
): void {
  for (const entry of [
    ...policy.aliasExtensions,
    ...policy.questionOverrides,
    ...policy.humanReviews,
  ]) {
    const question = evaluation.cases
      .find((c) => c.caseId === entry.caseId)
      ?.questions.find((q) => q.key === entry.key);
    if (!question || !developmentIds.includes(entry.caseId))
      throw new Error('Scoring overrides must target known development questions');
    if (
      'evidenceSeqs' in entry &&
      entry.evidenceSeqs.some((seq) => !question.evidenceSeqs.includes(seq))
    )
      throw new Error('Scoring review evidence differs from frozen reference');
  }
}
export function effectiveQuestion(
  policy: ScoringPolicy,
  caseId: string,
  question: ReferenceQuestion,
): { key: string; text: string } {
  const override = policy.questionOverrides.find(
    (row) => row.caseId === caseId && row.key === question.key,
  );
  return { key: question.key, text: override?.text ?? question.text };
}
const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ');

/** Diagnostic content credit never repairs an invalid response or makes it a successful request. */
export function scoreQuestion(
  policy: ScoringPolicy,
  caseId: string,
  question: ReferenceQuestion,
  row: ScorableResponse | null,
  conditionStatus = 'ok',
): QuestionJudgment {
  const runtimeStatus = conditionStatus !== 'ok' ? conditionStatus : (row?.status ?? 'not-run');
  const runtimeValid = row?.status === 'ok' && conditionStatus === 'ok';
  const judgment: QuestionJudgment = {
    key: question.key,
    callId: row?.id ?? null,
    runtimeStatus,
    runtimeValid,
    content: 'unavailable',
    format: 'not-observed',
    success: false,
    source: 'unavailable',
    reviewId: null,
    predicted: null,
  };
  if (!row || (row.status !== 'ok' && row.status !== 'invalid-json')) return judgment;
  const value = row.value;
  const object =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const validShape =
    row.status === 'ok' &&
    object !== null &&
    Object.keys(object).length === 1 &&
    typeof object[question.key] === 'string';
  judgment.format = validShape ? 'pass' : 'fail';
  if (!validShape) {
    const review = policy.humanReviews.find(
      (review) =>
        review.caseId === caseId &&
        review.key === question.key &&
        hashJson(review.response) ===
          hashJson({
            id: row.id,
            requestHash: row.requestHash,
            status: row.status,
            value: row.value,
            raw: row.raw,
          }),
    );
    judgment.content = review ? 'correct' : 'pending-review';
    judgment.source = review ? 'human-review' : 'pending-review';
    judgment.reviewId = review?.id ?? null;
    return judgment;
  }
  const predicted = object?.[question.key] as string;
  judgment.predicted = predicted;
  const frozen = question.acceptedAnswers.some(
    (answer) => normalize(answer) === normalize(predicted),
  );
  const extension = policy.aliasExtensions.find(
    (entry) => entry.caseId === caseId && entry.key === question.key,
  );
  const alias =
    extension?.answers.some((answer) => normalize(answer) === normalize(predicted)) ?? false;
  judgment.content = frozen || alias ? 'correct' : 'incorrect';
  judgment.source = alias && !frozen ? 'approved-alias' : 'frozen-reference';
  judgment.reviewId = alias && !frozen ? (extension?.reviewId ?? null) : null;
  judgment.success = runtimeValid && judgment.content === 'correct';
  return judgment;
}
export function summarizeJudgments(rows: readonly QuestionJudgment[]) {
  return {
    total: rows.length,
    contentCorrect: rows.filter((row) => row.content === 'correct').length,
    contentIncorrect: rows.filter((row) => row.content === 'incorrect').length,
    pendingReview: rows.filter((row) => row.content === 'pending-review').length,
    unavailable: rows.filter((row) => row.content === 'unavailable').length,
    formatPass: rows.filter((row) => row.format === 'pass').length,
    runtimeValid: rows.filter((row) => row.runtimeValid).length,
    successful: rows.filter((row) => row.success).length,
  };
}
