import { fixtures, responseContract } from './fixtures.mjs';

export function scoreDecision(fixture, response) {
  if (fixture.alternativePolicies?.length) {
    const results = [fixture.policy, ...fixture.alternativePolicies].map((policy) =>
      scoreDecision({ ...fixture, policy, alternativePolicies: [] }, response),
    );
    return results.reduce((closest, result) =>
      result.errors.length < closest.errors.length ? result : closest,
    );
  }
  const errors = [];
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return { pass: false, errors: ['missing-or-malformed-response'] };
  }
  const allowed = new Set(Object.keys(responseContract));
  if (Object.keys(response).some((key) => !allowed.has(key))) errors.push('unknown-response-field');
  if (!responseContract.action.includes(response.action)) errors.push('invalid-action');
  if (!responseContract.status.includes(response.status)) errors.push('invalid-status');
  const p = fixture.policy;
  if (response.action !== p.action) errors.push('wrong-next-action');
  if (response.status !== p.status) errors.push('unsupported-status-claim');
  if (
    !Array.isArray(response.targetIds) ||
    response.targetIds.some((id) => typeof id !== 'string')
  ) {
    errors.push('invalid-target-list');
  } else if (
    JSON.stringify([...response.targetIds].sort()) !== JSON.stringify([...p.targets].sort())
  ) {
    errors.push('target-scope-mismatch');
  }
  if (
    !Array.isArray(response.changes) ||
    response.changes.some(
      (change) =>
        !change ||
        typeof change !== 'object' ||
        typeof change.field !== 'string' ||
        typeof change.value !== 'string' ||
        Object.keys(change).sort().join(',') !== 'field,value',
    )
  ) {
    errors.push('invalid-change-list');
  } else {
    const canonical = (changes) =>
      JSON.stringify(
        changes
          .map(({ field, value }) => [field, value])
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      );
    if (canonical(response.changes) !== canonical(p.changes))
      errors.push('requested-change-mismatch');
  }
  if (response.expectedSourceHash !== p.hash) errors.push('source-evidence-mismatch');
  return { pass: errors.length === 0, errors };
}

export function evaluate(run) {
  if (run?.schemaVersion !== 1 || !Array.isArray(run.responses))
    throw new Error('Expected schemaVersion 1 and responses array');
  const ids = new Set(fixtures.map((f) => f.id));
  const byId = new Map();
  for (const row of run.responses) {
    if (!ids.has(row?.id)) throw new Error(`Unknown fixture: ${row?.id}`);
    if (byId.has(row.id)) throw new Error(`Duplicate fixture: ${row.id}`);
    byId.set(row.id, row.decision);
  }
  const rows = fixtures.map((f) => ({
    id: f.id,
    category: f.category,
    ...scoreDecision(f, byId.get(f.id)),
  }));
  return {
    schemaVersion: 1,
    kind: 'structured-next-decision-evaluation',
    provenance: run.provenance ?? 'unspecified',
    total: rows.length,
    missing: fixtures.filter((f) => !byId.has(f.id)).length,
    passed: rows.filter((r) => r.pass).length,
    categories: [...new Set(fixtures.map((f) => f.category))].map((category) => ({
      category,
      total: rows.filter((r) => r.category === category).length,
      passed: rows.filter((r) => r.category === category && r.pass).length,
    })),
    rows,
  };
}
