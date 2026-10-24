import { describe, expect, it } from 'vitest';
import { byteLength, goalState, readAnswer, recencyPack, serialize } from './compress.mjs';
import { experiment } from './experiment.mjs';
import { sessions } from './fixtures.mjs';

describe('goal-aware compression protocol and controls', () => {
  it('uses a full-context ceiling and reports both question and whole-goal accuracy', () => {
    const report = experiment();
    const full = report.summary.find((r) => r.condition === 'full-context-reference:1');
    expect(full.correctAnswers).toBe(24);
    expect(full.allCorrectGoals).toBe(6);
    expect(report.rows).toHaveLength(42);
    expect(report.rows.every((r) => r.withinBudget)).toBe(true);
    expect(
      report.summary.find((r) => r.condition === 'recency-pack:0.1').correctAnswers,
    ).toBeLessThan(24);
  });
  it.each(sessions)('$id preserves source precedence and rejects later proposals', (session) => {
    const full = serialize(session.history);
    const compact = goalState(session.history, session.goal, byteLength(full));
    for (const key of ['brandColor', 'fontFamily', 'rejectedStyle', 'revision']) {
      expect(readAnswer(compact, session.goal, key)).toBe(readAnswer(full, session.goal, key));
    }
    expect(readAnswer(compact, session.goal, 'brandColor')).not.toBe('#ff00ff');
    expect(readAnswer(compact, session.goal, 'fontFamily')).not.toBe('Comic Sans');
  });
  it('does not pretend that a tiny budget preserves everything', () => {
    const session = sessions[0];
    expect(goalState(session.history, session.goal, 2)).toBe('[]');
    expect(readAnswer('[]', session.goal, 'brandColor')).toBeNull();
    expect(() => goalState(session.history, session.goal, 1)).toThrow('Budget');
  });
  it('enforces UTF-8 byte budgets for non-ASCII content without truncating records', () => {
    const events = [
      { scope: 'landing', key: 'text', value: '品牌标题😀', source: 'user', accepted: true },
    ];
    const size = byteLength(serialize(events));
    for (const compressor of [goalState, recencyPack]) {
      expect(compressor(events, { scope: 'landing' }, size)).toBe(serialize(events));
      expect(compressor(events, { scope: 'landing' }, size - 1)).toBe('[]');
    }
  });
  it('is goal-dependent without receiving downstream questions and does not mutate history', () => {
    const session = sessions[0];
    const before = structuredClone(session.history);
    const a = goalState(session.history, session.goal, 5000);
    const b = goalState(session.history, { scope: 'other-design' }, 5000);
    expect(a).not.toBe(b);
    expect(readAnswer(b, { scope: 'other-design' }, 'brandColor')).toBe('#ffffff');
    expect(session.history).toEqual(before);
  });
});
