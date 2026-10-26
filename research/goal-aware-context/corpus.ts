import { createHash } from 'node:crypto';
import { ChatMessageRowV1, DesignRunPreferencesV1 } from '@open-codesign/shared';
import { z } from 'zod';
import type {
  BuildDesignContextPackInput,
  DesignSessionBriefV1,
} from '../../packages/core/src/design-context.js';

const id = z
  .string()
  .min(1)
  .refine((value) => value.trim() === value, 'IDs must not contain outer whitespace');
const seq = z.number().int().nonnegative();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const json = z.json();
const rowSchema = ChatMessageRowV1.strict().extend({ schemaVersion: z.literal(1), payload: json });
const briefSchema = z.strictObject({
  schemaVersion: z.literal(1),
  designId: id,
  designName: z.string(),
  updatedAt: id,
  goal: z.string(),
  artifactType: z.string(),
  audience: z.string(),
  visualDirection: z.string(),
  stableDecisions: z.array(z.string()),
  userPreferences: z.array(z.string()),
  dislikes: z.array(z.string()),
  openTasks: z.array(z.string()),
  currentFiles: z.array(z.string()),
  lastVerification: z.strictObject({
    status: z.enum(['none', 'ok', 'has_errors']),
    path: z.string().optional(),
    errorCount: seq.optional(),
    checkedAt: z.string().optional(),
  }),
  lastUserIntent: z.string(),
  sourceUserMemoryHash: z.string().optional(),
  sourceWorkspaceMemoryHash: z.string().optional(),
  sourceMemoryUpdatedAt: z.string().optional(),
});
const contextSchema = z.strictObject({
  brief: briefSchema.nullable().optional(),
  resourceState: z
    .strictObject({
      schemaVersion: z.literal(1),
      loadedSkills: z.array(z.string()),
      loadedBrandRefs: z.array(z.string()),
      scaffoldedFiles: z.array(z.strictObject({ kind: id, destPath: id, bytes: seq })),
      lastDone: z
        .strictObject({
          status: z.enum(['ok', 'has_errors']),
          path: id,
          mutationSeq: seq,
          errorCount: seq,
          checkedAt: id,
        })
        .nullable(),
      mutationSeq: seq,
    })
    .optional(),
  runPreferences: DesignRunPreferencesV1.nullable().optional(),
  workspaceState: z
    .strictObject({
      sourcePath: z.string().nullable().optional(),
      hasSource: z.boolean().optional(),
      hasDesignMd: z.boolean().optional(),
      hasAgentsMd: z.boolean().optional(),
      hasSettingsJson: z.boolean().optional(),
    })
    .optional(),
  historyBudgetChars: seq.optional(),
  modelContextWindow: z.number().int().positive().optional(),
});
const checkpointSchema = z.strictObject({
  id,
  cutoffSeq: seq,
  capturedThroughSeq: seq,
  workspaceRevision: id,
  context: contextSchema,
});
const sessionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sessionId: id,
  designId: id,
  relatedDesignIds: z.array(id),
  provenance: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('synthetic'), sourceSessionId: id, author: id }),
    z.strictObject({
      kind: z.literal('consented-redacted'),
      sourceSessionId: id,
      consentReference: id,
      redactionReview: id,
    }),
  ]),
  rows: z.array(rowSchema).min(1),
  checkpoints: z.array(checkpointSchema).min(1),
});
export type CorpusSession = z.infer<typeof sessionSchema>;
export type Split = 'development' | 'heldout';
const inputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  caseId: id,
  sessionId: id,
  designId: id,
  cutoffSeq: seq,
  workspaceRevision: id,
  contextInput: contextSchema.extend({ chatRows: z.array(rowSchema).min(1) }),
});
export type CorpusInput = z.infer<typeof inputSchema>;

export const COMPARISON_PROTOCOL = {
  id: 'goal-aware-context-corpus@2',
  conditions: [
    'full-context-reference',
    'production-raw',
    'production-budget-matched',
    'candidate-budget-matched',
  ],
  inputBudgetTokens: [2048, 4096, 8192],
  reservedOutputTokens: 1024,
  trialsPerModelCondition: 3,
  primaryMetrics: ['question-accuracy', 'all-questions-correct-per-checkpoint'],
  downstreamMetrics: ['constraint-violation-rate', 'all-requirements-completed-rate'],
  failureOutcomes: ['overflow', 'unavailable-count', 'model-error', 'invalid-output', 'fallback'],
  independentUnit: 'connected-session-design-family',
  freezeContextBeforeQuestions: true,
  compressorReceivesEvaluation: false,
  estimateAndActualResultsSeparated: true,
} as const;

