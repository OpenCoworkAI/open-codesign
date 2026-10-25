import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures } from './fixtures.mjs';
import { parseConfig } from './model-config';
import { buildPlan, type Completion, type Observation, runModelEvaluation } from './model-runner';

const config = {
  schemaVersion: 1,
  model: { provider: 'openai', modelId: 'fixture-model' },
  credentialEnv: 'TEST_EVAL_KEY',
  caseIds: ['selection-1'],
  maxCalls: 2,
  trials: 2,
  timeoutMs: 1000,
  maxOutputTokens: 500,
};
function positive(id = 'selection-1') {
  const fixture = fixtures.find((f) => f.id === id);
  if (!fixture) throw new Error('Missing fixture');
  return fixture.positive;
}
const response = (value: unknown) => ({
  content: JSON.stringify(value),
  inputTokens: 10,
  outputTokens: 5,
  costUsd: 0.01,
});
const key = 'test-private-credential-value';
function execute(
  complete: Completion,
  input: unknown = config,
  signal = new AbortController().signal,
) {
  const observed: Observation[] = [];
  const promise = runModelEvaluation(buildPlan(input), {
    complete,
    apiKey: key,
    signal,
    onObservation: async (row) => {
      observed.push(row);
    },
  });
  return { promise, observed };
}

afterEach(() => vi.useRealTimers());

