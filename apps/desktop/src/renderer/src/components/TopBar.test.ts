import { describe, expect, it } from 'vitest';
import { formatCostUsd } from './TopBar';

describe('formatCostUsd', () => {
  it('returns 0.00 for zero or non-finite values', () => {
    expect(formatCostUsd(0)).toBe('0.00');
    expect(formatCostUsd(-1)).toBe('0.00');
    expect(formatCostUsd(Number.NaN)).toBe('0.00');
    expect(formatCostUsd(Number.POSITIVE_INFINITY)).toBe('0.00');
  });

  it('uses 4 decimals for sub-cent values so users see non-zero spend', () => {
    expect(formatCostUsd(0.0042)).toBe('0.0042');
    expect(formatCostUsd(0.0001)).toBe('0.0001');
  });

  it('uses 2 decimals once spend reaches a cent or more', () => {
    expect(formatCostUsd(0.01)).toBe('0.01');
    expect(formatCostUsd(1.234)).toBe('1.23');
    expect(formatCostUsd(12.5)).toBe('12.50');
  });
});
