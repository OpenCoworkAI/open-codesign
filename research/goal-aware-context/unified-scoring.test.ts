import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCorpus } from './corpus.js';
import { parseEvaluation } from './evaluation.js';
import { loadUnifiedData } from './unified-plan.js';
import { effectiveQuestion, parseScoringPolicy, scoreQuestion } from './unified-scoring.js';

const policy = () =>
  parseScoringPolicy(
    JSON.parse(readFileSync(new URL('./unified-scoring.json', import.meta.url), 'utf8')),
  );
const reference = (caseId: string, key: string) => {
  const data = loadUnifiedData();
  const q = parseEvaluation(data.evaluation, parseCorpus(data.corpus))
    .cases.find((c) => c.caseId === caseId)
    ?.questions.find((q) => q.key === key);
  if (!q) throw new Error('Missing question');
  return q;
};
const row = (value: unknown, status = 'ok', raw: string | null = JSON.stringify(value)) => ({
  id: 'new-call',
  requestHash: 'fixture',
  status,
  value,
  raw,
});
describe('human-approved scoring overlay', () => {
  it.each([
    '调整统计卡片中的数字',
    '调整统计卡片数字',
    '统计卡片里的数字',
    '仅调整统计卡片中的数字',
  ])('accepts approved same-scope wording: %s', (answer) => {
    expect(
      scoreQuestion(policy(), 's01-c49', reference('s01-c49', 'scope'), row({ scope: answer })),
    ).toMatchObject({
      content: 'correct',
      format: 'pass',
      success: true,
      source: 'approved-alias',
    });
  });
  it.each([
    '调整统计卡片和导航',
    '不调整统计卡片数字',
    '仅调整统计卡片中的数字和布局',
    '调整统计卡片标题',
  ])('rejects changed scope: %s', (answer) => {
    expect(
      scoreQuestion(policy(), 's01-c49', reference('s01-c49', 'scope'), row({ scope: answer })),
    ).toMatchObject({ content: 'incorrect', success: false });
  });
  it.each([
    { answer: '统计数字' },
    { scope: '统计数字', extra: 'x' },
    { scope: 123 },
    ['统计数字'],
  ])('queues unknown invalid shapes for review without repairing them: %j', (value) => {
    expect(
      scoreQuestion(policy(), 's01-c49', reference('s01-c49', 'scope'), row(value)),
    ).toMatchObject({ content: 'pending-review', format: 'fail', success: false });
  });
  it('does not infer content from invalid JSON or unavailable/truncated replies', () => {
    expect(
      scoreQuestion(
        policy(),
        's05-c49',
        reference('s05-c49', 'diskColor'),
        row(null, 'invalid-json', '#317245'),
      ),
    ).toMatchObject({ content: 'pending-review', format: 'fail', success: false });
    expect(
      scoreQuestion(policy(), 's01-c49', reference('s01-c49', 'scope'), row(null, 'length', null)),
    ).toMatchObject({ content: 'unavailable', success: false, runtimeStatus: 'length' });
    expect(
      scoreQuestion(policy(), 's01-c49', reference('s01-c49', 'scope'), null, 'over-budget'),
    ).toMatchObject({ content: 'unavailable', success: false, runtimeStatus: 'over-budget' });
  });
  it('binds E1–E3 human content credit to the exact historical reply without changing format success', () => {
    const p = policy();
    expect(p.humanReviews).toHaveLength(3);
    for (const review of p.humanReviews) {
      const r = { ...review.response };
      const q = reference(review.caseId, review.key);
      expect(scoreQuestion(p, review.caseId, q, r)).toMatchObject({
        content: 'correct',
        format: 'fail',
        success: false,
        source: 'human-review',
        reviewId: review.id,
      });
      expect(scoreQuestion(p, review.caseId, q, { ...r, id: 'other-call' }).content).toBe(
        'pending-review',
      );
      expect(scoreQuestion(p, review.caseId, q, { ...r, raw: 'tampered' }).content).toBe(
        'pending-review',
      );
    }
  });
  it('keeps content evidence while provider overflow invalidates overall success', () => {
    expect(
      scoreQuestion(
        policy(),
        's01-c49',
        reference('s01-c49', 'scope'),
        row({ scope: '统计数字' }),
        'provider-overflow',
      ),
    ).toMatchObject({ content: 'correct', format: 'pass', success: false, runtimeValid: false });
  });
  it('clarifies color value wording without mutating frozen references', () => {
    const q = reference('s05-c49', 'diskColor');
    expect(effectiveQuestion(policy(), 's05-c49', q).text).toContain('JSON 中该字段的值仅填写 hex');
    expect(q.text).toBe('当前文件实际按钮色值？仅返回 hex。');
  });
});
