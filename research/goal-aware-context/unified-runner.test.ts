import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hashJson } from './corpus.js';
import { parseUnifiedConfig } from './unified-config.js';
import { loadUnifiedData, prepareUnifiedPlan } from './unified-plan.js';
import { runUnified } from './unified-runner.js';
import type { SessionDependencies } from './unified-session.js';

const target = {
  model: { provider: 'fixture', modelId: 'fixture-v1' },
  credentialEnv: 'FIXTURE_API_KEY',
  contextWindowTokens: 32768,
};
function fixture(overrides: Record<string, unknown> = {}) {
  const base = fileURLToPath(
    new URL(
      '../../.Codex/workspace/goal-aware-context/unified-runner/runner-tests/',
      import.meta.url,
    ),
  );
  mkdirSync(base, { recursive: true });
  const workspace = mkdtempSync(join(base, 'run-'));
  const config = parseUnifiedConfig({
    caseIds: ['s01-c49'],
    hostCaseIds: ['signup-ready'],
    budgets: [4096],
    trials: 1,
    models: { compressor: target, reader: target },
    maxCalls: 25,
    allowEstimatedBudget: true,
    ...overrides,
  });
  return { workspace, prepared: prepareUnifiedPlan(loadUnifiedData(), config, workspace) };
}
const fake: SessionDependencies['complete'] = async (_model, messages) => {
  const system = messages[0]?.content ?? '';
  let content: string;
  if (system.includes('Summarize'))
    content = JSON.stringify({
      summary: 'Same fixed summary: preserve approved choices and check current evidence.',
    });
  else if (system.includes('Choose the next action'))
    content = JSON.stringify({
      action: 'done',
      objectId: 'signup/page',
      checks: [],
      color: '#123456',
      font: 'Inter',
    });
  else {
    const body = JSON.parse(messages.at(-1)?.content ?? '{}');
    const question = JSON.parse(body.question);
    content = JSON.stringify({ [question.key]: 'fixture-answer' });
  }
  return { content, inputTokens: 10, outputTokens: 10, costUsd: 0 };
};

