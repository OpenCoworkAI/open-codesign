import { type HostDecision, validHostDecision } from './host-context';
import type { CheckpointId } from './host-scenarios';

// Frozen independent labels. The host reducer, compressor and reader never receive these values.
export const expectedHostAnswers: Record<CheckpointId, HostDecision> = {
  'signup-ready': {
    action: 'done',
    objectId: 'signup/page',
    checks: [],
    color: '#123456',
    font: 'Inter',
  },
  'signup-external-edit': {
    action: 'inspect',
    objectId: 'signup/page',
    checks: ['desktop', 'mobile'],
    color: '#123456',
    font: 'Inter',
  },
  'signup-partial': {
    action: 'inspect',
    objectId: 'signup/page',
    checks: ['mobile'],
    color: '#123456',
    font: 'Inter',
  },
  'pricing-policy-ready': {
    action: 'done',
    objectId: 'pricing/page',
    checks: [],
    color: '#345678',
    font: 'Georgia',
  },
  'pricing-return': {
    action: 'inspect',
    objectId: 'pricing/page',
    checks: ['desktop', 'mobile'],
    color: '#345678',
    font: 'Georgia',
  },
  'pricing-pending-work': {
    action: 'report-blocked',
    objectId: 'pricing/page',
    checks: [],
    color: '#345678',
    font: 'Georgia',
  },
};
export function scoreHostAnswer(id: CheckpointId, value: unknown) {
  const valid = validHostDecision(value);
  const expected = expectedHostAnswers[id];
  const fields = (['action', 'objectId', 'checks', 'color', 'font'] as const).map((key) => ({
    key,
    correct:
      valid &&
      (key === 'checks'
        ? JSON.stringify([...value.checks].sort()) === JSON.stringify([...expected.checks].sort())
        : value[key] === expected[key]),
  }));
  return {
    valid,
    fields,
    correctFields: fields.filter((f) => f.correct).length,
    allCorrect: fields.every((f) => f.correct),
    prematureDone: valid && value.action === 'done' && expected.action !== 'done',
  };
}
