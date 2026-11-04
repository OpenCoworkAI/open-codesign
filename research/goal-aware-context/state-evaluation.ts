import { z } from 'zod';
import { hashJson } from './corpus.js';

const text = z.string().min(1);
const revision = text.nullable();
const kind = z.enum(['intent', 'artifact-fact', 'verification', 'obligation']);
export const stateEventSchema = z.strictObject({
  id: text,
  seq: z.number().int().nonnegative(),
  authority: z.enum(['user', 'tool']),
  designId: text,
  revision,
  text,
});
const scopeSchema = z.strictObject({
  workspaceId: text,
  designId: text.nullable(),
  file: text.nullable(),
  objectId: text.nullable(),
  field: text.nullable(),
  revision,
});
const sourceSchema = z.strictObject({
  eventId: text,
  seq: z.number().int().nonnegative(),
  authority: text,
  revision,
});
const invalidationSchema = z.strictObject({
  status: z.enum(['active', 'stale', 'unresolved']),
  rules: z.array(
    z.enum([
      'explicit-user-change',
      'new-observation',
      'revision-change',
      'scope-change',
      'until-completed',
    ]),
  ),
});
const claimSchema = z.strictObject({
  key: text,
  kind,
  value: text,
  scope: scopeSchema,
  sources: z.array(sourceSchema),
  invalidation: invalidationSchema,
});
export const stateAnswerSchema = z.strictObject({ states: z.array(claimSchema) });
export const stateReferenceSchema = z.strictObject({
  cutoff: z.number().int().nonnegative(),
  events: z.array(stateEventSchema),
  claims: z
    .array(
      claimSchema.omit({ value: true }).extend({
        acceptedValues: z.array(text).min(1),
        acceptedSourceSets: z.array(z.array(sourceSchema).min(1)).default([]),
      }),
    )
    .min(1),
});
export type StateEvent = z.infer<typeof stateEventSchema>;
export type StateReference = z.infer<typeof stateReferenceSchema>;
export type StateClaim = z.infer<typeof claimSchema>;

export function validateStateReference(value: unknown): StateReference {
  const reference = stateReferenceSchema.parse(value);
  if (new Set(reference.claims.map((c) => c.key)).size !== reference.claims.length)
    throw new Error('Duplicate reference state key');
  let previous = -1;
  const events = new Map<string, StateEvent>();
  for (const event of reference.events) {
    if (event.seq <= previous || event.seq > reference.cutoff || events.has(event.id))
      throw new Error('Invalid evidence order/cutoff');
    previous = event.seq;
    events.set(event.id, event);
  }
  if (previous !== reference.cutoff) throw new Error('Evidence must reach cutoff');
  for (const claim of reference.claims) {
    const seenSets = new Set<string>();
    for (const set of [claim.sources, ...claim.acceptedSourceSets]) {
      if (set.length === 0 || new Set(set.map((s) => s.eventId)).size !== set.length)
        throw new Error('Reference evidence missing/duplicate');
      if (
        !claim.sources.every((required) =>
          set.some((source) => hashJson(source) === hashJson(required)),
        )
      )
        throw new Error('Reference alternative must contain mandatory evidence');
      for (const source of set) {
        const event = events.get(source.eventId);
        if (
          !event ||
          event.seq !== source.seq ||
          event.authority !== source.authority ||
          event.revision !== source.revision
        )
          throw new Error('Reference evidence not supported by prefix');
      }
      const fingerprint = sourceSet(set);
      if (seenSets.has(fingerprint)) throw new Error('Duplicate reference evidence combination');
      seenSets.add(fingerprint);
    }
    if (new Set(claim.invalidation.rules).size !== claim.invalidation.rules.length)
      throw new Error('Duplicate invalidation rule');
  }
  return reference;
}
const normalized = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
const sourceSet = (sources: StateClaim['sources']) =>
  hashJson([...sources].sort((a, b) => a.eventId.localeCompare(b.eventId)));
const invalidationKey = (value: StateClaim['invalidation']) =>
  hashJson({ status: value.status, rules: [...value.rules].sort() });

export function scoreTraceState(
  referenceValue: unknown,
  row: { status: string; value: unknown } | null,
) {
  const reference = validateStateReference(referenceValue);
  const parsed = stateAnswerSchema.safeParse(row?.value);
  const states = parsed.success ? parsed.data.states : [];
  const runtimeValid = row?.status === 'ok';
  const keys = new Set(reference.claims.map((c) => c.key));
  const formatValid =
    runtimeValid &&
    parsed.success &&
    new Set(states.map((c) => c.key)).size === states.length &&
    states.every((c) => keys.has(c.key));
  const claims = reference.claims.map((expected) => {
    const actual = formatValid ? states.find((c) => c.key === expected.key) : undefined;
    const value =
      actual !== undefined &&
      actual.kind === expected.kind &&
      expected.acceptedValues.some((v) => normalized(v) === normalized(actual.value));
    const scope = actual !== undefined && hashJson(actual.scope) === hashJson(expected.scope);
    const provenance =
      actual !== undefined &&
      new Set(actual.sources.map((s) => s.eventId)).size === actual.sources.length &&
      [expected.sources, ...expected.acceptedSourceSets].some(
        (set) => sourceSet(actual.sources) === sourceSet(set),
      );
    const invalidation =
      actual !== undefined &&
      new Set(actual.invalidation.rules).size === actual.invalidation.rules.length &&
      invalidationKey(actual.invalidation) === invalidationKey(expected.invalidation);
    return {
      key: expected.key,
      present: actual !== undefined,
      value,
      scope,
      provenance,
      invalidation,
      allCorrect: value && scope && provenance && invalidation,
    };
  });
  return {
    runtimeStatus: row?.status ?? 'not-run',
    runtimeValid,
    formatValid,
    total: claims.length,
    valueCorrect: claims.filter((c) => c.value).length,
    scopeCorrect: claims.filter((c) => c.scope).length,
    provenanceCorrect: claims.filter((c) => c.provenance).length,
    invalidationCorrect: claims.filter((c) => c.invalidation).length,
    jointCorrect: claims.filter((c) => c.allCorrect).length,
    claims,
  };
}
