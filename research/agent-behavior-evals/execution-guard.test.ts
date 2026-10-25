import { describe, expect, it } from 'vitest';
import { createGuardedWorkspace } from './execution-guard';
import { guardStateForCase } from './guard-scenarios';
import { parseConfig } from './model-config';
import { buildPlan, runModelEvaluation } from './model-runner';
import { sessionFixtures } from './session-fixtures.mjs';

const done = {
  action: 'done',
  status: 'completed',
  targetIds: [],
  changes: [],
  expectedSourceHash: null,
};
const edit = {
  action: 'edit',
  status: 'pending',
  targetIds: ['notes-list', 'note-detail'],
  changes: [{ field: 'showAuthorship', value: 'false' }],
  expectedSourceHash: 'a'.repeat(64),
};
const inspect = {
  action: 'inspect',
  status: 'pending',
  targetIds: [],
  changes: [],
  expectedSourceHash: null,
};
const config = {
  schemaVersion: 1,
  dataset: 'design-sessions-v1',
  responseProtocol: 'typed-v2',
  model: { provider: 'test', modelId: 'test' },
  credentialEnv: 'TEST_TOKEN',
  maxCalls: 8,
};
describe('host-state execution guard', () => {
  it.each(
    sessionFixtures,
  )('$id admits the annotated positive continuation without reading its rubric', (f) => {
    const result = createGuardedWorkspace(guardStateForCase(f.id)).execute(f.positive);
    expect(result.allowed).toBe(true);
  });
  it('commits an authorized edit and preserves every unrelated object', () => {
    const workspace = createGuardedWorkspace(guardStateForCase('session-attribution'));
    const before = workspace.snapshot();
    const receipt = workspace.execute(edit);
    expect(receipt).toMatchObject({ allowed: true, effect: 'edit', writes: 2 });
    const after = workspace.snapshot();
    expect(
      after.state.objects
        .filter((o) => ['notes-list', 'note-detail'].includes(o.id))
        .every((o) => o.fields['showAuthorship'] === 'false'),
    ).toBe(true);
    expect(
      after.state.objects.filter((o) => !['notes-list', 'note-detail'].includes(o.id)),
    ).toEqual(before.state.objects.filter((o) => !['notes-list', 'note-detail'].includes(o.id)));
    expect(after.state.revision).toBe(before.state.revision + 1);
    expect(after.state.sourceHash).not.toBe(before.state.sourceHash);
  });
  it.each([
    [{ ...edit, targetIds: ['notes-list', 'article-detail'] }, 'unauthorized-object'],
    [{ ...edit, targetIds: ['notes-list', 'invented-id'] }, 'unknown-object'],
    [{ ...edit, changes: [{ field: 'authorship', value: 'none' }] }, 'unauthorized-field'],
    [{ ...edit, expectedSourceHash: 'b'.repeat(64) }, 'stale-source'],
    [{ ...edit, targetIds: ['notes-list', 'notes-list'] }, 'duplicate-target'],
    [{ ...edit, changes: [...edit.changes, ...edit.changes] }, 'duplicate-field'],
    [{ ...edit, targetIds: [] }, 'empty-edit'],
    [{ ...edit, status: 'completed' }, 'invalid-action-status'],
    [{ ...edit, changes: [{ field: '__proto__', value: 'injected' }] }, 'unauthorized-field'],
  ])('rejects %j atomically (%s)', (decision, reason) => {
    const workspace = createGuardedWorkspace(guardStateForCase('session-attribution'));
    const before = workspace.snapshot();
    const result = workspace.execute(decision);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain(reason);
    expect(result.beforeStateHash).toBe(result.afterStateHash);
    expect(result.effect).toBe('none');
    expect(result.writes).toBe(0);
    expect(workspace.snapshot()).toEqual(before);
  });
  it('requires a current explicit authorization and does not infer authority from existence', () => {
    const state = guardStateForCase('session-attribution');
    state.authorization = null;
    expect(createGuardedWorkspace(state).execute(edit).reasons).toContain('missing-authorization');
    state.authorization = guardStateForCase('session-attribution').authorization;
    if (!state.authorization) throw new Error('Missing test authority');
    state.authorization.revision = 0;
    expect(createGuardedWorkspace(state).execute(edit).reasons).toContain('stale-authorization');
  });
  it('rechecks the current revision at commit and invalidates verification after an edit', () => {
    const workspace = createGuardedWorkspace(guardStateForCase('session-attribution'));
    expect(workspace.execute(edit).allowed).toBe(true);
    const replay = workspace.execute(edit);
    expect(replay.reasons).toContain('stale-source');
    expect(replay.reasons).toContain('stale-authorization');
    expect(replay.beforeStateHash).toBe(replay.afterStateHash);
    const completion = workspace.execute(done);
    expect(completion.reasons).toContain('work-remaining');
    expect(completion.reasons).toContain('completion-evidence-stale');
    expect(workspace.snapshot().completed).toBe(false);
  });
  it.each([
    'session-name',
    'session-attribution',
    'session-exact-copy',
    'session-local-preview',
    'session-release-pending',
    'session-history-empty',
    'session-partial-verification',
  ])('blocks premature completion for %s without a completion signal', (id) => {
    const workspace = createGuardedWorkspace(guardStateForCase(id));
    const receipt = workspace.execute(done);
    expect(receipt.allowed).toBe(false);
    expect(receipt.effect).toBe('none');
    expect(receipt.beforeStateHash).toBe(receipt.afterStateHash);
    expect(workspace.snapshot().completed).toBe(false);
  });
  it('emits completion only after every required host check passes', () => {
    const workspace = createGuardedWorkspace(guardStateForCase('session-verified-release'));
    expect(workspace.execute(done)).toMatchObject({
      allowed: true,
      effect: 'completion',
      writes: 0,
    });
    expect(workspace.snapshot().completed).toBe(true);
  });
  it.each([
    'missing',
    'duplicate',
    'failed',
    'revision',
    'scope',
    'hash',
    'no-policy',
  ] as const)('fails closed for %s completion evidence', (change) => {
    const state = guardStateForCase('session-verified-release');
    const evidence = state.completion.evidence[0];
    if (!evidence) throw new Error('Missing test evidence');
    if (change === 'missing') state.completion.evidence.shift();
    if (change === 'duplicate') state.completion.evidence.push({ ...evidence });
    if (change === 'failed') evidence.result = 'failed';
    if (change === 'revision') evidence.revision = 0;
    if (change === 'scope') evidence.scopeId = 'other-design';
    if (change === 'hash') evidence.sourceHash = 'b'.repeat(64);
    if (change === 'no-policy') state.completion.requiredChecks = [];
    expect(createGuardedWorkspace(state).execute(done).allowed).toBe(false);
  });
  it('rejects model-forged evidence and copies host state to prevent external mutation', () => {
    const state = guardStateForCase('session-local-preview');
    const workspace = createGuardedWorkspace(state);
    state.completion.evidence.forEach((e) => {
      e.result = 'passed';
    });
    expect(workspace.execute(done).allowed).toBe(false);
    expect(workspace.execute({ ...done, evidence: state.completion.evidence }).reasons).toEqual([
      'invalid-decision',
    ]);
  });
  it('uses arbitrary host IDs, not case names or hard-coded target names', () => {
    const state = guardStateForCase('session-attribution');
    const rename = (id: string) => `renamed-${id}`;
    state.objects.forEach((o) => {
      o.id = rename(o.id);
    });
    state.authorization?.writable.forEach((o) => {
      o.id = rename(o.id);
    });
    const workspace = createGuardedWorkspace(state);
    expect(workspace.execute({ ...edit, targetIds: edit.targetIds.map(rename) }).allowed).toBe(
      true,
    );
  });
  it('does not act as an oracle for text correctness or unnecessary inspection', () => {
    const workspace = createGuardedWorkspace(guardStateForCase('session-exact-copy'));
    const f = sessionFixtures.find((f) => f.id === 'session-exact-copy');
    if (!f) throw new Error('Missing fixture');
    expect(workspace.execute(f.negative).allowed).toBe(true);
    expect(
      createGuardedWorkspace(guardStateForCase('session-verified-release')).execute(inspect)
        .allowed,
    ).toBe(true);
  });
  it('enforces non-edit field semantics without changing an otherwise correct decision', () => {
    const workspace = createGuardedWorkspace(guardStateForCase('session-history-empty'));
    const reply = { ...inspect, expectedSourceHash: 'a'.repeat(64) };
    expect(workspace.execute(reply).reasons).toContain('non-edit-payload');
    expect(reply.expectedSourceHash).toBe('a'.repeat(64));
    expect(workspace.execute(inspect).allowed).toBe(true);
  });
  it('leaves model requests unchanged and records authority separately', () => {
    const off = buildPlan(config);
    const on = buildPlan({ ...config, executionGuard: 'enforce-v1' });
    expect(on.requests).toEqual(off.requests);
    expect(on.fixtureSetHash).toBe(off.fixtureSetHash);
    expect(on.guardSnapshots).toHaveLength(8);
    expect(JSON.stringify(on.requests)).not.toContain('writable');
    expect(() => parseConfig({ ...config, executionGuard: 'invented' })).toThrow();
    expect(() =>
      parseConfig({ ...config, dataset: 'synthetic-v1', executionGuard: 'enforce-v1' }),
    ).toThrow();
  });
  it('runs the guard before isolated effects while preserving the raw score', async () => {
    const report = await runModelEvaluation(
      buildPlan({ ...config, caseIds: ['session-attribution'], executionGuard: 'enforce-v1' }),
      {
        apiKey: 'nonsecret-test-token',
        signal: new AbortController().signal,
        onObservation: async () => {},
        complete: async () => ({
          content: JSON.stringify({ ...edit, targetIds: ['notes-list', 'article-detail'] }),
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0,
        }),
      },
    );
    expect(report.rows[0]?.passed).toBe(false);
    expect(report.rows[0]?.guard).toMatchObject({ allowed: false, effect: 'none', writes: 0 });
    expect(report.summary.executionGuard).toMatchObject({
      assessed: 1,
      blocked: 1,
      blockedRubricFailures: 1,
      blockedRubricPasses: 0,
      blockedWithSideEffects: 0,
    });
  });
});
