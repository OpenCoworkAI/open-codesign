import { z } from 'zod';
import {
  COMPARISON_PROTOCOL,
  type CorpusSession,
  createCorpusInput,
  hashJson,
  parseCorpus,
} from './corpus.js';
import { deriveGoalState } from './goal-state.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const draftSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('ai-drafted-oracle-state'),
  reviewStatus: z.literal('needs-human-review'),
  reviewedByHuman: z.literal(false),
  corpusHash: hash,
  cases: z
    .array(
      z.strictObject({
        caseId: z.string().min(1),
        inputHash: hash,
        reviewStatus: z.literal('needs-human-review'),
        records: z.array(z.json()).min(1),
      }),
    )
    .min(1),
});
const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  protocolId: z.literal(COMPARISON_PROTOCOL.id),
  protocolHash: hash,
  corpusHash: hash,
  evaluationHash: hash,
  cases: z
    .array(
      z.strictObject({
        caseId: z.string().min(1),
        split: z.enum(['development', 'heldout']),
        inputHash: hash,
      }),
    )
    .min(1),
});

/** The fixture convention maps synthetic:file@revision to its tool-result revision. */
export function syntheticToolRevision(workspaceRevision: string): string {
  const match = /^synthetic:[^@]+@(.+)$/u.exec(workspaceRevision);
  if (!match?.[1])
    throw new Error('Only explicit synthetic revisions are supported by the draft audit');
  return match[1];
}

export function parseAnnotationDrafts(
  value: unknown,
  source: readonly CorpusSession[],
  manifestValue: unknown,
) {
  const sessions = parseCorpus(source);
  const drafts = draftSchema.parse(value);
  const manifest = manifestSchema.parse(manifestValue);
  if (
    drafts.corpusHash !== hashJson(sessions) ||
    manifest.corpusHash !== drafts.corpusHash ||
    manifest.protocolHash !== hashJson(COMPARISON_PROTOCOL)
  )
    throw new Error('Corpus/protocol hash mismatch');
  const sourceCases = new Map(
    sessions.flatMap((s) => s.checkpoints.map((cp) => [cp.id, { s, cp }] as const)),
  );
  const manifestCases = new Map(manifest.cases.map((c) => [c.caseId, c]));
  if (sourceCases.size !== manifest.cases.length || manifestCases.size !== sourceCases.size)
    throw new Error('Manifest coverage mismatch');
  for (const entry of manifest.cases) {
    const sourceCase = sourceCases.get(entry.caseId);
    if (!sourceCase || entry.inputHash !== hashJson(createCorpusInput(sourceCase.s, entry.caseId)))
      throw new Error('Manifest input hash mismatch');
  }
  const development = manifest.cases.filter((c) => c.split === 'development');
  if (
    development.length !== drafts.cases.length ||
    new Set(drafts.cases.map((c) => c.caseId)).size !== development.length
  )
    throw new Error('Drafts must cover development cases exactly once');
  for (const entry of drafts.cases) {
    const pinned = manifestCases.get(entry.caseId),
      sourceCase = sourceCases.get(entry.caseId);
    if (!sourceCase || !pinned || pinned.split !== 'development')
      throw new Error('No heldout or unknown annotations allowed');
    const input = createCorpusInput(sourceCase.s, entry.caseId);
    if (entry.inputHash !== pinned.inputHash) throw new Error('Draft input hash mismatch');
    deriveGoalState(entry.records, input.designId, syntheticToolRevision(input.workspaceRevision), {
      chatRows: input.contextInput.chatRows,
      cutoffSeq: input.cutoffSeq,
    });
  }
  return drafts;
}
