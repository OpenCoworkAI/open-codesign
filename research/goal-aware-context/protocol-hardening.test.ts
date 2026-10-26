import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseCorpus } from './corpus.js';
import { parseEvaluation, scoreAnswers } from './evaluation.js';

const load = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));

it('a trivial no-context answer-copying reader gets zero questions correct', () => {
  const sessions = parseCorpus(load('./corpus-inputs.json'));
  const evaluation = parseEvaluation(load('./corpus-evaluation.json'), sessions);
  const results = evaluation.cases.map((entry) => {
    const predictions = Object.fromEntries(
      entry.questions.map((question) => [
        question.key,
        question.text.match(/(?:返回|回答|输出)\s+([^。？\n]+)/u)?.[1] ?? '',
      ]),
    );
    return scoreAnswers(entry, predictions);
  });
  expect(results.reduce((sum, result) => sum + result.correct, 0)).toBe(0);
});

it('rejects identity normalization and row defaults that could hide input changes from the manifest', () => {
  const sessions = parseCorpus(load('./corpus-inputs.json'));
  const source = sessions[0];
  if (!source) throw new Error('Missing fixture');
  expect(() => parseCorpus([{ ...source, sessionId: ` ${source.sessionId}` }])).toThrow();
  expect(() =>
    parseCorpus([
      { ...source, rows: source.rows.map(({ schemaVersion: _version, ...row }) => row) },
    ]),
  ).toThrow();
});