/** Canonical JSON hashing: key order is irrelevant; omitted/invalid values are rejected. */
export function hashJson(value: unknown): string {
  function sort(node: z.infer<typeof json>): z.infer<typeof json> {
    if (Array.isArray(node)) return node.map(sort);
    if (node !== null && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, child]) => [key, sort(child)]),
      );
    }
    return node;
  }
  return createHash('sha256')
    .update(JSON.stringify(sort(json.parse(value))), 'utf8')
    .digest('hex');
}

function validateRows(rows: CorpusSession['rows'], designId: string, cutoff = Infinity): void {
  let previous = -1;
  const ids = new Set<number>();
  for (const row of rows) {
    if (row.designId !== designId || row.seq <= previous || row.seq > cutoff || ids.has(row.id)) {
      throw new Error(
        'Rows must have unique IDs, increasing seq, matching design and respect cutoff',
      );
    }
    previous = row.seq;
    ids.add(row.id);
  }
}

export function parseCorpus(value: unknown): CorpusSession[] {
  const sessions = z.array(sessionSchema).min(1).parse(value);
  const sessionsSeen = new Set<string>();
  const casesSeen = new Set<string>();
  for (const session of sessions) {
    if (sessionsSeen.has(session.sessionId)) throw new Error('Duplicate session ID');
    sessionsSeen.add(session.sessionId);
    validateRows(session.rows, session.designId);
    for (const checkpoint of session.checkpoints) {
      if (casesSeen.has(checkpoint.id)) throw new Error('Duplicate checkpoint ID');
      casesSeen.add(checkpoint.id);
      if (!session.rows.some((row) => row.seq === checkpoint.cutoffSeq))
        throw new Error('Unknown cutoff seq');
      if (checkpoint.capturedThroughSeq > checkpoint.cutoffSeq)
        throw new Error('Snapshot is after cutoff');
      if (checkpoint.context.brief && checkpoint.context.brief.designId !== session.designId) {
        throw new Error('Brief design must match session');
      }
    }
  }
  return sessions;
}

export function createCorpusInput(source: CorpusSession, checkpointId: string): CorpusInput {
  const [session] = parseCorpus([source]);
  if (!session) throw new Error('Missing session');
  const checkpoint = session.checkpoints.find((entry) => entry.id === checkpointId);
  if (!checkpoint) throw new Error('Unknown checkpoint');
  return inputSchema.parse({
    schemaVersion: 1,
    caseId: checkpoint.id,
    sessionId: session.sessionId,
    designId: session.designId,
    cutoffSeq: checkpoint.cutoffSeq,
    workspaceRevision: checkpoint.workspaceRevision,
    contextInput: {
      ...checkpoint.context,
      chatRows: session.rows.filter((row) => row.seq <= checkpoint.cutoffSeq),
    },
  });
}

function parseInput(value: unknown): CorpusInput {
  const input = inputSchema.parse(value);
  validateRows(input.contextInput.chatRows, input.designId, input.cutoffSeq);
  if (input.contextInput.brief && input.contextInput.brief.designId !== input.designId) {
    throw new Error('Brief design must match input');
  }
  return input;
}

/** Only this projected object is supplied to a compressor; never give it the corpus/evaluator. */
export function getCompressorInput(value: unknown): BuildDesignContextPackInput {
  const context = parseInput(value).contextInput;
  const result: BuildDesignContextPackInput = { chatRows: context.chatRows };
  if (context.brief !== undefined) {
    if (context.brief === null) result.brief = null;
    else {
      const {
        lastVerification,
        sourceUserMemoryHash,
        sourceWorkspaceMemoryHash,
        sourceMemoryUpdatedAt,
        ...fields
      } = context.brief;
      const verification: DesignSessionBriefV1['lastVerification'] = {
        status: lastVerification.status,
      };
      if (lastVerification.path !== undefined) verification.path = lastVerification.path;
      if (lastVerification.errorCount !== undefined)
        verification.errorCount = lastVerification.errorCount;
      if (lastVerification.checkedAt !== undefined)
        verification.checkedAt = lastVerification.checkedAt;
      const brief: DesignSessionBriefV1 = { ...fields, lastVerification: verification };
      if (sourceUserMemoryHash !== undefined) brief.sourceUserMemoryHash = sourceUserMemoryHash;
      if (sourceWorkspaceMemoryHash !== undefined)
        brief.sourceWorkspaceMemoryHash = sourceWorkspaceMemoryHash;
      if (sourceMemoryUpdatedAt !== undefined) brief.sourceMemoryUpdatedAt = sourceMemoryUpdatedAt;
      result.brief = brief;
    }
  }
  if (context.resourceState !== undefined) result.resourceState = context.resourceState;
  if (context.runPreferences !== undefined) result.runPreferences = context.runPreferences;
  if (context.workspaceState !== undefined) result.workspaceState = context.workspaceState;
  if (context.historyBudgetChars !== undefined)
    result.historyBudgetChars = context.historyBudgetChars;
  if (context.modelContextWindow !== undefined)
    result.modelContextWindow = context.modelContextWindow;
  return result;
}

