import { describe, expect, it } from 'vitest';
import { hashJson } from './corpus.js';
import { handoffMemory, prepareMemoryStudy, runMemoryStudy } from './memory-study.js';
import { stateStressFixtures } from './state-stress-fixtures.js';
import type { SessionDependencies } from './unified-session.js';

function config(study: 'short' | 'long' = 'short') {
  const target = {
    model: { provider: 'fixture', modelId: 'fixture' },
    credentialEnv: 'MEMORY_FIXTURE_KEY',
    contextWindowTokens: 32768,
  };
  return {
    study,
    models: { compressor: target, reader: target },
    budgets: [2048],
    trials: study === 'short' ? 1 : 3,
    maxCalls: study === 'short' ? 112 : 84,
    maxOutputTokens: 4096,
    summaryMaxBytes: 1800,
    allowEstimatedBudget: true,
  };
}
const dependencies: SessionDependencies = {
  getCredential: () => 'UNIQUE_MEMORY_TEST_KEY',
  complete: async (_model, messages) => ({
    content: messages[0]?.content.startsWith('Maintain')
      ? JSON.stringify({
          stableConstraints: 'workspace w; keep valid local and global choices',
          handoff: 'pending work; original sources retained when present',
        })
      : messages[0]?.content.startsWith('Summarize')
        ? JSON.stringify({ summary: 'workspace w; latest valid decisions and pending work' })
        : '{"states":[]}',
    inputTokens: 100,
    outputTokens: 100,
    costUsd: 0,
  }),
};

