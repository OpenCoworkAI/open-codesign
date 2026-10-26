import { describe, expect, it } from 'vitest';
import {
  compressorMessages,
  contextPlan,
  readerMessages,
  summaryBudget,
  validSummary,
} from './live-experiment.mjs';
import { expectedAnswers, scoreAnswer } from './live-rubric.mjs';
import { liveSessions } from './live-sessions.mjs';

describe('live context protocol', () => {
  it.each(Object.keys(expectedAnswers))('scores the independent label for %s', (id) => {
    expect(scoreAnswer(id, expectedAnswers[id]).allCorrect).toBe(true);
    expect(scoreAnswer(id, { ...expectedAnswers[id], nextAction: 'wrong' }).valid).toBe(false);
  });
  it('counts UTF-8 bytes and rejects excess instead of silently truncating', () => {
    expect(validSummary({ summary: '中'.repeat(summaryBudget / 3) })).toBe(true);
    expect(validSummary({ summary: '中'.repeat(summaryBudget / 3 + 1) })).toBe(false);
    expect(validSummary({ summary: '', answers: expectedAnswers })).toBe(false);
  });
  it('does not inject downstream questions into compressors', () => {
    for (const method of ['ordinary-summary', 'goal-record']) {
      const messages = compressorMessages(liveSessions[0], method);
      expect(JSON.parse(messages[1].content)).toEqual({
        goal: liveSessions[0].goal,
        history: liveSessions[0].history,
      });
      expect(messages[0].content).not.toContain('remainingChecks');
      expect(messages[0].content).not.toContain('nextAction');
    }
  });
  it('keeps reader instructions identical across all representations', () => {
    expect(readerMessages('goal', 'short')[0]).toEqual(
      readerMessages('goal', liveSessions[0].history)[0],
    );
    expect(contextPlan()).toHaveLength(4);
  });
  it('invalidates stale evidence and rejects fabricated or duplicate fields', () => {
    const expected = expectedAnswers['stale-verification'];
    expect(
      scoreAnswer('stale-verification', {
        ...expected,
        revision: 'Report.jsx@r4',
        nextAction: 'done',
        remainingChecks: [],
      }).correctFields,
    ).toBe(3);
    expect(
      scoreAnswer('stale-verification', { ...expected, remainingChecks: ['mobile', 'mobile'] })
        .valid,
    ).toBe(false);
    expect(scoreAnswer('stale-verification', { ...expected, extra: true }).valid).toBe(false);
  });
});
