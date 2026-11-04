import { describe, expect, it } from 'vitest';
import { scoreTraceState } from './state-evaluation.js';
import { stateStressFixtures } from './state-stress-fixtures.js';

const source = { eventId: 'e1', seq: 1, authority: 'tool', revision: 'r2' };
const scope = {
  workspaceId: 'w',
  designId: 'A',
  file: 'App.jsx',
  objectId: 'button',
  field: 'color',
  revision: 'r2',
};
const reference = {
  cutoff: 1,
  events: [
    {
      id: 'e1',
      seq: 1,
      authority: 'tool',
      designId: 'A',
      revision: 'r2',
      text: 'Read App.jsx at r2: color #317245.',
    },
  ],
  claims: [
    {
      key: 'diskColor',
      kind: 'artifact-fact',
      acceptedValues: ['#317245'],
      scope,
      sources: [source],
      invalidation: { status: 'active', rules: ['new-observation'] },
    },
  ],
};
const valid = () => ({
  states: [
    {
      key: 'diskColor',
      kind: 'artifact-fact',
      value: '#317245',
      scope: { ...scope },
      sources: [{ ...source }],
      invalidation: { status: 'active', rules: ['new-observation'] },
    },
  ],
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing test fixture');
  return value;
}
describe('traceable state dimensions', () => {
  it('scores all four axes independently', () => {
    const input = valid();
    required(input.states[0]).value = '#2463A6';
    expect(scoreTraceState(reference, { status: 'ok', value: input })).toMatchObject({
      total: 1,
      valueCorrect: 0,
      scopeCorrect: 1,
      provenanceCorrect: 1,
      invalidationCorrect: 1,
      jointCorrect: 0,
    });
  });
  it('requires correct kind, scope, evidence authority and invalidation separately', () => {
    expect(scoreTraceState(reference, { status: 'ok', value: valid() })).toMatchObject({
      jointCorrect: 1,
    });
    const input = valid();
    required(input.states[0]).scope.designId = 'B';
    required(required(input.states[0]).sources[0]).revision = 'r1';
    required(input.states[0]).invalidation.rules = ['revision-change'];
    expect(scoreTraceState(reference, { status: 'ok', value: input })).toMatchObject({
      valueCorrect: 1,
      scopeCorrect: 0,
      provenanceCorrect: 0,
      invalidationCorrect: 0,
      jointCorrect: 0,
    });
  });
  it('counts a wrong authority as provenance failure without erasing correct value and scope', () => {
    const input = valid();
    required(required(input.states[0]).sources[0]).authority = 'assistant';
    expect(scoreTraceState(reference, { status: 'ok', value: input })).toMatchObject({
      formatValid: true,
      valueCorrect: 1,
      scopeCorrect: 1,
      provenanceCorrect: 0,
      invalidationCorrect: 1,
      jointCorrect: 0,
    });
  });
  it.each([
    { states: [] },
    { states: [{ key: 'diskColor' }] },
    { answer: '#317245' },
  ])('keeps missing/malformed states in denominator: %j', (value) => {
    expect(scoreTraceState(reference, { status: 'ok', value })).toMatchObject({
      total: 1,
      jointCorrect: 0,
    });
  });
  it('rejects duplicate and extra claims rather than choosing a convenient answer', () => {
    const input = valid();
    input.states.push(required(input.states[0]));
    expect(scoreTraceState(reference, { status: 'ok', value: input })).toMatchObject({
      formatValid: false,
      jointCorrect: 0,
    });
    input.states = [{ ...required(input.states[0]), key: 'other' }];
    expect(scoreTraceState(reference, { status: 'ok', value: input }).formatValid).toBe(false);
  });
  it('rejects future or unsupported reference evidence before scoring', () => {
    expect(() =>
      scoreTraceState({ ...reference, cutoff: 0 }, { status: 'ok', value: valid() }),
    ).toThrow(/evidence|cutoff/i);
  });
  it.each([
    'length',
    'timeout',
    'invalid-json',
    'overflow',
    'not-run',
  ])('retains failed planned states: %s', (status) => {
    expect(scoreTraceState(reference, { status, value: valid() })).toMatchObject({
      total: 1,
      runtimeValid: false,
      jointCorrect: 0,
    });
  });
});

function approvedState(trajectoryId: string, cutoff: number, key: string) {
  const reference = stateStressFixtures()
    .find((f) => f.id === trajectoryId)
    ?.checkpoints.find((c) => c.cutoff === cutoff);
  const claim = reference?.claims.find((c) => c.key === key);
  if (!reference || !claim) throw new Error('Missing approved fixture');
  const { acceptedValues, acceptedSourceSets: _alternatives, ...state } = claim;
  return {
    reference: { ...reference, claims: [claim] },
    claim,
    state: structuredClone({ ...state, value: required(acceptedValues[0]) }),
  };
}
describe('approved G1/G2 rules', () => {
  it('accepts all 37 frozen evidence combinations and rejects duplicate citations', () => {
    let combinations = 0;
    for (const fixture of stateStressFixtures()) {
      for (const checkpoint of fixture.checkpoints) {
        for (const claim of checkpoint.claims) {
          const { acceptedValues, acceptedSourceSets, ...state } = claim;
          const reference = { ...checkpoint, claims: [claim] };
          for (const sources of [claim.sources, ...acceptedSourceSets]) {
            const actual = { ...state, value: required(acceptedValues[0]), sources };
            expect(
              scoreTraceState(reference, { status: 'ok', value: { states: [actual] } })
                .jointCorrect,
            ).toBe(1);
            const duplicate = { ...actual, sources: [...sources, required(sources[0])] };
            expect(
              scoreTraceState(reference, { status: 'ok', value: { states: [duplicate] } })
                .provenanceCorrect,
            ).toBe(0);
            combinations++;
          }
        }
      }
    }
    expect(combinations).toBe(37);
  });
  it('accepts mandatory evidence plus explicitly allowed corroboration', () => {
    const f = approvedState('version-facts', 3, 'approvedColor');
    const event = required(f.reference.events.find((e) => e.id === 'e2'));
    f.state.sources.push({
      eventId: event.id,
      seq: event.seq,
      authority: event.authority,
      revision: event.revision,
    });
    expect(
      scoreTraceState(f.reference, { status: 'ok', value: { states: [f.state] } })
        .provenanceCorrect,
    ).toBe(1);
  });
  it('rejects missing core, unrelated, wrong-role and future evidence', () => {
    const f = approvedState('version-facts', 3, 'approvedColor');
    const validExtra = { eventId: 'e2', seq: 2, authority: 'user', revision: null };
    for (const sources of [
      [validExtra],
      [...f.state.sources, { eventId: 'e1', seq: 1, authority: 'tool', revision: 'r1' }],
      [...f.state.sources, { ...validExtra, authority: 'tool' }],
      [...f.state.sources, { eventId: 'e5', seq: 5, authority: 'user', revision: null }],
    ]) {
      expect(
        scoreTraceState(f.reference, { status: 'ok', value: { states: [{ ...f.state, sources }] } })
          .provenanceCorrect,
      ).toBe(0);
    }
  });
  it('rejects alternative sets that discard mandatory evidence or add future events', () => {
    const f = approvedState('version-facts', 3, 'approvedColor');
    for (const sources of [
      [{ eventId: 'e2', seq: 2, authority: 'user', revision: null }],
      [...f.claim.sources, { eventId: 'e5', seq: 5, authority: 'user', revision: null }],
    ]) {
      expect(() =>
        scoreTraceState(
          { ...f.reference, claims: [{ ...f.claim, acceptedSourceSets: [sources] }] },
          null,
        ),
      ).toThrow(/evidence|mandatory|cutoff/i);
    }
  });
  it.each([
    ['recovery-action', 'fontSize', '保持不变'],
    ['recovery-action', 'fontSize', '保留字号'],
    ['correction-new-design', 'animations', '禁止动画'],
    ['correction-new-design', 'animations', '禁用动画'],
    ['correction-new-design', 'font', '尚未决定'],
    ['correction-new-design', 'font', '待确认'],
    ['recovery-action', 'nextAction', '先重读App.jsx'],
  ])('accepts the preapproved exact alias %s/%s/%s', (trajectory, key, value) => {
    const f = approvedState(trajectory, 5, key);
    expect(
      scoreTraceState(f.reference, { status: 'ok', value: { states: [{ ...f.state, value }] } })
        .valueCorrect,
    ).toBe(1);
  });
  it.each([
    ['recovery-action', 'fontSize', '不要保持不变'],
    ['recovery-action', 'nextAction', '先重读App.jsx并修改颜色'],
    ['correction-new-design', 'animations', '不再禁止动画'],
  ])('does not accept expanded or negated wording: %s/%s/%s', (trajectory, key, value) => {
    const f = approvedState(trajectory, 5, key);
    expect(
      scoreTraceState(f.reference, { status: 'ok', value: { states: [{ ...f.state, value }] } })
        .valueCorrect,
    ).toBe(0);
  });
});