const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  protocolId: z.literal(COMPARISON_PROTOCOL.id),
  protocolHash: hash,
  corpusHash: hash,
  evaluationHash: hash,
  cases: z
    .array(
      z.strictObject({ caseId: id, split: z.enum(['development', 'heldout']), inputHash: hash }),
    )
    .min(1),
});
export type CorpusManifest = z.infer<typeof manifestSchema>;

export function createManifest(
  source: readonly CorpusSession[],
  splits: Readonly<Record<string, Split>>,
  evaluation: unknown,
): CorpusManifest {
  const sessions = parseCorpus(source);
  if (Object.keys(splits).some((key) => !sessions.some((s) => s.sessionId === key)))
    throw new Error('Unknown split session');
  const manifest = {
    schemaVersion: 1,
    protocolId: COMPARISON_PROTOCOL.id,
    protocolHash: hashJson(COMPARISON_PROTOCOL),
    corpusHash: hashJson(sessions),
    evaluationHash: hashJson(evaluation),
    cases: sessions.flatMap((s) =>
      s.checkpoints.map((cp) => ({
        caseId: cp.id,
        split: splits[s.sessionId],
        inputHash: hashJson(createCorpusInput(s, cp.id)),
      })),
    ),
  };
  return validateManifest(sessions, manifest, evaluation);
}

export function validateManifest(
  source: readonly CorpusSession[],
  value: unknown,
  evaluation: unknown,
): CorpusManifest {
  const sessions = parseCorpus(source);
  const manifest = manifestSchema.parse(value);
  if (
    manifest.protocolHash !== hashJson(COMPARISON_PROTOCOL) ||
    manifest.corpusHash !== hashJson(sessions) ||
    manifest.evaluationHash !== hashJson(evaluation)
  ) {
    throw new Error('Frozen protocol/corpus/evaluation hash mismatch');
  }
  const expected = new Map(
    sessions.flatMap((s) => s.checkpoints.map((cp) => [cp.id, { session: s, cp }] as const)),
  );
  if (
    manifest.cases.length !== expected.size ||
    new Set(manifest.cases.map((c) => c.caseId)).size !== expected.size
  ) {
    throw new Error('Manifest must cover each checkpoint exactly once');
  }
  const parents = new Map<string, string>();
  function root(key: string): string {
    const parent = parents.get(key);
    if (!parent) {
      parents.set(key, key);
      return key;
    }
    if (parent === key) return key;
    const result = root(parent);
    parents.set(key, result);
    return result;
  }
  for (const session of sessions) {
    const keys = [
      `session:${session.sessionId}`,
      `source:${session.provenance.sourceSessionId}`,
      ...[session.designId, ...session.relatedDesignIds].map((design) => `design:${design}`),
    ];
    for (const key of keys.slice(1)) parents.set(root(key), root(`session:${session.sessionId}`));
  }
  const groupSplits = new Map<string, Split>();
  for (const entry of manifest.cases) {
    const expectedCase = expected.get(entry.caseId);
    if (!expectedCase) throw new Error('Unknown manifest checkpoint');
    if (entry.inputHash !== hashJson(createCorpusInput(expectedCase.session, entry.caseId)))
      throw new Error('Input hash mismatch');
    const group = root(`session:${expectedCase.session.sessionId}`);
    if (groupSplits.has(group) && groupSplits.get(group) !== entry.split)
      throw new Error('Related-session/design split leakage');
    groupSplits.set(group, entry.split);
  }
  return manifest;
}

const frozenSchema = z.strictObject({
  schemaVersion: z.literal(1),
  inputHash: hash,
  conditionId: id,
  context: z.string(),
  contextHash: hash,
});
export type FrozenContext = z.infer<typeof frozenSchema>;

export function freezeContext(
  input: CorpusInput,
  conditionId: string,
  context: string,
): FrozenContext {
  return frozenSchema.parse({
    schemaVersion: 1,
    inputHash: hashJson(parseInput(input)),
    conditionId,
    context,
    contextHash: hashJson(context),
  });
}

export function reuseContext(value: unknown, input: CorpusInput, conditionId: string): string {
  const frozen = frozenSchema.parse(value);
  if (
    frozen.inputHash !== hashJson(parseInput(input)) ||
    frozen.conditionId !== conditionId ||
    frozen.contextHash !== hashJson(frozen.context)
  )
    throw new Error('Frozen context input/condition/content mismatch');
  return frozen.context;
}
