import { describe, expect, it } from 'vitest';
import {
  formatUsageCost,
  formatUsageTokens,
  nextLocalMidnight,
  summarizeUsageBudget,
} from './usage-budget';

const now = new Date(2024, 0, 7, 12).getTime();

describe('summarizeUsageBudget', () => {
  it('keeps another design out of the current design totals', () => {
    const budget = summarizeUsageBudget(
      [
        {
          designId: 'a',
          startedAt: new Date(2024, 0, 7, 9).getTime(),
          inputTokens: 10,
          outputTokens: 5,
          costUsd: 0.25,
        },
        {
          designId: 'b',
          startedAt: new Date(2024, 0, 7, 9).getTime(),
          inputTokens: 100,
          outputTokens: 50,
          costUsd: 9,
        },
        {
          designId: 'a',
          startedAt: new Date(2024, 0, 2, 9).getTime(),
          inputTokens: 4,
          outputTokens: 1,
          costUsd: 0.5,
        },
        {
          designId: 'a',
          startedAt: new Date(2023, 11, 31, 23).getTime(),
          inputTokens: 7,
          outputTokens: 3,
          costUsd: 0.125,
        },
        {
          designId: 'a',
          startedAt: new Date(2024, 0, 8, 1).getTime(),
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0.25,
        },
      ],
      'a',
      now,
    );

    expect(budget.design).toEqual({ inputTokens: 22, outputTokens: 10, costUsd: 1.125 });
    expect(budget.today).toEqual({ inputTokens: 10, outputTokens: 5, costUsd: 0.25 });
    expect(budget.week).toEqual({ inputTokens: 14, outputTokens: 6, costUsd: 0.75 });
  });

  it('counts a record that starts at the local week boundary', () => {
    const budget = summarizeUsageBudget(
      [
        {
          designId: 'a',
          startedAt: new Date(2024, 0, 1).getTime(),
          inputTokens: 2,
          outputTokens: 3,
          costUsd: 0.5,
        },
      ],
      'a',
      now,
    );
    expect(budget.week).toEqual({ inputTokens: 2, outputTokens: 3, costUsd: 0.5 });
    expect(budget.today).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
  });
});

describe('usage formatting', () => {
  it('formats token counts and small USD amounts', () => {
    expect(formatUsageTokens(1234)).toBe('1,234');
    expect(formatUsageCost(0)).toBe('$0');
    expect(formatUsageCost(1.2)).toBe('$1.2');
    expect(formatUsageCost(0.0125)).toBe('$0.0125');
    expect(formatUsageCost(0.000012)).toBe('$0.000012');
  });
});

describe('nextLocalMidnight', () => {
  it('lands on the next local midnight and on Monday when the week turns', () => {
    expect(nextLocalMidnight(new Date(2024, 0, 6, 23).getTime())).toBe(
      new Date(2024, 0, 7).getTime(),
    );
    expect(nextLocalMidnight(new Date(2024, 0, 7, 12).getTime())).toBe(
      new Date(2024, 0, 8).getTime(),
    );
    expect(nextLocalMidnight(new Date(2024, 0, 8).getTime())).toBe(new Date(2024, 0, 9).getTime());
  });
});
