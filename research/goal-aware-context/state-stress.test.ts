import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashJson } from './corpus.js';
import { scoreTraceState } from './state-evaluation.js';
import { prepareStateStress, runStateStress } from './state-stress.js';
import { stateStressDryRun } from './state-stress-cli.js';
import { stateStressFixtures } from './state-stress-fixtures.js';
import { parseUnifiedConfig } from './unified-config.js';

const target = {
  model: { provider: 'fixture', modelId: 'fixture' },
  credentialEnv: 'FIXTURE_KEY',
  allowKeyless: true,
  contextWindowTokens: 32768,
};
const config = () =>
  parseUnifiedConfig({
    models: { compressor: target, reader: target },
    budgets: [2048],
    trials: 1,
    maxOutputTokens: 4096,
    summaryMaxBytes: 1800,
    maxCalls: 64,
    allowEstimatedBudget: true,
  });
describe('minimal closed-memory stress replay', () => {
  it('binds the reviewed v2 policy without exposing accepted source sets', () => {
    const prepared = prepareStateStress(config());
    expect(prepared.plan.protocol).toBe('trace-state-stress@2');
    expect(prepared.plan.annotationStatus).toBe('synthetic-user-reviewed');
    expect(prepared.plan.reviewHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(prepared.plan)).not.toContain('acceptedSourceSets');
  });
  it('rejects a changed approval fingerprint before credentials even if the plan is rehashed', async () => {
    const prepared = prepareStateStress(config());
    prepared.plan.reviewHash = '0'.repeat(64);
    const { planHash: _hash, ...body } = prepared.plan;
    prepared.plan.planHash = hashJson(body);
    await expect(runStateStress(prepared)).rejects.toThrow(/approval|review/i);
  });
  it('rejects unapproved reference aliases even if both reference and plan are rehashed', async () => {
    const prepared = prepareStateStress(config());
    const claim = Object.values(prepared.references)[0]?.claims[0];
    if (!claim) throw new Error('Missing reference');
    claim.acceptedValues.push('unapproved-answer');
    prepared.plan.referenceHash = hashJson(prepared.references);
    const { planHash: _hash, ...body } = prepared.plan;
    prepared.plan.planHash = hashJson(body);
    await expect(runStateStress(prepared)).rejects.toThrow(/approval|review|Frozen/i);
  });
  it('rejects modified model input events even if the plan is rehashed', async () => {
    const prepared = prepareStateStress(config());
    const event = prepared.plan.inputs[0]?.events[0];
    if (!event) throw new Error('Missing event');
    event.text = 'Unapproved replacement event';
    const { planHash: _hash, ...body } = prepared.plan;
    prepared.plan.planHash = hashJson(body);
    await expect(runStateStress(prepared)).rejects.toThrow(/approval|review|Frozen/i);
  });
  it('prepares 64 calls with isolated evaluator references and no model access on dry-run', async () => {
    const prepared = prepareStateStress(config());
    expect(prepared.plan.plannedCalls).toEqual({ compressor: 32, reader: 32, total: 64 });
    expect(JSON.stringify(prepared.plan)).not.toContain('acceptedValues');
    expect(JSON.stringify(prepared.plan)).not.toContain('claims');
    expect(prepared.plan.probePrompt).not.toContain('reread-App.jsx');
    const result = await runStateStress(
      prepared,
      { execute: false },
      {
        getCredential: () => {
          throw Error('credential accessed');
        },
        complete: async () => {
          throw Error('provider accessed');
        },
      },
    );
    expect(result.report.actualProviderCalls).toBe(0);
    expect(result.report.groups).toBeNull();
    expect(result.calls).toEqual([]);
  });
  it('uses only previous summary + event deltas and never feeds probes back to the compressor', async () => {
    const prepared = prepareStateStress(config());
    const requests: { role: string; body: string }[] = [];
    const result = await runStateStress(
      prepared,
      { execute: true },
      {
        getCredential: () => '',
        complete: async (_model, messages) => {
          const compressor = messages[0]?.content.includes('Summarize');
          requests.push({
            role: compressor ? 'compressor' : 'reader',
            body: JSON.stringify(messages),
          });
          return {
            content: compressor
              ? JSON.stringify({ summary: 'MEMORY_MARKER' })
              : JSON.stringify({ states: [] }),
            inputTokens: 10,
            outputTokens: 10,
            costUsd: 0,
          };
        },
      },
    );
    expect(result.report.actualProviderCalls).toBe(64);
    const second = result.calls.find(
      (c) => c.id.includes('/3/') && c.id.endsWith('/round-2/compress'),
    );
    expect(second).toBeDefined();
    expect(JSON.stringify(second?.messages)).toContain('MEMORY_MARKER');
    expect(JSON.stringify(second?.messages)).not.toContain('e0');
    expect(
      requests
        .filter((r) => r.role === 'compressor')
        .every(
          (r) =>
            !r.body.includes('stateKeys') &&
            !r.body.includes('acceptedValues') &&
            !r.body.includes('"states":[]'),
        ),
    ).toBe(true);
    expect(result.observations).toHaveLength(32);
  });
  it('keeps later rounds unavailable after invalid summary instead of replaying full history', async () => {
    const result = await runStateStress(
      prepareStateStress(config()),
      { execute: true },
      {
        getCredential: () => '',
        complete: async () => ({
          content: '{"summary":"x","extra":true}',
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0,
        }),
      },
    );
    expect(result.report.actualProviderCalls).toBe(16);
    expect(result.observations).toHaveLength(32);
    expect(result.observations.every((o) => o.score.jointCorrect === 0)).toBe(true);
  });
  it('keeps same-design correction and new-design local restriction paired with a surviving global constraint', () => {
    const fixtures = stateStressFixtures();
    const same = fixtures.find((f) => f.id === 'correction-same-design');
    const other = fixtures.find((f) => f.id === 'correction-new-design');
    if (!same || !other) throw new Error('Missing fixture pair');
    expect(same.family).toBe(other.family);
    expect(same.checkpoints[2]?.claims.find((c) => c.key === 'font')?.acceptedValues).toEqual([
      'Georgia',
    ]);
    expect(other.checkpoints[2]?.claims.find((c) => c.key === 'font')?.acceptedValues).toEqual([
      'unresolved',
      '尚未决定',
      '待确认',
    ]);
    expect(
      other.checkpoints[2]?.claims.find((c) => c.key === 'animations')?.scope.designId,
    ).toBeNull();
  });
  it('rejects tampered references before credentials are read', async () => {
    const prepared = prepareStateStress(config());
    const reference = Object.values(prepared.references)[0];
    if (!reference?.claims[0]) throw new Error('Missing reference');
    reference.claims[0].acceptedValues.push('tampered');
    await expect(runStateStress(prepared)).rejects.toThrow(/Frozen/);
  });
  it('keeps counters unavailable without provider calls and retains every stage', async () => {
    const result = await runStateStress(
      prepareStateStress({ ...config(), allowEstimatedBudget: false }),
      { execute: true },
      {
        getCredential: () => {
          throw Error('key read');
        },
        complete: async () => {
          throw Error('provider call');
        },
      },
    );
    expect(result.report.actualProviderCalls).toBe(0);
    expect(result.observations).toHaveLength(32);
    expect(
      result.report.groups?.every((g) => g.final.jointCorrect === 0 && g.final.total === 9),
    ).toBe(true);
  });
  it('scores oracle-shaped test responses fully without exposing references to the request', async () => {
    let requestId = '';
    const fixtures = stateStressFixtures();
    const result = await runStateStress(
      prepareStateStress(config()),
      { execute: true },
      {
        getCredential: () => '',
        onRequest: (r) => {
          requestId = r.id;
        },
        complete: async (_model, messages) => {
          expect(JSON.stringify(messages)).not.toContain('acceptedValues');
          expect(JSON.stringify(messages)).not.toContain('acceptedSourceSets');
          expect(JSON.stringify(messages)).not.toContain('referenceRules');
          expect(JSON.stringify(messages)).not.toContain('approvedSnapshot');
          if (requestId.endsWith('/compress'))
            return {
              content: '{"summary":"fixture memory"}',
              inputTokens: 1,
              outputTokens: 1,
              costUsd: 0,
            };
          const [id, count, , round] = requestId.split('/');
          const cutoff = count === '1' ? 5 : Number(round?.split('-')[1]) * 2 - 1;
          const reference = fixtures
            .find((f) => f.id === id)
            ?.checkpoints.find((c) => c.cutoff === cutoff);
          if (!reference) throw Error('Missing test reference');
          return {
            content: JSON.stringify({
              states: reference.claims.map(
                ({ acceptedValues, acceptedSourceSets: _sourceSets, ...claim }) => ({
                  ...claim,
                  value: acceptedValues[0],
                }),
              ),
            }),
            inputTokens: 1,
            outputTokens: 1,
            costUsd: 0,
          };
        },
      },
    );
    expect(result.report.groups?.every((g) => g.final.jointCorrect === 9)).toBe(true);
    expect(result.report.groups?.reduce((n, g) => n + g.allStages.total, 0)).toBe(72);
    expect(result.report.firstObservedFailure.every((f) => f.round === null)).toBe(true);
  });
  it('writes an exclusive 64-call zero-score dry-run without an execute switch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'state-stress-cli-'));
    const output = join(root, 'run');
    const result = await stateStressDryRun(['--output', output]);
    expect(result.plannedCalls.total).toBe(64);
    expect(result.actualProviderCalls).toBe(0);
    expect(JSON.parse(readFileSync(join(output, 'report.json'), 'utf8')).groups).toBeNull();
    expect(readFileSync(join(output, 'calls.jsonl'), 'utf8')).toBe('');
    await expect(stateStressDryRun(['--output', output])).rejects.toThrow();
    await expect(
      stateStressDryRun(['--execute', 'true', '--output', join(root, 'other')]),
    ).rejects.toThrow();
  });
  it.each([
    'read:App.jsx',
    '重读 App.jsx',
  ])('accepts supported recovery-action expression: %s', (value) => {
    const reference = stateStressFixtures().find((f) => f.id === 'recovery-action')?.checkpoints[1];
    if (!reference) throw new Error('Missing recovery reference');
    const states = reference.claims.map(
      ({ acceptedValues, acceptedSourceSets: _sourceSets, ...claim }) => ({
        ...claim,
        value: claim.key === 'nextAction' ? value : acceptedValues[0],
      }),
    );
    expect(scoreTraceState(reference, { status: 'ok', value: { states } }).jointCorrect).toBe(
      reference.claims.length,
    );
  });
  it('reports the actual late overflow round while keeping the whole chain invalid', async () => {
    let requestId = '';
    const fixtures = stateStressFixtures();
    const result = await runStateStress(
      prepareStateStress(config()),
      { execute: true },
      {
        getCredential: () => '',
        onRequest: (r) => {
          requestId = r.id;
        },
        complete: async () => {
          if (requestId.endsWith('/compress'))
            return {
              content: '{"summary":"fixture memory"}',
              inputTokens:
                requestId === 'version-facts/3/ordinary-summary/round-3/compress' ? 999999 : 1,
              outputTokens: 1,
              costUsd: 0,
            };
          const [id, count, , round] = requestId.split('/');
          const reference = fixtures
            .find((f) => f.id === id)
            ?.checkpoints.find(
              (c) => c.cutoff === (count === '1' ? 5 : Number(round?.split('-')[1]) * 2 - 1),
            );
          if (!reference) throw new Error('Missing test reference');
          return {
            content: JSON.stringify({
              states: reference.claims.map(
                ({ acceptedValues, acceptedSourceSets: _sourceSets, ...claim }) => ({
                  ...claim,
                  value: acceptedValues[0],
                }),
              ),
            }),
            inputTokens: 1,
            outputTokens: 1,
            costUsd: 0,
          };
        },
      },
    );
    expect(
      result.report.firstObservedFailure.find(
        (f) => f.chainId === 'version-facts/3/ordinary-summary',
      ),
    ).toMatchObject({ round: 3, cutoff: 5, cause: 'provider-overflow' });
    expect(
      result.observations
        .filter((o) => o.chainId === 'version-facts/3/ordinary-summary')
        .every((o) => o.score.jointCorrect === 0),
    ).toBe(true);
  });
});
