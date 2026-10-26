import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

type Check = 'desktop' | 'mobile';
export interface DocumentSpec {
  id: string;
  file: string;
  objectId: string;
  label: string;
  children: { id: string; label: string }[];
}
interface DocumentState {
  spec: DocumentSpec;
  revision: number;
  sourceHash: string;
  policyVersion: number;
  protectedIds: string[];
  requiredChecks: Check[];
  pendingWork: string[];
  evidence: Partial<Record<Check, 'passed' | 'failed'>>;
  completed: boolean;
}
const hash = (source: string) => createHash('sha256').update(source).digest('hex');
const checks: Check[] = ['desktop', 'mobile'];
const unique = (values: string[]) => new Set(values).size === values.length;
export interface HostDecision {
  action: 'inspect' | 'done' | 'report-blocked';
  objectId: string;
  checks: Check[];
  color: string;
  font: string;
}
export const hostDecisionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'objectId', 'checks', 'color', 'font'],
  properties: {
    action: { type: 'string', enum: ['inspect', 'done', 'report-blocked'] },
    objectId: { type: 'string' },
    checks: { type: 'array', items: { type: 'string', enum: checks } },
    color: { type: 'string' },
    font: { type: 'string' },
  },
};
export function validHostDecision(value: unknown): value is HostDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).length === 5 &&
    typeof v['action'] === 'string' &&
    ['inspect', 'done', 'report-blocked'].includes(v['action']) &&
    ['objectId', 'color', 'font'].every((key) => typeof v[key] === 'string') &&
    Array.isArray(v['checks']) &&
    v['checks'].every((item) => checks.includes(item as Check)) &&
    unique(v['checks'] as string[])
  );
}

