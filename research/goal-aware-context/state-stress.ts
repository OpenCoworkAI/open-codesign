import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { ChatMessage } from '@open-codesign/shared';
import { z } from 'zod';
import { hashJson } from './corpus.js';
import { compressorMessages, validSummary } from './live-experiment.mjs';
import { type StateReference, scoreTraceState } from './state-evaluation.js';
import { stateReaderContract } from './state-reader-contract.js';
import { stateStressFixtures } from './state-stress-fixtures.js';
import { reportedOverflow, requestChecks, type UnifiedCounters } from './unified-budget.js';
import { assertExecutableConfig, parseUnifiedConfig } from './unified-config.js';
import { messageEnvelope } from './unified-plan.js';
import {
  createUnifiedSession,
  type SessionDependencies,
  type UnifiedCallResult,
} from './unified-session.js';

type Method = 'ordinary-summary' | 'goal-record';
const methods: Method[] = ['ordinary-summary', 'goal-record'];
function readStateReview() {
  const value: unknown = JSON.parse(
    readFileSync(new URL('./STATE_STRESS_REVIEW_DECISIONS.json', import.meta.url), 'utf8'),
  );
  const record = z
    .object({
      protocol: z.literal('state-stress-review@1'),
      status: z.literal('confirmed'),
      reviewId: z.string().min(1),
      confirmation: z.literal('S1–S4同意；G1采用建议；G2采用建议'),
      approvedSnapshot: z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/u) }),
      applied: z.object({
        fixtureHash: z.string(),
        referenceHash: z.string(),
        scoringProtocol: z.literal('trace-state-stress@2'),
      }),
    })
    .parse(value);
  const snapshotHash = createHash('sha256')
    .update(readFileSync(new URL('./STATE_STRESS_REVIEW.snapshot.json', import.meta.url)))
    .digest('hex');
  if (snapshotHash !== record.approvedSnapshot.sha256)
    throw new Error('Approved review snapshot changed');
  return { ...record, hash: hashJson(value) };
}
const probePrompt = stateReaderContract.prompt;
interface Chain {
  id: string;
  trajectoryId: string;
  method: Method;
  compactions: 1 | 3;
  goal: string;
  stages: { round: number; cutoff: number; eventIds: string[]; stateKeys: string[] }[];
}
function providerSources(directory: URL, prefix = ''): [string, string][] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory())
      return providerSources(new URL(`${entry.name}/`, directory), `${relative}/`);
    return entry.isFile() && entry.name.endsWith('.ts')
      ? [[relative, readFileSync(new URL(entry.name, directory), 'utf8')] as [string, string]]
      : [];
  });
}
function implementationHash() {
  const files = readdirSync(new URL('./', import.meta.url))
    .filter((f) => /\.(ts|mjs|mts)$/u.test(f))
    .sort();
  return hashJson({
    research: Object.fromEntries(
      files.map((f) => [f, readFileSync(new URL(f, import.meta.url), 'utf8')]),
    ),
    provider: Object.fromEntries(
      providerSources(new URL('../../packages/providers/src/', import.meta.url)).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    ),
    lock: readFileSync(new URL('../../pnpm-lock.yaml', import.meta.url), 'utf8'),
  });
}
export function prepareStateStress(value: unknown) {
  const config = parseUnifiedConfig(value);
  if (
    config.budgets.length !== 1 ||
    config.budgets[0] !== 2048 ||
    config.trials !== 1 ||
    config.caseIds !== null ||
    config.hostCaseIds !== null
  )
    throw new Error('State stress v2 requires 2K, one trial, no legacy case selectors');
  if (Object.values(config.models).some((m) => m.contextWindowTokens <= config.maxOutputTokens))
    throw new Error('Model window must exceed output reserve');
  const fixtures = stateStressFixtures();
  const references = Object.fromEntries(
    fixtures.flatMap((f) => f.checkpoints.map((c) => [`${f.id}/${c.cutoff}`, c] as const)),
  );
  const review = readStateReview();
  if (
    review.applied.fixtureHash !== hashJson(fixtures) ||
    review.applied.referenceHash !== hashJson(references)
  )
    throw new Error('Review approval does not match current stress references');
  const chains: Chain[] = fixtures.flatMap((f) =>
    methods.flatMap((method) =>
      ([1, 3] as const).map((compactions) => {
        const cutoffs = compactions === 1 ? [5] : [1, 3, 5];
        return {
          id: `${f.id}/${compactions}/${method}`,
          trajectoryId: f.id,
          method,
          compactions,
          goal: f.goal,
          stages: cutoffs.map((cutoff, i) => ({
            round: i + 1,
            cutoff,
            eventIds: f.events
              .filter((e) => e.seq <= cutoff && (i === 0 || e.seq > (cutoffs[i - 1] ?? -1)))
              .map((e) => e.id),
            stateKeys: (references[`${f.id}/${cutoff}`]?.claims ?? []).map((c) => c.key),
          })),
        };
      }),
    ),
  );
  const count = chains.reduce((n, c) => n + c.stages.length, 0);
  const body = {
    protocol: 'trace-state-stress@2',
    annotationStatus: 'synthetic-user-reviewed',
    reviewId: review.reviewId,
    reviewHash: review.hash,
    config,
    referenceHash: hashJson(references),
    fixtureHash: hashJson(fixtures),
    implementationHash: implementationHash(),
    readerContractId: stateReaderContract.id,
    probePrompt,
    inputs: fixtures.map(({ id, family, goal, events }) => ({ id, family, goal, events })),
    chains,
    compressorPrompts: Object.fromEntries(
      methods.map((method) => [
        method,
        compressorMessages({ goal: '', history: [] }, method, config.summaryMaxBytes)[0]?.content ??
          '',
      ]),
    ),
    plannedCalls: { compressor: count, reader: count, total: count * 2 },
    caveats: [
      'Single-user-reviewed synthetic references; not independent dual annotation or model performance evidence.',
      'Closed-memory track: old summary + new events; probes never feed later compression.',
      'One and three compactions share final cutoff; compare final metrics separately from intermediate diagnostics.',
      'No actual task completion claim; no retrieval/handoff methods added.',
      'One/three rounds are a minimal retention/scope test, not a full correction transfer-control benchmark.',
    ],
  };
  return { plan: { ...body, planHash: hashJson(body) }, references };
}
type Prepared = ReturnType<typeof prepareStateStress>;
export interface StressObservation {
  chainId: string;
  trajectoryId: string;
  method: Method;
  compactions: number;
  round: number;
  cutoff: number;
  status: string;
  compressorCallId: string | null;
  readerCallId: string | null;
  summaryHash: string | null;
  score: ReturnType<typeof scoreTraceState>;
}
type Dependencies = SessionDependencies & { counters?: UnifiedCounters };
interface Options {
  execute?: boolean;
  signal?: AbortSignal;
  onCall?: (row: UnifiedCallResult) => void;
  onObservation?: (row: StressObservation) => void;
}
export function stateReaderMessages(
  probePrompt: string,
  frozenMemory: string,
  stateKeys: string[],
): ChatMessage[] {
  return [
    { role: 'system', content: probePrompt },
    { role: 'user', content: JSON.stringify({ frozenMemory, stateKeys }) },
  ];
}
export function stateTotals(rows: { score: ReturnType<typeof scoreTraceState> }[]) {
  return {
    total: rows.reduce((n, r) => n + r.score.total, 0),
    valueCorrect: rows.reduce((n, r) => n + r.score.valueCorrect, 0),
    scopeCorrect: rows.reduce((n, r) => n + r.score.scopeCorrect, 0),
    provenanceCorrect: rows.reduce((n, r) => n + r.score.provenanceCorrect, 0),
    invalidationCorrect: rows.reduce((n, r) => n + r.score.invalidationCorrect, 0),
    jointCorrect: rows.reduce((n, r) => n + r.score.jointCorrect, 0),
  };
}
export async function runStateStress(
  prepared: Prepared,
  options: Options = {},
  dependencies?: Dependencies,
) {
  const frozen = structuredClone(prepared);
  const { planHash, ...body } = frozen.plan;
  if (readStateReview().hash !== body.reviewHash)
    throw new Error('Frozen stress review approval changed');
  const current = prepareStateStress(body.config);
  if (
    hashJson(body) !== planHash ||
    current.plan.planHash !== planHash ||
    hashJson(frozen.references) !== body.referenceHash ||
    current.plan.referenceHash !== body.referenceHash
  )
    throw new Error('Frozen stress plan/references/source changed');
  const { config } = frozen.plan;
  const calls: UnifiedCallResult[] = [],
    observations: StressObservation[] = [];
  const executionHash = hashJson({
    planHash,
    counters: Object.fromEntries(
      (['compressor', 'reader'] as const).map((role) => [
        role,
        dependencies?.counters?.[role]?.id ??
          (config.allowEstimatedBudget ? 'estimate-utf8-quarter-tokens@1' : 'unavailable@1'),
      ]),
    ),
  });
  const report = {
    protocol: body.protocol,
    annotationStatus: body.annotationStatus,
    reviewId: body.reviewId,
    reviewHash: body.reviewHash,
    readerContractId: body.readerContractId,
    mode: options.execute ? 'execute' : 'dry-run',
    planHash,
    executionHash,
    plannedCalls: body.plannedCalls,
    actualProviderCalls: 0,
    groups: null as
      | {
          method: Method;
          compactions: number;
          final: ReturnType<typeof stateTotals>;
          allStages: ReturnType<typeof stateTotals>;
        }[]
      | null,
    firstObservedFailure: [] as {
      chainId: string;
      round: number | null;
      cutoff: number | null;
      cause: string | null;
    }[],
    caveats: body.caveats,
  };
  if (!options.execute) return { report, calls, observations };
  assertExecutableConfig(config);
  if (!dependencies) throw new Error('Explicit stress execution dependencies required');
  const session = createUnifiedSession(config, dependencies, options.signal);
  const invoke = async (id: string, role: 'compressor' | 'reader', messages: ChatMessage[]) => {
    const row = await session.call({ id, role, messages });
    calls.push(row);
    options.onCall?.(structuredClone(row));
    return row;
  };
  for (const chain of body.chains) {
    const input = body.inputs.find((f) => f.id === chain.trajectoryId);
    if (!input) throw new Error('Missing stress input');
    let previousSummary: string | null = null,
      blocked = false,
      overflow = false;
    const chainRows: StressObservation[] = [];
    for (const stage of chain.stages) {
      const reference: StateReference | undefined =
        frozen.references[`${chain.trajectoryId}/${stage.cutoff}`];
      if (!reference) throw new Error('Missing stress reference');
      const observation: StressObservation = {
        chainId: chain.id,
        trajectoryId: chain.trajectoryId,
        method: chain.method,
        compactions: chain.compactions,
        round: stage.round,
        cutoff: stage.cutoff,
        status: blocked ? 'blocked-by-prior-summary' : 'not-run',
        compressorCallId: null,
        readerCallId: null,
        summaryHash: null,
        score: scoreTraceState(reference, null),
      };
      observations.push(observation);
      chainRows.push(observation);
      if (blocked) continue;
      const delta = input.events.filter((e) => stage.eventIds.includes(e.id));
      const messages = compressorMessages(
        {
          goal: chain.goal,
          history: [{ role: 'context', text: JSON.stringify({ previousSummary, events: delta }) }],
        },
        chain.method,
        config.summaryMaxBytes,
      ) as ChatMessage[];
      const compressorCheck = requestChecks(
        [messageEnvelope(messages)],
        'compressor',
        null,
        config,
        dependencies.counters,
      );
      if (compressorCheck.status !== 'within-budget') {
        observation.status = compressorCheck.status;
        blocked = true;
        continue;
      }
      const compressed = await invoke(
        `${chain.id}/round-${stage.round}/compress`,
        'compressor',
        messages,
      );
      observation.compressorCallId = compressed.id;
      if (reportedOverflow(compressed, compressorCheck, 'compressor', config)) {
        observation.status = 'provider-overflow';
        overflow = true;
        blocked = true;
        continue;
      }
      if (compressed.status !== 'ok' || !validSummary(compressed.value, config.summaryMaxBytes)) {
        observation.status = compressed.status === 'ok' ? 'invalid-summary' : compressed.status;
        blocked = true;
        continue;
      }
      previousSummary = (compressed.value as { summary: string }).summary;
      observation.summaryHash = hashJson(previousSummary);
      const readerMessages = stateReaderMessages(
        body.probePrompt,
        previousSummary,
        stage.stateKeys,
      );
      const readerCheck = requestChecks(
        [messageEnvelope(readerMessages)],
        'reader',
        2048,
        config,
        dependencies.counters,
      );
      if (readerCheck.status !== 'within-budget') {
        observation.status = readerCheck.status;
        continue;
      }
      const read = await invoke(`${chain.id}/round-${stage.round}/probe`, 'reader', readerMessages);
      observation.readerCallId = read.id;
      if (reportedOverflow(read, readerCheck, 'reader', config)) {
        observation.status = 'provider-overflow';
        overflow = true;
        blocked = true;
        continue;
      }
      observation.score = scoreTraceState(reference, read);
      observation.status =
        read.status !== 'ok' ? read.status : observation.score.formatValid ? 'ok' : 'invalid-state';
    }
    const failure = chainRows.find((r) => r.score.jointCorrect !== r.score.total);
    const firstFailure = failure
      ? {
          round: failure.round,
          cutoff: failure.cutoff,
          cause: failure.status === 'ok' ? 'state-mismatch' : failure.status,
        }
      : null;
    for (const row of chainRows) {
      if (overflow) {
        const reference = frozen.references[`${chain.trajectoryId}/${row.cutoff}`];
        row.score = scoreTraceState(reference, { status: 'provider-overflow', value: null });
        row.status = 'provider-overflow';
      } else if (!row.readerCallId) row.score.runtimeStatus = row.status;
      options.onObservation?.(structuredClone(row));
    }
    report.firstObservedFailure.push({
      chainId: chain.id,
      round: firstFailure?.round ?? null,
      cutoff: firstFailure?.cutoff ?? null,
      cause: firstFailure?.cause ?? null,
    });
  }
  report.actualProviderCalls = session.stats().providerCalls;
  report.groups = methods.flatMap((method) =>
    ([1, 3] as const).map((compactions) => {
      const rows = observations.filter((r) => r.method === method && r.compactions === compactions);
      return {
        method,
        compactions,
        final: stateTotals(rows.filter((r) => r.cutoff === 5)),
        allStages: stateTotals(rows),
      };
    }),
  );
  return { report, calls, observations };
}
