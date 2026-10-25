import { describe, expect, it, vi } from 'vitest';
import { scoreDecision } from './evaluate.mjs';
import { parseConfig } from './model-config';
import { buildPlan, type Completion, runModelEvaluation } from './model-runner';
import { decisionSchema } from './response-schema';
import { sessionFixtures } from './session-fixtures.mjs';

const config = {
  schemaVersion: 1,
  dataset: 'design-sessions-v1',
  model: { provider: 'local', modelId: 'test' },
  credentialEnv: 'TEST_TOKEN',
  maxCalls: 8,
};

describe('versioned response protocol', () => {
  it('keeps the original prompt bytes reproducible', () => {
    expect(buildPlan(config).promptHash).toBe(
      '0c51fe1cdc231696f9b7ec2232d6d533661a10efed3f5d65551340588fb2047b',
    );
    expect(buildPlan({ ...config, promptVariant: 'constraint-check' }).promptHash).toBe(
      'cfec2084c314d04ec9702f88ccebdf9c271f870d900f9f272037f137bec6a11c',
    );
  });
  it('versions the typed prompt without changing cases or adding answers', () => {
    const old = buildPlan(config);
    const next = buildPlan({ ...config, responseProtocol: 'typed-v2' });
    expect(next.fixtureSetHash).toBe(old.fixtureSetHash);
    expect(next.promptHash).not.toBe(old.promptHash);
    expect(next.responseSchema).toEqual(decisionSchema);
    expect(JSON.stringify(next.responseSchema)).not.toMatch(
      /notes-navigation|new-note|previousPathsGuard|alternativePolicies/,
    );
    expect(next.requests[0]?.messages[1]).toEqual(old.requests[0]?.messages[1]);
  });
  it.each([
    { responseProtocol: 'invented' },
    { responseFormat: 'invented' },
    { responseFormat: 'json-schema', wire: 'openai-chat' },
    { responseFormat: 'json-schema', responseProtocol: 'typed-v2', wire: 'openai-codex-responses' },
  ])('rejects unsupported protocol/transport combinations %j', (change) => {
    expect(() => parseConfig({ ...config, ...change })).toThrow();
  });
  it('requests schema enforcement but still validates the returned response and scores behavior', async () => {
    const fixture = sessionFixtures[0];
    if (!fixture) throw new Error('Missing fixture');
    const complete = vi.fn<Completion>().mockResolvedValue({
      content: JSON.stringify(fixture.negative),
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
    });
    const plan = buildPlan({
      ...config,
      responseProtocol: 'typed-v2',
      responseFormat: 'json-schema',
      wire: 'openai-chat',
      caseIds: [fixture.id],
    });
    const deps = {
      complete,
      apiKey: 'test-nonsecret-token',
      signal: new AbortController().signal,
      onObservation: async () => {},
    };
    const report = await runModelEvaluation(plan, deps);
    expect(complete.mock.calls[0]?.[2].jsonSchema).toEqual({
      name: 'codesign_decision',
      schema: decisionSchema,
    });
    expect(report.summary.responseQuality).toMatchObject({
      schemaValid: 1,
      rubricFailures: 1,
      formatFailures: 0,
      passRateAmongSchemaValid: 0,
    });
    complete.mockResolvedValue({
      content: '```json\n{}\n```',
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
    });
    const invalid = await runModelEvaluation(plan, deps);
    expect(invalid.summary.responseQuality).toMatchObject({
      schemaValid: 0,
      formatFailures: 1,
      passRateAmongSchemaValid: null,
    });
  });
  it('reports errors against the closest allowed continuation without relaxing its score', () => {
    const fixture = sessionFixtures.find((f) => f.id === 'session-history-empty');
    if (!fixture) throw new Error('Missing fixture');
    const result = scoreDecision(fixture, {
      action: 'report-blocked',
      status: 'blocked',
      targetIds: [],
      changes: [],
      expectedSourceHash: 'a'.repeat(64),
    });
    expect(result).toEqual({ pass: false, errors: ['source-evidence-mismatch'] });
  });
});
