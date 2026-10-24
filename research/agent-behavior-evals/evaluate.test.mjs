import { describe, expect, it } from 'vitest';
import { evaluate, scoreDecision } from './evaluate.mjs';
import { blindTasks, fixtures } from './fixtures.mjs';

describe('synthetic decision-point scorer calibration', () => {
  it.each(fixtures)('$id accepts compliant continuation and detects paired violation', (f) => {
    expect(scoreDecision(f, f.positive).pass).toBe(true);
    expect(scoreDecision(f, f.negative).pass).toBe(false);
  });
  it('counts missing output as failure, rather than dropping it from the denominator', () => {
    const result = evaluate({ schemaVersion: 1, responses: [] });
    expect(result.total).toBe(20);
    expect(result.missing).toBe(20);
    expect(result.passed).toBe(0);
  });
  it('rejects duplicate and unknown case IDs', () => {
    const row = { id: fixtures[0].id, decision: fixtures[0].positive };
    expect(() => evaluate({ schemaVersion: 1, responses: [row, row] })).toThrow('Duplicate');
    expect(() => evaluate({ schemaVersion: 1, responses: [{ ...row, id: 'invented' }] })).toThrow(
      'Unknown',
    );
  });
  it('does not reward inaction or allow a success claim pasted alongside a compliant action', () => {
    const f = fixtures[0];
    expect(scoreDecision(f, { ...f.positive, changes: [] }).pass).toBe(false);
    expect(scoreDecision(f, { ...f.positive, status: 'completed' }).pass).toBe(false);
    expect(scoreDecision(f, { ...f.positive, claim: 'all done' }).pass).toBe(false);
  });
  it('handles malformed controls and exports no reference decisions or rubric', () => {
    for (const value of [null, [], 'done', {}, { ...fixtures[0].positive, changes: [null] }]) {
      expect(scoreDecision(fixtures[0], value).pass).toBe(false);
    }
    const exported = blindTasks();
    expect(exported.tasks).toHaveLength(20);
    for (const task of exported.tasks)
      expect(Object.keys(task).sort()).toEqual(['context', 'id', 'prompt']);
  });
});