describe('unified offline-first execution', () => {
  it('dry-run does not inspect credentials/provider and never reports unrun scores', async () => {
    const f = fixture();
    const result = await runUnified(
      f.prepared,
      {},
      {
        getCredential: () => {
          throw new Error('credential read');
        },
        complete: async () => {
          throw new Error('provider called');
        },
      },
    );
    expect(result.report.mode).toBe('dry-run');
    expect(result.report.actualProviderCalls).toBe(0);
    expect(result.calls).toEqual([]);
    expect(result.observations).toEqual([]);
    expect(result.report.groups.compression.correct).toBeNull();
  });
  it('freezes one context for every question, shares one host summary and keeps score groups separate', async () => {
    const f = fixture();
    const result = await runUnified(
      f.prepared,
      { execute: true, workspace: f.workspace },
      { getCredential: () => 'not-logged-key', complete: fake },
    );
    expect(result.report.actualProviderCalls).toBe(25);
    expect(result.observations).toHaveLength(7);
    expect(result.report.groups.compression.total).toBe(20);
    expect(result.report.groups.hostFacts.total).toBe(10);
    const pair = result.observations.filter((row) => row.group === 'host-facts');
    expect(new Set(pair.map((row) => row.summaryHash)).size).toBe(1);
    expect(new Set(pair.map((row) => row.compressionCallId)).size).toBe(1);
    const ordinary = f.prepared.plan.compression.find((c) => c.method === 'ordinary-summary');
    if (!ordinary) throw new Error('Missing condition');
    const reads = result.calls.filter((call) => call.id.startsWith(`${ordinary.id}/read/`));
    expect(reads).toHaveLength(4);
    expect(
      new Set(
        reads.map((call) =>
          JSON.stringify(JSON.parse(call.messages.at(-1)?.content ?? '{}').contextSections),
        ),
      ).size,
    ).toBe(1);
    expect(JSON.stringify(result)).not.toContain('not-logged-key');
  });
  it('fails closed on unavailable counts without reading keys or calling providers', async () => {
    const f = fixture({ allowEstimatedBudget: false });
    const result = await runUnified(
      f.prepared,
      { execute: true, workspace: f.workspace },
      {
        getCredential: () => {
          throw new Error('key read');
        },
        complete: async () => {
          throw new Error('called');
        },
      },
    );
    expect(result.report.actualProviderCalls).toBe(0);
    expect(result.observations.every((row) => row.status === 'unavailable-budget')).toBe(true);
    expect(result.report.groups.compression.correct).toBe(0);
  });
  it('retains planned failure denominators when the cap stops later requests', async () => {
    const f = fixture({ maxCalls: 1 });
    let reads = 0;
    const result = await runUnified(
      f.prepared,
      { execute: true, workspace: f.workspace },
      {
        getCredential: () => {
          reads++;
          return 'fixture-credential-unique';
        },
        complete: fake,
      },
    );
    expect(result.report.actualProviderCalls).toBe(1);
    expect(reads).toBe(1);
    expect(result.report.groups.compression.total).toBe(20);
    expect(result.report.groups.hostFacts.total).toBe(10);
    expect(result.observations.some((row) => row.status !== 'ok')).toBe(true);
  });
  it('rejects invalid summaries without repair/retry or dropping cases', async () => {
    const f = fixture();
    const result = await runUnified(
      f.prepared,
      { execute: true, workspace: f.workspace },
      {
        getCredential: () => 'fixture-credential-unique',
        complete: async (model, messages, options) =>
          messages[0]?.content.includes('Summarize')
            ? { content: '{"notSummary":true}', inputTokens: 1, outputTokens: 1, costUsd: 0 }
            : fake(model, messages, options),
      },
    );
    expect(result.observations.filter((row) => row.status === 'invalid-summary')).toHaveLength(4);
    expect(result.report.actualProviderCalls).toBe(15);
    expect(result.report.groups.compression.total).toBe(20);
  });
  it('preflights all questions before the first reader call for a tier', async () => {
    const f = fixture();
    const counter = {
      id: 'fixture-framing@1',
      unit: 'tokens' as const,
      count: (input: { question: string | null }) =>
        input.question?.includes('animation') ? 9000 : 1,
    };
    const result = await runUnified(
      f.prepared,
      { execute: true, workspace: f.workspace },
      {
        getCredential: () => 'fixture-credential-unique',
        complete: fake,
        counters: { compressor: counter, reader: counter },
      },
    );
    const condition = f.prepared.plan.compression.find((c) => c.method === 'ordinary-summary');
    if (!condition) throw new Error('Missing condition');
    expect(result.observations.find((row) => row.conditionId === condition.id)?.status).toBe(
      'overflow',
    );
    expect(result.calls.some((call) => call.id.startsWith(`${condition.id}/read/`))).toBe(false);
  });
  it('does not reuse mutated plans or let provider callbacks alter later source inputs', async () => {
    const f = fixture();
    f.prepared.plan.config.maxCalls = 500;
    await expect(
      runUnified(
        f.prepared,
        { execute: true, workspace: f.workspace },
        { getCredential: () => 'fixture-credential-unique', complete: fake },
      ),
    ).rejects.toThrow(/changed|integrity/i);
    const valid = fixture();
    let changed = false;
    const result = await runUnified(
      valid.prepared,
      { execute: true, workspace: valid.workspace },
      {
        getCredential: () => 'fixture-credential-unique',
        complete: async (model, messages, options) => {
          if (!changed) {
            changed = true;
            const row = valid.prepared.plan.inputs[0]?.contextInput.chatRows[0];
            if (row) row.payload = { text: 'TAMPERED' };
          }
          return fake(model, messages, options);
        },
      },
    );
    expect(JSON.stringify(result.contexts)).not.toContain('TAMPERED');
  });
  it('flags reported input overflow even when preflight estimates fit', async () => {
    const f = fixture();
    const result = await runUnified(
      f.prepared,
      { execute: true, workspace: f.workspace },
      {
        getCredential: () => 'fixture-credential-unique',
        complete: async (model, messages, options) => ({
          ...(await fake(model, messages, options)),
          inputTokens: 999999,
        }),
      },
    );
    expect(result.observations.every((row) => row.status !== 'ok')).toBe(true);
    expect(result.report.groups.compression.correct).toBe(0);
  });
});

