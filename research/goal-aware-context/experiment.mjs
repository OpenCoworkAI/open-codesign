import { byteLength, goalState, readAnswer, recencyPack, serialize } from './compress.mjs';
import { sessions } from './fixtures.mjs';
import { questions } from './questions.mjs';

export function experiment() {
  const rows = [];
  for (const session of sessions) {
    const full = serialize(session.history);
    const conditions = [
      {
        method: 'full-context-reference',
        fraction: 1,
        context: full,
        budgetBytes: byteLength(full),
      },
    ];
    for (const fraction of [0.1, 0.25, 0.5]) {
      const budgetBytes = Math.floor(byteLength(full) * fraction);
      for (const [method, compressor] of [
        ['recency-pack', recencyPack],
        ['goal-state', goalState],
      ]) {
        // No reference question or answer is passed to the compressor.
        const context = compressor(session.history, session.goal, budgetBytes);
        conditions.push({ method, fraction, budgetBytes, context });
      }
    }
    for (const condition of conditions) {
      const answers = questions
        .filter((q) => q.sessionId === session.id)
        .map((q) => {
          const predicted = readAnswer(condition.context, session.goal, q.key);
          return { key: q.key, expected: q.answer, predicted, correct: predicted === q.answer };
        });
      rows.push({
        id: session.id,
        method: condition.method,
        budgetFraction: condition.fraction,
        fullBytes: byteLength(full),
        budgetBytes: condition.budgetBytes,
        actualBytes: byteLength(condition.context),
        withinBudget: byteLength(condition.context) <= condition.budgetBytes,
        correct: answers.filter((a) => a.correct).length,
        total: answers.length,
        allCorrect: answers.every((a) => a.correct),
        answers,
      });
    }
  }
  const conditions = [...new Set(rows.map((r) => `${r.method}:${r.budgetFraction}`))];
  const summary = conditions.map((condition) => {
    const subset = rows.filter((r) => `${r.method}:${r.budgetFraction}` === condition);
    return {
      condition,
      goals: subset.length,
      allCorrectGoals: subset.filter((r) => r.allCorrect).length,
      questions: subset.reduce((n, r) => n + r.total, 0),
      correctAnswers: subset.reduce((n, r) => n + r.correct, 0),
      budgetViolations: subset.filter((r) => !r.withinBudget).length,
    };
  });
  return {
    schemaVersion: 1,
    kind: 'synthetic-structured-state-ablation',
    node: process.version,
    budgetUnit: 'UTF-8 bytes (not model tokens)',
    summary,
    rows,
  };
}