describe('run configuration and blind request construction', () => {
  it.each([
    { apiKey: key },
    { model: { provider: 'openai', modelId: '' } },
    { maxCalls: 0 },
    { trials: 1.5 },
    { timeoutMs: -1 },
    { maxOutputTokens: 0 },
    { baseUrl: 'https://user:password@example.test' },
    { baseUrl: 'https://example.test?key=secret' },
    { wire: 'invented' },
    { reasoning: 'invented' },
    { caseIds: [] },
    { caseIds: ['selection-1', 'selection-1'] },
    { caseIds: ['not-a-fixture'] },
    { model: { provider: 'openai', modelId: 'x', apiKey: key } },
  ])('rejects invalid or unsafe config %j', (change) => {
    expect(() => parseConfig({ ...config, ...change })).toThrow();
  });
  it('hashes exact blind prompts and explicit settings reproducibly', () => {
    const a = buildPlan(config);
    const b = buildPlan(config);
    expect(a).toEqual(b);
    expect(a.requests.map((r) => r.trial)).toEqual([1, 2]);
    const changed = buildPlan({ ...config, promptVariant: 'constraint-check' });
    expect(changed.promptHash).not.toBe(a.promptHash);
    expect(changed.fixtureSetHash).toBe(a.fixtureSetHash);
    const payload = JSON.parse(a.requests[0]?.messages[1]?.content ?? 'null');
    expect(Object.keys(payload).sort()).toEqual(['observations', 'task']);
    expect(JSON.stringify(a.requests)).not.toMatch(/"(?:policy|positive|negative)"/);
  });
  it('rejects a request changed after manifest preparation', async () => {
    const plan = buildPlan(config);
    const request = plan.requests[0];
    if (!request) throw new Error('Missing request');
    request.messages.push({ role: 'system', content: 'tampered' });
    const complete = vi.fn<Completion>();
    await expect(
      runModelEvaluation(plan, {
        complete,
        apiKey: key,
        signal: new AbortController().signal,
        onObservation: async () => {},
      }),
    ).rejects.toThrow('mismatch');
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('model execution through the existing provider boundary', () => {
  it('retains recognized provider error codes without raw exception messages', async () => {
    const complete = vi
      .fn<Completion>()
      .mockRejectedValue(Object.assign(new Error(key), { code: 'PROVIDER_MODEL_UNKNOWN' }));
    const report = await execute(complete).promise;
    expect(report.rows[0]?.errors).toEqual(['provider_error', 'PROVIDER_MODEL_UNKNOWN']);
    expect(JSON.stringify(report)).not.toContain(key);
  });
  it('preserves model/options and scores independent trials, with usage', async () => {
    const complete = vi.fn<Completion>().mockResolvedValue(response(positive()));
    const report = await execute(complete, {
      ...config,
      baseUrl: 'https://example.test/v1',
      wire: 'openai-chat',
      reasoning: 'low',
    }).promise;
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0]?.[0]).toEqual(config.model);
    expect(complete.mock.calls[0]?.[2]).toMatchObject({
      apiKey: key,
      maxTokens: 500,
      timeoutMs: 1000,
      baseUrl: 'https://example.test/v1',
      wire: 'openai-chat',
      reasoning: 'low',
    });
    expect(report.summary).toMatchObject({ scheduled: 2, attempted: 2, passed: 2, passRate: 1 });
    expect(report.summary.usage).toMatchObject({
      callsWithUsage: 2,
      callsWithoutUsage: 0,
      observedInputTokens: 20,
      observedReportedCostUsd: 0.02,
    });
    expect(report.summary.trials).toHaveLength(2);
  });
  it('keeps wrong, malformed, truncated and failed responses in the denominator without retries', async () => {
    const length = Object.assign(new Error(key), {
      name: 'CompletionLengthError',
      usage: { inputTokens: 8, outputTokens: 3, costUsd: 0.02 },
    });
    const complete = vi
      .fn<Completion>()
      .mockResolvedValueOnce(response({ ...positive(), targetIds: ['wrong'] }))
      .mockResolvedValueOnce({ ...response(null), content: '```json\n{}\n```' })
      .mockResolvedValueOnce(response({}))
      .mockRejectedValueOnce(length)
      .mockRejectedValueOnce(new Error(`Authorization: ${key}`));
    const report = await execute(complete, { ...config, trials: 5, maxCalls: 5 }).promise;
    expect(report.rows.map((r) => r.status)).toEqual([
      'ok',
      'invalid_json',
      'invalid_response',
      'truncated',
      'provider_error',
    ]);
    expect(report.summary).toMatchObject({ scheduled: 5, attempted: 5, passed: 0 });
    expect(report.summary.usage.callsWithUsage).toBe(4);
    expect(report.summary.usage.callsWithoutUsage).toBe(1);
    expect(report.rows[3]?.rawResponse).toBeNull();
    expect(complete).toHaveBeenCalledTimes(5);
    expect(JSON.stringify(report)).not.toContain(key);
  });
  it('applies maxCalls globally across trials and retains unattempted rows', async () => {
    const complete = vi.fn<Completion>().mockResolvedValue(response(positive()));
    const report = await execute(complete, { ...config, trials: 3, maxCalls: 1 }).promise;
    expect(complete).toHaveBeenCalledTimes(1);
    expect(report.rows.map((r) => r.status)).toEqual([
      'ok',
      'skipped_call_limit',
      'skipped_call_limit',
    ]);
    expect(report.summary.passRate).toBe(1 / 3);
  });
  it('stops scheduling after a timeout even if the provider ignores abort', async () => {
    vi.useFakeTimers();
    const complete = vi.fn<Completion>().mockImplementation(() => new Promise(() => {}));
    const { promise } = execute(complete, { ...config, timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(11);
    const report = await promise;
    expect(report.rows.map((r) => r.status)).toEqual(['timeout', 'skipped_after_timeout']);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[2].signal?.aborted).toBe(true);
    expect(report.summary.usage.callsWithoutUsage).toBe(1);
  });
  it('records in-flight cancellation and prevents subsequent calls', async () => {
    const controller = new AbortController();
    const complete = vi.fn<Completion>().mockImplementation(() => {
      controller.abort();
      return new Promise(() => {});
    });
    const report = await execute(complete, config, controller.signal).promise;
    expect(report.rows.map((r) => r.status)).toEqual(['cancelled', 'skipped_cancelled']);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it('handles cancellation before starting, without model calls', async () => {
    const controller = new AbortController();
    controller.abort();
    const complete = vi.fn<Completion>();
    const report = await execute(complete, config, controller.signal).promise;
    expect(report.summary.attempted).toBe(0);
    expect(report.summary.scheduled).toBe(2);
    expect(complete).not.toHaveBeenCalled();
  });
  it('redacts credential echoes and never turns redaction into a passing decision', async () => {
    const complete = vi
      .fn<Completion>()
      .mockResolvedValue(response({ ...positive(), changes: [{ field: 'text', value: key }] }));
    const report = await execute(complete).promise;
    expect(report.rows[0]?.status).toBe('invalid_response');
    expect(report.rows[0]?.decision).toBeNull();
    expect(JSON.stringify(report)).not.toContain(key);
    expect(report.rows[0]?.rawResponse).toContain('[REDACTED]');
  });
  it('stops before another call when durable observation writing fails', async () => {
    const complete = vi.fn<Completion>().mockResolvedValue(response(positive()));
    await expect(
      runModelEvaluation(buildPlan(config), {
        complete,
        apiKey: key,
        signal: new AbortController().signal,
        onObservation: async () => {
          throw new Error('disk full');
        },
      }),
    ).rejects.toThrow('disk full');
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it('does not persist an escaped credential in decoded JSON', async () => {
    const escapedKey = key.replace('test', '\\u0074est');
    const complete = vi
      .fn<Completion>()
      .mockResolvedValue({ ...response(null), content: `{"leaked":"${escapedKey}"}` });
    const report = await execute(complete).promise;
    expect(report.rows[0]?.decision).toBeNull();
    expect(report.rows[0]?.errors).toEqual(['credential-in-response']);
    expect(report.rows[0]?.rawResponse).toBe('[REDACTED: credential-in-response]');
  });
});