it('emits every call, context and terminal observation as execution progresses', async () => {
  const f = fixture();
  const events: string[] = [];
  const result = await runUnified(
    f.prepared,
    {
      execute: true,
      workspace: f.workspace,
      onCall: (row) => events.push(`call:${row.id}`),
      onContext: (row) => events.push(`context:${row.conditionId}`),
      onObservation: (row) => events.push(`observation:${row.conditionId}`),
    },
    { getCredential: () => 'fixture-credential-unique', complete: fake },
  );
  expect(events.filter((e) => e.startsWith('call:'))).toHaveLength(result.calls.length);
  expect(events.filter((e) => e.startsWith('context:'))).toHaveLength(result.contexts.length);
  expect(events.filter((e) => e.startsWith('observation:'))).toHaveLength(
    result.observations.length,
  );
  const first = f.prepared.plan.compression[0];
  if (!first) throw new Error('Missing condition');
  expect(events.indexOf(`context:${first.id}`)).toBeLessThan(
    events.indexOf(`call:${first.id}/read/buttonColor`),
  );
});

it('keeps a raw-production overflow in the planned denominator rather than trimming it', async () => {
  const f = fixture({ budgets: [2048] });
  const result = await runUnified(
    f.prepared,
    { execute: true, workspace: f.workspace },
    {
      getCredential: () => 'fixture-credential-unique',
      complete: fake,
    },
  );
  expect(result.observations.find((row) => row.method === 'production-raw')?.status).toBe(
    'overflow',
  );
  expect(result.report.actualProviderCalls).toBeLessThan(result.report.plannedCalls.total);
  expect(result.report.groups.compression.total).toBe(20);
});
it('skips both host reader arms when either complete request exceeds the pair budget', async () => {
  const f = fixture();
  const counter = {
    id: 'pair-counter@1',
    unit: 'tokens' as const,
    count: (input: { messages: readonly { content: string }[] }) =>
      input.messages.some((m) => m.content.includes('"hostFacts":{')) ? 9000 : 1,
  };
  const result = await runUnified(
    f.prepared,
    { execute: true, workspace: f.workspace },
    {
      getCredential: () => 'fixture-credential-unique',
      complete: fake,
      counters: { reader: counter, compressor: counter },
    },
  );
  expect(
    result.observations.filter((row) => row.group === 'host-facts').map((row) => row.status),
  ).toEqual(['overflow', 'overflow']);
  expect(
    result.calls.some(
      (call) => call.id.includes('/model-only/read') || call.id.includes('/host-facts/read'),
    ),
  ).toBe(false);
});

it('keeps unrun usage and actual billing unknown, while reporting observed usage separately', async () => {
  const f = fixture();
  const dry = await runUnified(f.prepared, {});
  expect(dry.report.usage.billingCostUsd).toBeNull();
  expect(dry.report.usage.reportedInputTokensSubtotal).toBeNull();
  const result = await runUnified(
    f.prepared,
    { execute: true, workspace: f.workspace },
    {
      getCredential: () => 'fixture-credential-unique',
      complete: fake,
    },
  );
  expect(result.report.usage.callsWithReportedUsage).toBe(25);
  expect(result.report.usage.reportedInputTokensSubtotal).toBe(250);
  expect(result.report.usage.totalInputIncludingCache).toBeNull();
  expect(result.report.usage.billingCostUsd).toBeNull();
});