describe('four-method memory study', () => {
  it('freezes a short112 and long84 call matrix without gold in plans', () => {
    const original = hashJson(stateStressFixtures());
    const short = prepareMemoryStudy(config()),
      long = prepareMemoryStudy(config('long'));
    expect(short.plan.plannedCalls).toEqual({ compressor: 48, reader: 64, total: 112 });
    expect(long.plan.plannedCalls).toEqual({ compressor: 54, reader: 30, total: 84 });
    expect(Object.keys(short.references)).toHaveLength(12);
    expect(Object.keys(long.references)).toHaveLength(6);
    expect(JSON.stringify(short.plan)).not.toContain('acceptedValues');
    expect(JSON.stringify(long.plan)).not.toContain('acceptedSourceSets');
    expect(long.plan.inputs).toHaveLength(2);
    for (const input of long.plan.inputs) {
      expect(input.events).toHaveLength(56);
      expect(Buffer.byteLength(JSON.stringify(input.events))).toBeGreaterThan(1800);
    }
    expect(hashJson(stateStressFixtures())).toBe(original);
    const ref = long.references['long-version-facts/55'];
    expect(
      ref?.claims.find((c) => c.key === 'r1Preview')?.sources.map((s) => [s.eventId, s.seq]),
    ).toEqual([
      ['e1', 11],
      ['e3', 33],
    ]);
  });
  it('rejects incompatible selectors, trials and unknown dimensions', () => {
    expect(() => prepareMemoryStudy({ ...config(), study: 'unknown' })).toThrow();
    expect(() => prepareMemoryStudy({ ...config('long'), trials: 1 })).toThrow();
    expect(() => prepareMemoryStudy({ ...config(), unexpected: true })).toThrow();
    expect(() => prepareMemoryStudy({ ...config(), caseIds: ['heldout'] })).toThrow();
  });
  it('uses one serialized1800-byte cap for the two handoff strings', () => {
    expect(handoffMemory({ stableConstraints: 'global rule', handoff: 'pending' }, 1800)).toBe(
      JSON.stringify({ stableConstraints: 'global rule', handoff: 'pending' }),
    );
    for (const value of [
      { stableConstraints: '', handoff: 'x' },
      { stableConstraints: 1, handoff: 'x' },
      { stableConstraints: 'x' },
      { stableConstraints: 'x', handoff: 'x', extra: true },
      { stableConstraints: '中'.repeat(300), handoff: '文'.repeat(300) },
    ])
      expect(handoffMemory(value, 1800)).toBeNull();
  });
  it('dry runs without reading credentials or providers', async () => {
    const result = await runMemoryStudy(
      prepareMemoryStudy(config()),
      {},
      {
        getCredential: () => {
          throw Error('key');
        },
        complete: async () => {
          throw Error('provider');
        },
      },
    );
    expect(result.report.actualProviderCalls).toBe(0);
    expect(result.observations).toEqual([]);
    expect(result.report.groups).toBeNull();
  });
  it('executes the short matrix with isolated histories and explicit archive scans', async () => {
    const prepared = prepareMemoryStudy(config());
    const result = await runMemoryStudy(prepared, { execute: true }, dependencies);
    expect(result.report.actualProviderCalls).toBe(112);
    expect(result.observations).toHaveLength(64);
    expect(result.observations.every((o) => o.status === 'ok')).toBe(true);
    expect(result.report.groups?.reduce((n, g) => n + g.final.total, 0)).toBe(72);
    const recall = result.observations.filter((o) => o.method === 'goal-recall');
    expect(recall).toHaveLength(16);
    expect(recall.every((o) => o.memoryTrace.at(-1)?.retrieval?.allEventsFit)).toBe(true);
    for (const call of result.calls) {
      if (call.role === 'compressor') {
        expect(JSON.stringify(call.messages)).not.toContain('stateKeys');
        expect(JSON.stringify(call.messages)).not.toContain('acceptedValues');
        const payload = JSON.parse(call.messages[1]?.content ?? '{}');
        const delta = payload.history ? JSON.parse(payload.history[0].text) : payload;
        const chain = prepared.plan.chains.find((c) => call.id.startsWith(`${c.id}/round-`));
        expect(chain).toBeDefined();
        const round = Number(call.id.match(/round-(\d+)/u)?.[1]);
        const stage = chain?.stages.find((s) => s.round === round);
        expect(delta.events.map((e: { id: string }) => e.id)).toEqual(stage?.eventIds);
        const previous = 'previousMemory' in delta ? delta.previousMemory : delta.previousSummary;
        if (round === 1) expect(previous).toBeNull();
        else expect(typeof previous).toBe('string');
      }
    }
  });
  it('extends to three long trials and only final probes, with a separate full control ceiling', async () => {
    const result = await runMemoryStudy(
      prepareMemoryStudy(config('long')),
      { execute: true },
      dependencies,
    );
    expect(result.report.actualProviderCalls).toBe(84);
    expect(result.observations).toHaveLength(30);
    expect(result.observations.every((o) => o.final && o.cutoff === 55)).toBe(true);
    expect(new Set(result.observations.map((o) => o.trial))).toEqual(new Set([1, 2, 3]));
    expect(
      result.observations
        .filter((o) => o.method === 'full-prefix')
        .every((o) => o.readerCheck?.measurements[0]?.inputLimitTokens === 8192),
    ).toBe(true);
    expect(
      result.observations
        .filter((o) => o.method !== 'full-prefix')
        .every((o) => o.readerCheck?.measurements[0]?.inputLimitTokens === 2048),
    ).toBe(true);
    expect(result.report.groups?.every((g) => g.final.total === 15)).toBe(true);
  });
  it('retains failed and blocked probes in denominators without repair or archive fallback', async () => {
    const result = await runMemoryStudy(
      prepareMemoryStudy(config()),
      { execute: true },
      {
        ...dependencies,
        complete: async (_m, messages) => ({
          content: messages[0]?.content.startsWith('Extract')
            ? '{"states":[]}'
            : '{"summary":"bad","extra":true}',
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0,
        }),
      },
    );
    expect(result.report.actualProviderCalls).toBe(40);
    expect(result.observations).toHaveLength(64);
    expect(
      result.observations.filter((o) => o.method !== 'goal-recall').every((o) => o.status !== 'ok'),
    ).toBe(true);
    expect(result.report.groups?.reduce((n, g) => n + g.final.total, 0)).toBe(72);
  });
  it('keeps the frozen plan and call cap enforceable', async () => {
    const changed = prepareMemoryStudy(config());
    const first = changed.plan.inputs[0];
    if (!first) throw new Error('Missing test input');
    first.goal = 'tampered';
    await expect(runMemoryStudy(changed, { execute: true }, dependencies)).rejects.toThrow();
    const result = await runMemoryStudy(
      prepareMemoryStudy({ ...config(), maxCalls: 1 }),
      { execute: true },
      dependencies,
    );
    expect(result.report.actualProviderCalls).toBe(1);
    expect(result.observations).toHaveLength(64);
  });
  it('invalidates a chain when reported reader usage exceeds its ceiling', async () => {
    const result = await runMemoryStudy(
      prepareMemoryStudy(config()),
      { execute: true },
      {
        ...dependencies,
        complete: async (model, messages, options) => {
          const value = await dependencies.complete(model, messages, options);
          return { ...value, inputTokens: messages[0]?.content.startsWith('Extract') ? 3000 : 100 };
        },
      },
    );
    expect(result.observations.every((o) => o.status === 'provider-overflow')).toBe(true);
    expect(result.report.groups?.every((g) => g.final.jointCorrect === 0)).toBe(true);
    expect(result.observations).toHaveLength(64);
  });
});
