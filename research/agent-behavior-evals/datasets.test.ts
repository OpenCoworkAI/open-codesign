import { describe, expect, it } from 'vitest';
import { exportTasks, getFixtures } from './datasets.mjs';
import { scoreDecision } from './evaluate.mjs';
import { parseConfig } from './model-config';
import { buildPlan, runModelEvaluation } from './model-runner';
import { sessionFixtures } from './session-fixtures.mjs';

describe('conversation-derived dataset boundaries', () => {
  const config = {
    schemaVersion: 1,
    model: { provider: 'test', modelId: 'test' },
    credentialEnv: 'TEST_KEY',
    maxCalls: 8,
  };
  it('preserves the default dataset and isolates case selection', () => {
    expect(parseConfig(config).caseIds).toHaveLength(20);
    expect(parseConfig({ ...config, dataset: 'design-sessions-v1' }).caseIds).toHaveLength(8);
    expect(() => parseConfig({ ...config, caseIds: ['session-name'] })).toThrow();
    expect(() =>
      parseConfig({ ...config, dataset: 'design-sessions-v1', caseIds: ['selection-1'] }),
    ).toThrow();
    expect(() => getFixtures('unknown')).toThrow();
    expect(() => parseConfig({ ...config, dataset: 'unknown' })).toThrow();
  });
  it.each(
    sessionFixtures,
  )('$id accepts its annotated decision and rejects its paired violation', (fixture) => {
    expect(scoreDecision(fixture, fixture.positive).pass).toBe(true);
    expect(scoreDecision(fixture, fixture.negative).pass).toBe(false);
    for (const policy of fixture.alternativePolicies) {
      const response = {
        action: policy.action,
        status: policy.status,
        targetIds: policy.targets,
        changes: policy.changes,
        expectedSourceHash: policy.hash,
      };
      expect(scoreDecision(fixture, response).pass).toBe(true);
      expect(scoreDecision(fixture, { ...response, status: 'completed' }).pass).toBe(false);
    }
  });
  it('exports no labels or provenance and hashes distinct exact prompts', () => {
    for (const task of exportTasks('design-sessions-v1').tasks)
      expect(Object.keys(task).sort()).toEqual(['context', 'id', 'prompt']);
    const baseline = buildPlan({ ...config, dataset: 'design-sessions-v1' });
    const checked = buildPlan({
      ...config,
      dataset: 'design-sessions-v1',
      promptVariant: 'constraint-check',
    });
    expect(baseline.fixtureSetHash).toBe(checked.fixtureSetHash);
    expect(baseline.promptHash).not.toBe(checked.promptHash);
    expect(baseline.requests).toHaveLength(8);
    expect(JSON.stringify(baseline.requests)).not.toMatch(
      /alternativePolicies|human review pending|sourceGroup/,
    );
  });
  it('scores the selected conversation dataset at the provider boundary', async () => {
    const fixture = sessionFixtures[0];
    if (!fixture) throw new Error('Missing fixture');
    const plan = buildPlan({ ...config, dataset: 'design-sessions-v1', caseIds: [fixture.id] });
    const result = await runModelEvaluation(plan, {
      apiKey: 'nonsecret-test-token',
      signal: new AbortController().signal,
      onObservation: async () => {},
      complete: async () => ({
        content: JSON.stringify(fixture.positive),
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0,
      }),
    });
    expect(result.summary.passed).toBe(1);
    expect(result.rows[0]?.category).toBe('approved-design-choice');
  });
});
