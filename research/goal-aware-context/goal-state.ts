/**
 * Evidence-aware goal-state reduction for goal-aware context research.
 *
 * A caller supplies candidate state records (for example drafted from a
 * checkpoint prefix) plus the bounded evidence window they must be sourced
 * from. This module validates the records strictly, checks that each record's
 * authority actually exists in the supplied prefix of the conversation, and
 * reduces the lifecycle (replacement / revocation / unresolved) deterministically.
 *
 * Design rules:
 * - No semantic inference from free text. Authority, category and lifecycle are
 *   read from explicit record fields and the referenced evidence rows only.
 * - A file fact or a passing preview is never reinterpreted as user intent.
 * - Foreign-design records are excluded before their evidence is checked, so a
 *   record from another design cannot force evidence from this design's prefix.
 * - Output is fully detached from caller-owned input; nothing is mutated.
 */
import type { ChatMessageRow } from '@open-codesign/shared';
import { z } from 'zod';

const nonBlank = (label: string) =>
  z
    .string()
    .min(1, `${label} must not be empty`)
    .refine((value) => value.trim().length > 0, `${label} must not be blank`)
    .refine((value) => value.trim() === value, `${label} must not have outer whitespace`);

const recordSchema = z
  .strictObject({
    id: nonBlank('id'),
    designId: nonBlank('designId'),
    kind: z.enum(['intent', 'artifact-fact', 'verification']),
    category: z.enum([
      'goal',
      'constraint',
      'decision',
      'scope',
      'open-task',
      'observation',
      'verification',
    ]),
    slot: nonBlank('slot'),
    text: nonBlank('text'),
    evidenceRefs: z
      .array(nonBlank('evidenceRef'))
      .min(1)
      .refine(isUnique, 'evidenceRefs must be unique'),
    sourceSeq: z.number().int().nonnegative(),
    sourceRevision: nonBlank('sourceRevision').nullable(),
    status: z.enum(['active', 'superseded', 'revoked', 'unresolved']),
    replaces: z.array(nonBlank('replaces')).refine(isUnique, 'replaces must be unique'),
  })
  .refine(
    (value) => new Set(value.evidenceRefs).size === value.evidenceRefs.length,
    'evidenceRefs must be unique',
  )
  .refine(
    (value) => new Set(value.replaces).size === value.replaces.length,
    'replaces must be unique',
  );

export type ConstraintRecord = z.infer<typeof recordSchema>;

export interface EvidenceContext {
  readonly chatRows: readonly ChatMessageRow[];
  readonly cutoffSeq: number;
}

export interface GoalStateExclusion {
  readonly id: string;
  readonly reason: string;
}

export interface GoalState {
  readonly records: ConstraintRecord[];
  readonly excluded: GoalStateExclusion[];
}

const CHAT_REF = /^chat:(0|[1-9][0-9]*)$/;

function isUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function fail(message: string): never {
  throw new Error(`goal-state: ${message}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compareBySeqThenId(
  a: { readonly sourceSeq: number; readonly id: string },
  b: { readonly sourceSeq: number; readonly id: string },
): number {
  if (a.sourceSeq !== b.sourceSeq) return a.sourceSeq - b.sourceSeq;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function cloneRecord(record: ConstraintRecord): ConstraintRecord {
  return {
    id: record.id,
    designId: record.designId,
    kind: record.kind,
    category: record.category,
    slot: record.slot,
    text: record.text,
    evidenceRefs: [...record.evidenceRefs],
    sourceSeq: record.sourceSeq,
    sourceRevision: record.sourceRevision,
    status: record.status,
    replaces: [...record.replaces],
  };
}

/**
 * Validate that the evidence window is a well-formed, ascending, unique prefix
 * of one design's conversation ending exactly at `cutoffSeq`.
 */
export function validateEvidenceContext(designId: string, context: EvidenceContext): void {
  const { chatRows, cutoffSeq } = context;
  if (typeof designId !== 'string' || designId.trim().length === 0) {
    fail('designId must be a non-blank string');
  }
  if (!Number.isFinite(cutoffSeq) || !Number.isInteger(cutoffSeq) || cutoffSeq < 0) {
    fail('cutoffSeq must be a finite non-negative integer');
  }
  if (!Array.isArray(chatRows)) fail('chatRows must be an array');

  const seenSeq = new Set<number>();
  const seenId = new Set<number>();
  let previousSeq = -1;
  for (const [index, row] of chatRows.entries()) {
    if (!isPlainObject(row)) fail(`chatRows[${index}] must be an object`);
    if (row['designId'] !== designId) {
      fail(`chatRows[${index}] belongs to design ${String(row['designId'])}, not ${designId}`);
    }
    const seq = row['seq'];
    const id = row['id'];
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
      fail(`chatRows[${index}] has an invalid seq`);
    }
    if (typeof id !== 'number' || !Number.isInteger(id)) {
      fail(`chatRows[${index}] has an invalid id`);
    }
    if (seenSeq.has(seq)) fail(`duplicate row seq ${seq}`);
    if (seenId.has(id)) fail(`duplicate row id ${id}`);
    if (seq <= previousSeq) fail('chatRows must be ordered by increasing seq');
    if (seq > cutoffSeq) fail(`row seq ${seq} is beyond cutoff ${cutoffSeq}`);
    seenSeq.add(seq);
    seenId.add(id);
    previousSeq = seq;
  }
  // The window must actually reach the cutoff: rows after it may not exist and
  // an incomplete prefix would silently drop later supporting evidence.
  if (chatRows.length > 0 && previousSeq !== cutoffSeq) {
    fail(`evidence window ends at seq ${previousSeq}, not cutoffSeq ${cutoffSeq}`);
  }
}

function parseRows(context: EvidenceContext): Map<number, ChatMessageRow> {
  const bySeq = new Map<number, ChatMessageRow>();
  for (const row of context.chatRows) bySeq.set(row.seq, row);
  return bySeq;
}

/** Collect and range-check the chat:seq refs of a record. */
function resolveRefSeqs(record: ConstraintRecord): number[] {
  const seqs: number[] = [];
  for (const ref of record.evidenceRefs) {
    const match = CHAT_REF.exec(ref);
    if (!match?.[1]) fail(`record ${record.id} has out-of-scope evidence ref ${ref}`);
    const seq = Number(match[1]);
    if (!Number.isInteger(seq)) fail(`record ${record.id} has out-of-scope evidence ref ${ref}`);
    if (seq > record.sourceSeq) {
      fail(`record ${record.id} references future evidence ${ref}`);
    }
    seqs.push(seq);
  }
  const max = Math.max(...seqs);
  if (max !== record.sourceSeq) {
    fail(`record ${record.id} sourceSeq ${record.sourceSeq} is not its latest evidence ${max}`);
  }
  return seqs;
}

function requireRow(
  rows: Map<number, ChatMessageRow>,
  designId: string,
  record: ConstraintRecord,
  seq: number,
  label: string,
): ChatMessageRow {
  const row = rows.get(seq);
  if (!row) fail(`record ${record.id} is missing evidence row ${label} chat:${seq}`);
  if (row.designId !== designId)
    fail(`record ${record.id} evidence ${label} belongs to another design`);
  return row;
}

function toolFact(
  row: ChatMessageRow,
  toolName: string,
): { status: unknown; result: Record<string, unknown> } | null {
  if (row.kind !== 'tool_call' || !isPlainObject(row.payload)) return null;
  const payload = row.payload;
  if (payload['toolName'] !== toolName) return null;
  const result = payload['result'];
  if (!isPlainObject(result)) return null;
  return { status: payload['status'], result };
}

function assertAuthority(
  record: ConstraintRecord,
  rows: Map<number, ChatMessageRow>,
  designId: string,
): void {
  const seqs = resolveRefSeqs(record);
  for (const seq of seqs) requireRow(rows, designId, record, seq, 'supporting');
  const sourceRow = requireRow(rows, designId, record, record.sourceSeq, 'source');
  if (record.kind === 'intent') {
    if (sourceRow.kind !== 'user')
      fail(`intent ${record.id} is not sourced from a direct user row`);
    if (record.sourceRevision !== null)
      fail(`intent ${record.id} must not claim a source revision`);
    if (record.category === 'observation' || record.category === 'verification') {
      fail(`intent ${record.id} cannot carry category ${record.category}`);
    }
    return;
  }
  if (record.sourceRevision === null) {
    fail(`${record.kind} ${record.id} must claim a non-null source revision`);
  }
  if (record.kind === 'artifact-fact') {
    if (record.category !== 'observation') {
      fail(`artifact-fact ${record.id} must have category observation`);
    }
    const fact = toolFact(sourceRow, 'read');
    if (!fact || fact.status !== 'done') {
      fail(`artifact-fact ${record.id} is not sourced from a done read tool result`);
    }
    if (fact.result['revision'] !== record.sourceRevision) {
      fail(`artifact-fact ${record.id} revision does not match its read result`);
    }
  } else {
    if (record.category !== 'verification') {
      fail(`verification ${record.id} must have category verification`);
    }
    const fact = toolFact(sourceRow, 'preview');
    if (!fact || fact.status !== 'done') {
      fail(`verification ${record.id} is not sourced from a done preview tool result`);
    }
    if (fact.result['errorCount'] !== 0) {
      fail(`verification ${record.id} is not a clean preview result`);
    }
    if (fact.result['revision'] !== record.sourceRevision) {
      fail(`verification ${record.id} revision does not match its preview result`);
    }
  }
}

function sameSlot(a: ConstraintRecord, b: ConstraintRecord): boolean {
  return a.kind === b.kind && a.slot === b.slot && a.category === b.category;
}

function sortRecords(records: ConstraintRecord[]): ConstraintRecord[] {
  return [...records].sort(compareBySeqThenId);
}

function sortExcluded(
  excluded: readonly GoalStateExclusion[],
  sourceSeqById: ReadonlyMap<string, number>,
): GoalStateExclusion[] {
  return [...excluded].sort((a, b) =>
    compareBySeqThenId(
      { sourceSeq: sourceSeqById.get(a.id) ?? 0, id: a.id },
      { sourceSeq: sourceSeqById.get(b.id) ?? 0, id: b.id },
    ),
  );
}

/**
 * Reduce candidate records to the current goal state for `designId` at
 * `currentRevision`, using only evidence inside `evidence`.
 */
export function deriveGoalState(
  records: unknown,
  designId: string,
  currentRevision: string,
  evidence: EvidenceContext,
): GoalState {
  if (typeof designId !== 'string' || designId.trim().length === 0) {
    fail('designId must be a non-blank string');
  }
  if (typeof currentRevision !== 'string' || currentRevision.trim().length === 0) {
    fail('currentRevision must be a non-blank string');
  }
  validateEvidenceContext(designId, evidence);
  const rows = parseRows(evidence);

  // 1. Structural parse of everything before any other decision.
  const parsed: ConstraintRecord[] = [];
  const seenIds = new Set<string>();
  for (const [index, raw] of (Array.isArray(records)
    ? records
    : fail('records must be an array')
  ).entries()) {
    const result = recordSchema.safeParse(raw);
    if (!result.success) {
      fail(`records[${index}] is invalid: ${result.error.issues.map((i) => i.message).join('; ')}`);
    }
    const record = result.data;
    if (seenIds.has(record.id)) fail(`duplicate record id ${record.id}`);
    seenIds.add(record.id);
    parsed.push(record);
  }

  // 2. Foreign designs are excluded before any evidence requirement.
  const excluded: GoalStateExclusion[] = [];
  const inScope: ConstraintRecord[] = [];
  for (const record of parsed) {
    if (record.designId !== designId) excluded.push({ id: record.id, reason: 'foreign-design' });
    else inScope.push(record);
  }

  // 3. Authority checks and stale-revision exclusion.
  // A record from another design may cite its own (future, unseen) evidence;
  // scope is resolved before any of its evidence is inspected.
  const byId = new Map<string, ConstraintRecord>();
  for (const record of inScope) {
    if (record.sourceSeq > evidence.cutoffSeq) {
      fail(`record ${record.id} sourceSeq ${record.sourceSeq} is beyond the evidence cutoff`);
    }
    assertAuthority(record, rows, designId);
    byId.set(record.id, record);
  }
  const live: ConstraintRecord[] = [];
  for (const record of inScope) {
    if (record.kind !== 'intent' && record.sourceRevision !== currentRevision) {
      excluded.push({ id: record.id, reason: 'stale-revision' });
      continue;
    }
    live.push(record);
  }

  // 4. Lifecycle links: existing target, not self, same slot, strictly earlier.
  for (const record of live) {
    for (const target of record.replaces) {
      if (target === record.id) fail(`record ${record.id} cannot replace itself`);
      const targetRecord = byId.get(target);
      if (!targetRecord) fail(`record ${record.id} replaces unknown record ${target}`);
      if (targetRecord.kind !== record.kind || !sameSlot(targetRecord, record)) {
        fail(`record ${record.id} replaces ${target} across kind/slot/category`);
      }
      if (targetRecord.sourceSeq >= record.sourceSeq) {
        fail(`record ${record.id} replaces ${target} without being strictly later`);
      }
    }
    // Only active records may resolve others by superseding them; a revoked
    // record may instead carry revocation targets as a tombstone.
    if (record.status === 'superseded' && record.replaces.length > 0) {
      fail(`record ${record.id} is superseded and cannot own replacements`);
    }
  }

  // Apply lifecycle events once in source order; a later resolution must remain final.
  const ordered = sortRecords(live);
  const finalStatus = new Map<string, ConstraintRecord['status']>(
    ordered.map((record) => [record.id, record.status]),
  );
  const revokedTargets = new Set<string>();
  for (const record of ordered) {
    if (record.status === 'superseded') continue;
    const targetStatus = record.status === 'active' ? 'superseded' : record.status;
    for (const target of record.replaces) {
      finalStatus.set(target, targetStatus);
      if (targetStatus === 'revoked') revokedTargets.add(target);
    }
  }

  const survivingTombstone = (record: ConstraintRecord): boolean =>
    record.status === 'revoked' &&
    finalStatus.get(record.id) === 'revoked' &&
    !revokedTargets.has(record.id);
  const groups = new Map<string, ConstraintRecord[]>();
  for (const record of ordered) {
    const status = finalStatus.get(record.id);
    if (status !== 'active' && status !== 'unresolved' && !survivingTombstone(record)) continue;
    const key = JSON.stringify([record.kind, record.category, record.slot]);
    const group = groups.get(key);
    if (group) group.push(record);
    else groups.set(key, [record]);
  }
  // Without an explicit link, even an active choice next to a revocation is ambiguous.
  for (const group of groups.values()) {
    if (group.length > 1) for (const record of group) finalStatus.set(record.id, 'unresolved');
  }

  const outRecords: ConstraintRecord[] = [];
  for (const record of ordered) {
    const status = finalStatus.get(record.id) ?? record.status;
    if (status === 'active' || status === 'unresolved' || survivingTombstone(record)) {
      outRecords.push(cloneRecord({ ...record, status }));
    } else excluded.push({ id: record.id, reason: status });
  }

  const sourceSeqById = new Map<string, number>();
  for (const record of parsed) sourceSeqById.set(record.id, record.sourceSeq);

  return {
    records: sortRecords(outRecords),
    excluded: sortExcluded(excluded, sourceSeqById),
  };
}
