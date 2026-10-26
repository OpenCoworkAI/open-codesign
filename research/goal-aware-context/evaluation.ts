import { z } from 'zod';
import { type CorpusSession, parseCorpus } from './corpus.js';

const questionSchema = z.strictObject({
  key: z.string().min(1),
  text: z.string().min(1),
  acceptedAnswers: z.array(z.string().min(1)).min(1),
  evidenceSeqs: z.array(z.number().int().nonnegative()).min(1),
  category: z.enum([
    'goal',
    'decision',
    'constraint',
    'revocation',
    'scope',
    'tool-failure',
    'revision',
    'conflict',
  ]),
});
const caseSchema = z.strictObject({
  caseId: z.string().min(1),
  questions: z.array(questionSchema).min(1),
  nextEditRequest: z.string().min(1),
  requiredChecks: z.array(z.string().min(1)).min(1),
});
export type EvaluationCase = z.infer<typeof caseSchema>;
const evaluationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  annotationStatus: z.literal('synthetic-author-reviewed'),
  cases: z.array(caseSchema).min(1),
});

export function parseEvaluation(value: unknown, source: readonly CorpusSession[]) {
  const sessions = parseCorpus(source);
  const evaluation = evaluationSchema.parse(value);
  const checkpoints = new Map(
    sessions.flatMap((s) => s.checkpoints.map((cp) => [cp.id, { s, cp }] as const)),
  );
  const seen = new Set<string>();
  for (const entry of evaluation.cases) {
    const target = checkpoints.get(entry.caseId);
    if (!target || seen.has(entry.caseId)) throw new Error('Unknown/duplicate evaluation case');
    seen.add(entry.caseId);
    if (new Set(entry.questions.map((q) => q.key)).size !== entry.questions.length)
      throw new Error('Duplicate question key');
    for (const question of entry.questions) {
      for (const evidenceSeq of question.evidenceSeqs) {
        if (
          evidenceSeq > target.cp.cutoffSeq ||
          !target.s.rows.some((row) => row.seq === evidenceSeq)
        ) {
          throw new Error('Answer evidence must exist before cutoff');
        }
      }
    }
  }
  if (seen.size !== checkpoints.size) throw new Error('Missing evaluation cases');
  return evaluation;
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

/** Evaluator-only exact structured scoring. Missing answers fail; extra/invalid keys are errors. */
export function scoreAnswers(reference: EvaluationCase, value: unknown) {
  const parsed = caseSchema.parse(reference);
  const predictions = z.record(z.string(), z.string()).parse(value);
  const keys = new Set(parsed.questions.map((q) => q.key));
  if (Object.keys(predictions).some((key) => !keys.has(key))) throw new Error('Unknown answer key');
  const answers = parsed.questions.map((question) => {
    const predicted = predictions[question.key] ?? null;
    const correct =
      predicted !== null &&
      question.acceptedAnswers.some((answer) => normalize(answer) === normalize(predicted));
    return { key: question.key, predicted, correct };
  });
  const correct = answers.filter((answer) => answer.correct).length;
  return { answers, correct, total: answers.length, allCorrect: correct === answers.length };
}