it.each([
  'implementation',
  'lock',
] as const)('rejects a stale %s fingerprint before credentials or calls', async (field) => {
  const f = fixture();
  f.prepared.plan.sourceHashes[field] = '0'.repeat(64);
  const { planHash: _old, ...body } = f.prepared.plan;
  f.prepared.plan.planHash = hashJson(body);
  let reads = 0;
  await expect(
    runUnified(
      f.prepared,
      { execute: true, workspace: f.workspace },
      {
        getCredential: () => {
          reads++;
          return 'fixture-credential-unique';
        },
        complete: fake,
      },
    ),
  ).rejects.toThrow(/source|implementation|lock/i);
  expect(reads).toBe(0);
});
it('invalidates the entire compression condition when a later answer exceeds reported budget', async () => {
  const f = fixture();
  const answers: Record<string, string> = {
    buttonColor: '#3A6B35',
    font: 'system-ui',
    scope: '统计数字',
    animation: 'forbidden',
  };
  const result = await runUnified(
    f.prepared,
    { execute: true, workspace: f.workspace },
    {
      getCredential: () => 'fixture-credential-unique',
      complete: async (model, messages, options) => {
        if (!messages[0]?.content.includes('Answer the single'))
          return fake(model, messages, options);
        const question = JSON.parse(JSON.parse(messages.at(-1)?.content ?? '{}').question);
        return {
          content: JSON.stringify({ [question.key]: answers[question.key] }),
          inputTokens: question.key === 'font' ? 999999 : 10,
          outputTokens: 10,
          costUsd: 0,
        };
      },
    },
  );
  const conditions = result.observations.filter((r) => r.group === 'compression');
  expect(conditions.every((r) => r.status === 'provider-overflow')).toBe(true);
  expect(conditions.every((r) => r.score.correct === 0)).toBe(true);
  expect(
    conditions.every((r) => r.callIds.filter((id) => id.includes('/read/')).length === 2),
  ).toBe(true);
});
it('invalidates both host arms if the second arm exceeds reported budget', async () => {
  const f = fixture();
  const result = await runUnified(
    f.prepared,
    { execute: true, workspace: f.workspace },
    {
      getCredential: () => 'fixture-credential-unique',
      complete: async (model, messages, options) => {
        const response = await fake(model, messages, options);
        return messages[0]?.content.includes('Choose the next action') &&
          messages.some((m) => m.content.includes('"hostFacts":{'))
          ? { ...response, inputTokens: 999999 }
          : response;
      },
    },
  );
  const arms = result.observations.filter((r) => r.group === 'host-facts');
  expect(arms.map((r) => r.status)).toEqual(['paired-provider-overflow', 'provider-overflow']);
  expect(arms.map((r) => r.score.correct)).toEqual([0, 0]);
  expect(arms.every((r) => r.callIds.length === 2)).toBe(true);
});
it('preserves compressor protocol failures in terminal observations', async () => {
  const f = fixture();
  const result = await runUnified(
    f.prepared,
    { execute: true, workspace: f.workspace },
    {
      getCredential: () => 'fixture-credential-unique',
      complete: async (model, messages, options) =>
        messages[0]?.content.includes('Summarize')
          ? { content: 'bad-json', inputTokens: 1, outputTokens: 1, costUsd: 0 }
          : fake(model, messages, options),
    },
  );
  expect(
    result.observations
      .filter((r) => r.stage === 'compressor')
      .every((r) => r.status === 'invalid-json'),
  ).toBe(true);
});

it('scores approved aliases, exposes unknown shape review queue and preserves all planned questions', async () => {
  const f = fixture();
  const result = await runUnified(
    f.prepared,
    { execute: true, workspace: f.workspace },
    {
      getCredential: () => 'fixture-key',
      complete: async (model, messages, options) => {
        if (messages[0]?.content.includes('Answer the single requested')) {
          const q = JSON.parse(JSON.parse(messages.at(-1)?.content ?? '{}').question);
          return {
            content: JSON.stringify(
              q.key === 'scope' ? { scope: '仅调整统计卡片中的数字' } : { answer: 'unknown' },
            ),
            inputTokens: 1,
            outputTokens: 1,
            costUsd: 0,
          };
        }
        return fake(model, messages, options);
      },
    },
  );
  const rows = result.observations.filter((o) => o.group === 'compression');
  expect(rows.every((o) => o.questions?.length === 4)).toBe(true);
  expect(rows.flatMap((o) => o.questions ?? []).filter((q) => q.success)).toHaveLength(5);
  expect(result.report.groups.compression.correct).toBe(5);
  expect(result.report.groups.compression.questionMetrics).toMatchObject({
    total: 20,
    contentCorrect: 5,
    pendingReview: 15,
    successful: 5,
  });
  expect(result.report.reviewQueue).toHaveLength(15);
});
it('rejects changes to prepared scoring before reading keys', async () => {
  const f = fixture();
  f.prepared.scoring.aliasExtensions[0]?.answers.push('forbidden-new-alias');
  await expect(runUnified(f.prepared)).rejects.toThrow(/scoring|Frozen/i);
});

it('rejects a policy changed after freezing even when the new plan has a consistent hash', async () => {
  const f = fixture();
  const data = loadUnifiedData();
  const changed = structuredClone(f.prepared.scoring);
  changed.aliasExtensions[0]?.answers.push('unapproved');
  const prepared = prepareUnifiedPlan(
    { ...data, scoring: changed },
    f.prepared.plan.config,
    `${f.workspace}/other`,
  );
  expect(prepared.plan.planHash).not.toBe(f.prepared.plan.planHash);
  await expect(runUnified(prepared)).rejects.toThrow(/Current scoring/i);
});
