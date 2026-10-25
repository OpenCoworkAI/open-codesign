import { createHash } from 'node:crypto';
import { validDecision } from './decision-shape';

export interface TrustedState {
  scopeId: string;
  revision: number;
  sourceHash: string;
  objects: { id: string; fields: Record<string, string> }[];
  authorization: null | {
    scopeId: string;
    revision: number;
    sourceHash: string;
    writable: { id: string; fields: string[] }[];
  };
  completion: {
    scopeId: string;
    pendingWork: number;
    requiredChecks: string[];
    evidence: {
      check: string;
      scopeId: string;
      revision: number;
      sourceHash: string;
      result: 'passed' | 'failed' | 'pending';
    }[];
  };
}
export type GuardReason =
  | 'invalid-decision'
  | 'invalid-action-status'
  | 'non-edit-payload'
  | 'empty-edit'
  | 'duplicate-target'
  | 'duplicate-field'
  | 'unknown-object'
  | 'unauthorized-object'
  | 'unauthorized-field'
  | 'stale-source'
  | 'missing-authorization'
  | 'stale-authorization'
  | 'completion-policy-missing'
  | 'work-remaining'
  | 'completion-evidence-missing'
  | 'completion-evidence-failed'
  | 'completion-evidence-stale';

// Only host-owned state enters this function. No fixture labels or model-supplied evidence.
export function checkDecision(state: TrustedState, input: unknown) {
  const reasons = new Set<GuardReason>();
  if (!validDecision(input))
    return { allowed: false, reasons: ['invalid-decision'] as GuardReason[] };
  const expectedStatus =
    input.action === 'done'
      ? 'completed'
      : input.action === 'report-blocked'
        ? 'blocked'
        : 'pending';
  if (input.status !== expectedStatus) reasons.add('invalid-action-status');
  if (input.action !== 'edit') {
    if (input.targetIds.length || input.changes.length || input.expectedSourceHash !== null)
      reasons.add('non-edit-payload');
  } else {
    if (!input.targetIds.length || !input.changes.length) reasons.add('empty-edit');
    if (new Set(input.targetIds).size !== input.targetIds.length) reasons.add('duplicate-target');
    if (new Set(input.changes.map((c) => c.field)).size !== input.changes.length)
      reasons.add('duplicate-field');
    if (input.expectedSourceHash !== state.sourceHash) reasons.add('stale-source');
    const authorization = state.authorization;
    if (!authorization) reasons.add('missing-authorization');
    else if (
      authorization.scopeId !== state.scopeId ||
      authorization.revision !== state.revision ||
      authorization.sourceHash !== state.sourceHash
    )
      reasons.add('stale-authorization');
    for (const id of input.targetIds) {
      const object = state.objects.find((o) => o.id === id);
      const permission = authorization?.writable.find((o) => o.id === id);
      if (!object) reasons.add('unknown-object');
      if (!permission) reasons.add('unauthorized-object');
      for (const change of input.changes) {
        if (
          !permission?.fields.includes(change.field) ||
          !object ||
          !Object.hasOwn(object.fields, change.field) ||
          ['__proto__', 'constructor', 'prototype'].includes(change.field)
        )
          reasons.add('unauthorized-field');
      }
    }
  }
  if (input.action === 'done' || input.status === 'completed') {
    const completion = state.completion;
    if (completion.scopeId !== state.scopeId || !completion.requiredChecks.length)
      reasons.add('completion-policy-missing');
    if (completion.pendingWork !== 0) reasons.add('work-remaining');
    for (const check of completion.requiredChecks) {
      const evidence = completion.evidence.filter((e) => e.check === check);
      if (evidence.length !== 1) reasons.add('completion-evidence-missing');
      else {
        const observed = evidence[0];
        if (!observed || observed.result !== 'passed') reasons.add('completion-evidence-failed');
        if (
          observed?.scopeId !== state.scopeId ||
          observed.revision !== state.revision ||
          observed.sourceHash !== state.sourceHash
        )
          reasons.add('completion-evidence-stale');
      }
    }
  }
  return { allowed: reasons.size === 0, reasons: [...reasons] };
}

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface ExecutionReceipt {
  allowed: boolean;
  reasons: GuardReason[];
  effect: 'none' | 'edit' | 'completion';
  writes: number;
  beforeStateHash: string;
  afterStateHash: string;
}

// An executable, isolated object-store boundary, not a desktop/file-system adapter.
// Validation and commit are synchronous: no async gap permits stale authorization reuse.
export function createGuardedWorkspace(initial: TrustedState) {
  if (
    !Number.isInteger(initial.revision) ||
    initial.revision < 0 ||
    !/^[a-f0-9]{64}$/.test(initial.sourceHash) ||
    !initial.scopeId ||
    new Set(initial.objects.map((o) => o.id)).size !== initial.objects.length ||
    !Number.isInteger(initial.completion.pendingWork) ||
    initial.completion.pendingWork < 0 ||
    new Set(initial.completion.requiredChecks).size !== initial.completion.requiredChecks.length ||
    (initial.authorization &&
      new Set(initial.authorization.writable.map((o) => o.id)).size !==
        initial.authorization.writable.length)
  )
    throw new Error('Invalid trusted state');
  let state = structuredClone(initial);
  let completed = false;
  return {
    snapshot: () => structuredClone({ state, completed }),
    execute(input: unknown): ExecutionReceipt {
      const beforeStateHash = digest({ state, completed });
      const verdict = checkDecision(state, input);
      let effect: ExecutionReceipt['effect'] = 'none';
      let writes = 0;
      if (verdict.allowed && validDecision(input)) {
        if (input.action === 'edit') {
          const targets = new Set(input.targetIds);
          const objects = state.objects.map((object) =>
            targets.has(object.id)
              ? {
                  ...object,
                  fields: {
                    ...object.fields,
                    ...Object.fromEntries(input.changes.map((c) => [c.field, c.value])),
                  },
                }
              : object,
          );
          state = {
            ...state,
            objects,
            revision: state.revision + 1,
            sourceHash: digest(objects),
            completion: {
              ...state.completion,
              pendingWork: Math.max(1, state.completion.pendingWork),
            },
          };
          completed = false;
          effect = 'edit';
          writes = input.targetIds.length * input.changes.length;
        } else if (input.action === 'done') {
          completed = true;
          effect = 'completion';
        }
      }
      return {
        ...verdict,
        effect,
        writes,
        beforeStateHash,
        afterStateHash: digest({ state, completed }),
      };
    },
  };
}