/** Host-only research API. The model receives snapshots and decide(), never policy/result setters. */
export function createHostContext(root: string, documents: DocumentSpec[]) {
  if (
    !documents.length ||
    !unique(documents.map((d) => d.id)) ||
    !unique(documents.map((d) => d.file))
  )
    throw new Error('Duplicate or empty documents');
  const objectIds = documents.flatMap((d) => [d.objectId, ...d.children.map((c) => c.id)]);
  if (!unique(objectIds) || objectIds.some((id) => !id))
    throw new Error('Invalid object identities');
  if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory())
    throw new Error('Invalid host root');
  const canonicalRoot = realpathSync(root);
  const source = (spec: DocumentSpec) => {
    if (!/^[A-Za-z0-9_-]+\.jsx$/.test(spec.file)) throw new Error('Invalid host file');
    const file = path.join(canonicalRoot, spec.file);
    if (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile())
      throw new Error('Invalid host file');
    return readFileSync(file, 'utf8');
  };
  const states = new Map(
    documents.map((spec) => [
      spec.id,
      {
        spec: structuredClone(spec),
        revision: 1,
        sourceHash: hash(source(spec)),
        policyVersion: 0,
        protectedIds: [],
        requiredChecks: [],
        pendingWork: [],
        evidence: {},
        completed: false,
      } satisfies DocumentState as DocumentState,
    ]),
  );
  const [first] = documents;
  if (!first) throw new Error('Duplicate or empty documents');
  let active = first.id;
  let activation = 0;
  const frames = new Map<string, string>();
  const requests = new Map<string, { documentId: string; fingerprint: string; check: Check }>();
  const newestChecks = new Map<string, string>();
  const get = (id: string) => {
    const state = states.get(id);
    if (!state) throw new Error('Unknown host document');
    return state;
  };
  const sync = (state: DocumentState) => {
    const observed = hash(source(state.spec));
    if (observed !== state.sourceHash) {
      state.sourceHash = observed;
      state.revision++;
      state.evidence = {};
      state.completed = false;
    }
  };
  const fingerprint = (state: DocumentState) =>
    JSON.stringify([state.spec.id, state.revision, state.sourceHash, state.policyVersion]);
  const frameFingerprint = () => {
    const state = get(active);
    sync(state);
    return JSON.stringify([activation, fingerprint(state)]);
  };
  const snapshot = () => {
    const state = get(active);
    sync(state);
    return structuredClone({
      activeDesign: active,
      object: {
        id: state.spec.objectId,
        label: state.spec.label,
        file: state.spec.file,
        revision: state.revision,
        sourceHash: state.sourceHash,
      },
      policyVersion: state.policyVersion,
      protectedObjects: state.spec.children.filter((c) => state.protectedIds.includes(c.id)),
      pendingWork: state.pendingWork,
      verification: state.requiredChecks.map((check) => ({
        check,
        result: state.evidence[check] ?? 'missing',
        revision: state.revision,
        sourceHash: state.sourceHash,
      })),
      completed: state.completed,
    });
  };
  return {
    catalog: () => structuredClone([...states.values()].map((state) => state.spec)),
    activate(id: string) {
      get(id);
      if (id !== active) {
        active = id;
        activation++;
      }
      return snapshot();
    },
    // These arguments are host-confirmed selections/work items, not parsed from model output.
    setPolicy(
      id: string,
      policy: { protectedIds: string[]; requiredChecks: Check[]; pendingWork: string[] },
    ) {
      const state = get(id);
      sync(state);
      if (
        !unique(policy.protectedIds) ||
        policy.protectedIds.some((p) => !state.spec.children.some((c) => c.id === p)) ||
        !policy.requiredChecks.length ||
        !unique(policy.requiredChecks) ||
        policy.requiredChecks.some((c) => !checks.includes(c))
      )
        throw new Error('Invalid host policy');
      state.protectedIds = [...policy.protectedIds];
      state.requiredChecks = [...policy.requiredChecks];
      state.pendingWork = [...policy.pendingWork];
      state.policyVersion++;
      state.evidence = {};
      state.completed = false;
    },
    setPendingWork(id: string, pending: string[]) {
      const state = get(id);
      sync(state);
      state.pendingWork = [...pending];
      state.policyVersion++;
      state.completed = false;
      // Verification stays about the same artifact. In-flight callbacks bind to the old policy and expire.
    },
    beginCheck(id: string, check: Check) {
      const state = get(id);
      sync(state);
      if (!state.requiredChecks.includes(check)) throw new Error('Check outside host policy');
      const ticket = randomUUID();
      delete state.evidence[check];
      state.completed = false;
      requests.set(ticket, { documentId: id, check, fingerprint: fingerprint(state) });
      newestChecks.set(`${id}:${check}`, ticket);
      return ticket;
    },
    finishCheck(ticket: string, result: 'passed' | 'failed') {
      if (!['passed', 'failed'].includes(result))
        return { accepted: false, reason: 'invalid-result' };
      const request = requests.get(ticket);
      requests.delete(ticket);
      if (!request) return { accepted: false, reason: 'unknown-or-consumed-ticket' };
      const state = get(request.documentId);
      sync(state);
      if (fingerprint(state) !== request.fingerprint)
        return { accepted: false, reason: 'stale-result' };
      if (newestChecks.get(`${request.documentId}:${request.check}`) !== ticket)
        return { accepted: false, reason: 'superseded-check' };
      state.evidence[request.check] = result;
      state.completed = false;
      return { accepted: true, reason: null };
    },
    snapshot,
    frame() {
      const id = randomUUID();
      frames.set(id, frameFingerprint());
      return { id, facts: snapshot() };
    },
    decide(frameId: string, proposal: unknown) {
      const reject = (reason: string) => ({
        allowed: false as const,
        reason,
        effect: 'none' as const,
      });
      if (!validHostDecision(proposal)) return reject('invalid-decision');
      const expected = frames.get(frameId);
      frames.delete(frameId);
      if (!expected || expected !== frameFingerprint()) return reject('stale-or-consumed-frame');
      const state = get(active);
      if (proposal.objectId !== state.spec.objectId) return reject('outside-active-object');
      if (!state.requiredChecks.length) return reject('missing-host-policy');
      if (proposal.action !== 'inspect' && proposal.checks.length)
        return reject('non-inspect-checks');
      if (
        proposal.action === 'inspect' &&
        (!proposal.checks.length || proposal.checks.some((c) => !state.requiredChecks.includes(c)))
      )
        return reject('invalid-check-request');
      if (
        proposal.action === 'done' &&
        (state.pendingWork.length ||
          state.requiredChecks.some((c) => state.evidence[c] !== 'passed'))
      )
        return reject('completion-evidence-incomplete');
      const bound = { ...snapshot().object, protectedObjectIds: [...state.protectedIds] };
      if (proposal.action === 'done') state.completed = true;
      return {
        allowed: true as const,
        reason: null,
        effect:
          proposal.action === 'done'
            ? ('completion' as const)
            : proposal.action === 'inspect'
              ? ('inspection-request' as const)
              : ('blocked-report' as const),
        bound,
        checks: [...proposal.checks],
      };
    },
  };
}
