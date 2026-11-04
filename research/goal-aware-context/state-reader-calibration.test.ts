import { describe, expect, it } from 'vitest';
import { hashJson } from './corpus.js';
import { prepareStateCalibration, runStateCalibration } from './state-reader-calibration.js';
import { parseUnifiedConfig } from './unified-config.js';
import type { SessionDependencies } from './unified-session.js';

const target = {
  model: { provider: 'fixture', modelId: 'fixture' },
  credentialEnv: 'READER_FIXTURE_KEY',
  allowKeyless: true,
  contextWindowTokens: 32768,
};
const config = () =>
  parseUnifiedConfig({
    models: { compressor: { ...target, credentialEnv: 'UNUSED_COMPRESSOR_KEY' }, reader: target },
    budgets: [2048],
    trials: 1,
    maxOutputTokens: 4096,
    summaryMaxBytes: 1800,
    maxCalls: 12,
    timeoutMs: 60000,
    allowEstimatedBudget: true,
  });
function oracle(
  prepared: ReturnType<typeof prepareStateCalibration>,
  inspect?: SessionDependencies['complete'],
): SessionDependencies {
  let requestId = '';
  return {
    getCredential: () => '',
    onRequest: (request) => {
      requestId = request.id;
      expect(request.role).toBe('reader');
    },
    complete: async (model, messages, options) => {
      if (inspect) await inspect(model, messages, options);
      const probe = prepared.plan.probes.find((p) => p.id === requestId);
      if (!probe) throw new Error('Unknown test probe');
      const reference = prepared.references[`${probe.trajectoryId}/${probe.cutoff}`];
      if (!reference) throw new Error('Missing test reference');
      return {
        content: JSON.stringify({
          states: reference.claims.map(
            ({ acceptedValues, acceptedSourceSets: _sets, ...state }) => ({
              ...state,
              value: acceptedValues[0],
            }),
          ),
        }),
        inputTokens: 10,
        outputTokens: 10,
        costUsd: 0,
      };
    },
  };
}
describe('full-prefix reader calibration', () => {
  it('plans exactly twelve isolated probes with no gold fields or dry-run credentials', async () => {
    const prepared = prepareStateCalibration(config());
    expect(prepared.plan.protocol).toBe('trace-state-reader-calibration@1');
    expect(prepared.plan.plannedCalls).toEqual({ compressor: 0, reader: 12, total: 12 });
    expect(prepared.plan.probes).toHaveLength(12);
    for (const field of ['acceptedValues', 'acceptedSourceSets', 'referenceRules', 'claims'])
      expect(JSON.stringify(prepared.plan)).not.toContain(field);
    const result = await runStateCalibration(
      prepared,
      {},
      {
        getCredential: () => {
          throw new Error('key accessed');
        },
        complete: async () => {
          throw new Error('API accessed');
        },
      },
    );
    expect(result.report.actualProviderCalls).toBe(0);
    expect(result.report.groups).toBeNull();
    expect(result.report.readiness).toBeNull();
    expect(result.calls).toEqual([]);
  });
  it('passes the reader control with 27 state items and only prefix evidence in identical probe envelopes', async () => {
    const prepared = prepareStateCalibration(config());
    let seen = 0;
    const result = await runStateCalibration(
      prepared,
      { execute: true },
      oracle(prepared, async (_model, messages, options) => {
        const probe = prepared.plan.probes[seen++];
        if (!probe) throw new Error('Extra test request');
        expect(messages[0]?.content).toBe(prepared.plan.probePrompt);
        const input = JSON.parse(messages[1]?.content ?? '{}');
        const memory = JSON.parse(input.frozenMemory);
        expect(Object.keys(input).sort()).toEqual(['frozenMemory', 'stateKeys']);
        expect(memory.events).toHaveLength(probe.cutoff + 1);
        expect(memory.events.every((e: { seq: number }) => e.seq <= probe.cutoff)).toBe(true);
        for (const field of ['acceptedValues', 'acceptedSourceSets', 'referenceRules'])
          expect(JSON.stringify(messages)).not.toContain(field);
        expect(options.maxTokens).toBe(4096);
        expect(options.maxRetries).toBe(0);
        return { content: '{}', inputTokens: 1, outputTokens: 1, costUsd: 0 };
      }),
    );
    expect(seen).toBe(12);
    expect(result.report.actualProviderCalls).toBe(12);
    expect(result.report.groups?.fullPrefix).toMatchObject({ total: 27, jointCorrect: 27 });
    expect(result.report.groups?.final).toMatchObject({ total: 9, jointCorrect: 9 });
    expect(result.report.readiness?.passed).toBe(true);
  });
  it('retains twelve probes and all 27 state items when the configured call cap is reached', async () => {
    const prepared = prepareStateCalibration({ ...config(), maxCalls: 2 });
    const result = await runStateCalibration(prepared, { execute: true }, oracle(prepared));
    expect(result.report.actualProviderCalls).toBe(2);
    expect(result.observations).toHaveLength(12);
    expect(result.observations.filter((o) => o.status === 'call-limit')).toHaveLength(10);
    expect(result.report.groups?.fullPrefix.total).toBe(27);
    expect(result.report.readiness?.passed).toBe(false);
  });
  it('keeps wrong answers separate from runtime and format validity', async () => {
    const prepared = prepareStateCalibration(config());
    const result = await runStateCalibration(
      prepared,
      { execute: true },
      {
        getCredential: () => '',
        complete: async () => ({
          content: '{"states":[]}',
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0,
        }),
      },
    );
    expect(result.observations.every((o) => o.status === 'ok' && o.score.formatValid)).toBe(true);
    expect(result.report.groups?.fullPrefix).toMatchObject({ total: 27, jointCorrect: 0 });
    expect(result.report.readiness?.passed).toBe(false);
  });
  it.each([
    'cancelled',
    'missing-credential',
    'timeout',
    'provider-error',
    'invalid-json',
    'length',
    'overflow',
    'unavailable-budget',
  ])('retains the denominator for %s without retries', async (failure) => {
    const settings = config();
    if (failure === 'missing-credential') settings.models.reader.allowKeyless = false;
    if (failure === 'timeout') settings.timeoutMs = 5;
    if (failure === 'unavailable-budget') settings.allowEstimatedBudget = false;
    const controller = new AbortController();
    if (failure === 'cancelled') controller.abort();
    let count = 0;
    const result = await runStateCalibration(
      prepareStateCalibration(settings),
      { execute: true, signal: controller.signal },
      {
        getCredential: () => undefined,
        complete: async () => {
          count++;
          if (failure === 'timeout') return new Promise(() => {});
          if (failure === 'provider-error') throw new Error('DO_NOT_PERSIST_PROVIDER_SECRET');
          if (failure === 'length')
            throw Object.assign(new Error('secret'), { name: 'CompletionLengthError' });
          return {
            content: failure === 'invalid-json' ? 'broken-json' : '{"states":[]}',
            inputTokens: failure === 'overflow' ? 99999 : 1,
            outputTokens: 1,
            costUsd: 0,
          };
        },
      },
    );
    expect(result.observations).toHaveLength(12);
    expect(result.report.groups?.fullPrefix.total).toBe(27);
    expect(result.report.readiness?.passed).toBe(false);
    expect(result.report.actualProviderCalls).toBe(count);
    expect(count).toBe(
      ['cancelled', 'missing-credential', 'unavailable-budget'].includes(failure)
        ? 0
        : ['timeout', 'provider-error'].includes(failure)
          ? 1
          : 12,
    );
    expect(JSON.stringify(result)).not.toContain('DO_NOT_PERSIST_PROVIDER_SECRET');
  });
  it.each([
    'reference',
    'input',
    'review',
  ])('rejects rehashed %s mutation before any credentials', async (field) => {
    const prepared = prepareStateCalibration(config());
    if (field === 'reference') {
      const claim = Object.values(prepared.references)[0]?.claims[0];
      if (!claim) throw new Error('Missing fixture');
      claim.acceptedValues.push('UNAPPROVED');
      prepared.plan.referenceHash = hashJson(prepared.references);
    } else if (field === 'input') {
      const event = prepared.plan.inputs[0]?.events[0];
      if (!event) throw new Error('Missing fixture');
      event.text = 'UNAPPROVED';
    } else prepared.plan.reviewHash = '0'.repeat(64);
    const { planHash: _hash, ...body } = prepared.plan;
    prepared.plan.planHash = hashJson(body);
    await expect(
      runStateCalibration(
        prepared,
        { execute: true },
        {
          getCredential: () => {
            throw Error('key accessed');
          },
          complete: async () => {
            throw Error('API accessed');
          },
        },
      ),
    ).rejects.toThrow(/Frozen|approval|review/i);
  });
});
