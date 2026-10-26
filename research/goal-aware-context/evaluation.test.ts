import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCorpus } from './corpus.js';
import { parseEvaluation, scoreAnswers } from './evaluation.js';

describe('evaluator-only references and scoring', () => {
  const load = (name: string): unknown =>
    JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));

  it('requires all cases, unique keys and pre-cutoff evidence for each answer', () => {
    const sessions = parseCorpus(load('./corpus-inputs.json'));
    const evaluation = parseEvaluation(load('./corpus-evaluation.json'), sessions);
    expect(evaluation.cases).toHaveLength(10);
    for (const entry of evaluation.cases) expect(entry.questions.length).toBeGreaterThanOrEqual(3);
    const bad = structuredClone(evaluation);
    const question = bad.cases[0]?.questions[0];
    if (!question) throw new Error('Missing test question');
    question.evidenceSeqs = [9999];
    expect(() => parseEvaluation(bad, sessions)).toThrow(/evidence|cutoff/i);
    expect(() =>
      parseEvaluation({ ...evaluation, cases: evaluation.cases.slice(1) }, sessions),
    ).toThrow();
    question.evidenceSeqs = [];
    expect(() => parseEvaluation(bad, sessions)).toThrow();
  });

  it('scores exact normalized structured answers, including explicit uncertainty', () => {
    const reference = {
      caseId: 'case',
      questions: [
        {
          key: 'color',
          text: 'What color?',
          acceptedAnswers: ['#123456'],
          evidenceSeqs: [0],
          category: 'decision' as const,
        },
        {
          key: 'state',
          text: 'What state?',
          acceptedAnswers: ['unresolved'],
          evidenceSeqs: [1],
          category: 'conflict' as const,
        },
      ],
      nextEditRequest: 'Adjust the button.',
      requiredChecks: ['Preserve the layout.'],
    };
    expect(scoreAnswers(reference, { color: ' #123456 ', state: 'unresolved' })).toMatchObject({
      correct: 2,
      total: 2,
      allCorrect: true,
    });
    expect(
      scoreAnswers(reference, { color: '#123456 and #abcdef', state: 'active' }),
    ).toMatchObject({
      correct: 0,
      total: 2,
      allCorrect: false,
    });
    expect(scoreAnswers(reference, { color: '#123456' })).toMatchObject({
      correct: 1,
      total: 2,
      allCorrect: false,
    });
    expect(() => scoreAnswers(reference, { extra: 'leak' })).toThrow(/unknown|key/i);
    expect(() => scoreAnswers(reference, { color: 42 })).toThrow();
  });
});
