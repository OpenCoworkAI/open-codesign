import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHostContext, type HostDecision } from './host-context';

const documents = [
  {
    id: 'signup',
    file: 'Signup.jsx',
    objectId: 'signup/page',
    label: '注册页',
    children: [{ id: 'signup/privacy', label: '隐私提示' }],
  },
  {
    id: 'landing',
    file: 'Landing.jsx',
    objectId: 'landing/page',
    label: '营销页',
    children: [{ id: 'landing/header', label: '标题' }],
  },
];
function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'codesign-host-context-'));
  for (const doc of documents)
    writeFileSync(path.join(root, doc.file), 'function App(){return <main>v1</main>}');
  const host = createHostContext(root, documents);
  for (const doc of documents)
    host.setPolicy(doc.id, {
      protectedIds: [doc.children[0].id],
      requiredChecks: ['desktop', 'mobile'],
      pendingWork: [],
    });
  const pass = (id = 'signup') => {
    for (const check of ['desktop', 'mobile'] as const)
      expect(host.finishCheck(host.beginCheck(id, check), 'passed').accepted).toBe(true);
  };
  return { root, host, pass };
}
const decision: HostDecision = {
  action: 'done',
  objectId: 'signup/page',
  checks: [],
  color: '#123456',
  font: 'Inter',
};
describe('host-owned file identity and verification', () => {
  it('invalidates a previous pass as soon as a new check begins', () => {
    const { host, pass } = setup();
    pass();
    host.decide(host.frame().id, decision);
    host.beginCheck('signup', 'mobile');
    expect(host.snapshot().completed).toBe(false);
    expect(host.snapshot().verification[1].result).toBe('missing');
    expect(host.decide(host.frame().id, decision).reason).toBe('completion-evidence-incomplete');
  });
  it('binds real source hash and canonical IDs without model-supplied metadata', () => {
    const { host, pass } = setup();
    pass();
    const frame = host.frame();
    const result = host.decide(frame.id, decision);
    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error('Unexpected rejection');
    expect(result.bound.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.bound.protectedObjectIds).toEqual(['signup/privacy']);
    expect(host.snapshot().completed).toBe(true);
  });
  it('invalidates completion and both checks on an observed external edit', () => {
    const { root, host, pass } = setup();
    pass();
    host.decide(host.frame().id, decision);
    writeFileSync(path.join(root, 'Signup.jsx'), 'function App(){return <main>v2</main>}');
    expect(host.snapshot().object.revision).toBe(2);
    expect(host.snapshot().completed).toBe(false);
    expect(host.snapshot().verification.every((e) => e.result === 'missing')).toBe(true);
    expect(host.decide(host.frame().id, decision).reason).toBe('completion-evidence-incomplete');
  });
  it('rejects a decision from an old frame instead of silently rebinding it', () => {
    const { root, host, pass } = setup();
    pass();
    const frame = host.frame();
    writeFileSync(path.join(root, 'Signup.jsx'), 'changed');
    expect(host.decide(frame.id, decision).reason).toBe('stale-or-consumed-frame');
  });
  it('rejects a delayed callback from an old source revision', () => {
    const { root, host } = setup();
    const ticket = host.beginCheck('signup', 'mobile');
    writeFileSync(path.join(root, 'Signup.jsx'), 'changed');
    expect(host.finishCheck(ticket, 'passed').reason).toBe('stale-result');
    expect(host.snapshot().verification[1].result).toBe('missing');
  });
  it('does not let an older success overwrite a newer failure on the same revision', () => {
    const { host } = setup();
    const old = host.beginCheck('signup', 'mobile');
    const latest = host.beginCheck('signup', 'mobile');
    expect(host.finishCheck(latest, 'failed').accepted).toBe(true);
    expect(host.finishCheck(old, 'passed').reason).toBe('superseded-check');
    expect(host.snapshot().verification[1].result).toBe('failed');
  });
  it('does not reuse results after observed A to B to A file transitions', () => {
    const { root, host } = setup();
    const old = host.beginCheck('signup', 'mobile');
    writeFileSync(path.join(root, 'Signup.jsx'), 'B');
    host.snapshot();
    writeFileSync(path.join(root, 'Signup.jsx'), 'function App(){return <main>v1</main>}');
    expect(host.snapshot().object.revision).toBe(3);
    expect(host.finishCheck(old, 'passed').reason).toBe('stale-result');
  });
  it('rejects old frames after switching away and back', () => {
    const { host, pass } = setup();
    pass();
    const frame = host.frame();
    host.activate('landing');
    host.activate('signup');
    expect(host.decide(frame.id, decision).reason).toBe('stale-or-consumed-frame');
  });
  it('routes background results to their original design', () => {
    const { host } = setup();
    const ticket = host.beginCheck('landing', 'mobile');
    expect(host.finishCheck(ticket, 'passed').accepted).toBe(true);
    expect(host.snapshot().verification[1].result).toBe('missing');
    expect(host.decide(host.frame().id, { ...decision, objectId: 'landing/page' }).reason).toBe(
      'outside-active-object',
    );
  });
  it('invalidates verification after protection/requirement policy changes', () => {
    const { host, pass } = setup();
    pass();
    const old = host.beginCheck('signup', 'mobile');
    host.setPolicy('signup', {
      protectedIds: [],
      requiredChecks: ['desktop', 'mobile'],
      pendingWork: [],
    });
    expect(host.finishCheck(old, 'passed').reason).toBe('stale-result');
    expect(host.decide(host.frame().id, decision).allowed).toBe(false);
  });
  it('blocks completion with pending work despite all checks passing', () => {
    const { host, pass } = setup();
    pass();
    host.setPendingWork('signup', ['export']);
    expect(host.decide(host.frame().id, decision).reason).toBe('completion-evidence-incomplete');
    expect(host.decide(host.frame().id, { ...decision, action: 'report-blocked' }).allowed).toBe(
      true,
    );
  });
  it.each([
    { sourceHash: 'fake' },
    { verified: true },
    { protectedIds: [] },
  ])('refuses model-supplied authoritative data %j', (extra) => {
    const { host } = setup();
    expect(host.decide(host.frame().id, { ...decision, ...extra }).reason).toBe('invalid-decision');
  });
  it('allows unnecessary inspection but does not certify its usefulness or preferences', () => {
    const { host, pass } = setup();
    pass();
    expect(
      host.decide(host.frame().id, {
        ...decision,
        action: 'inspect',
        checks: ['desktop'],
        color: 'wrong',
      }).allowed,
    ).toBe(true);
  });
  it('prevents replay and mutation through returned snapshots', () => {
    const { host, pass } = setup();
    pass();
    const frame = host.frame();
    frame.facts.protectedObjects.length = 0;
    const result = host.decide(frame.id, decision);
    if (!result.allowed) throw new Error('Unexpected rejection');
    expect(result.bound.protectedObjectIds).toEqual(['signup/privacy']);
    expect(host.decide(frame.id, decision).allowed).toBe(false);
    expect(host.finishCheck('forged', 'passed').accepted).toBe(false);
  });
  it('rejects identity collisions and escaping host paths', () => {
    const { root, host } = setup();
    expect(() => createHostContext(root, [...documents, documents[0]])).toThrow();
    expect(() => createHostContext(root, [{ ...documents[0], file: '../Signup.jsx' }])).toThrow();
    expect(() =>
      host.setPolicy('signup', {
        protectedIds: ['landing/header'],
        requiredChecks: ['desktop'],
        pendingWork: [],
      }),
    ).toThrow();
  });
});
