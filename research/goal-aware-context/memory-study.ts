import type { ChatMessage } from '@open-codesign/shared';
import { hashJson } from './corpus.js';
import { goalMemoryVersion, selectGoalMemory } from './goal-memory.js';
import { compressorMessages, validSummary } from './live-experiment.mjs';
import {
  type StateEvent,
  type StateReference,
  scoreTraceState,
  validateStateReference,
} from './state-evaluation.js';
import { prepareStateStress, stateReaderMessages, stateTotals } from './state-stress.js';
import {
  type RequestCheck,
  reportedOverflow,
  requestChecks,
  type UnifiedCounters,
} from './unified-budget.js';
import { assertExecutableConfig, parseUnifiedConfig } from './unified-config.js';
import { messageEnvelope } from './unified-plan.js';
import {
  createUnifiedSession,
  type SessionDependencies,
  type UnifiedCallResult,
} from './unified-session.js';

type Method = 'ordinary-summary' | 'goal-record' | 'stable-handoff' | 'goal-recall' | 'full-prefix';
const methods: Method[] = ['ordinary-summary', 'goal-record', 'stable-handoff', 'goal-recall'];
export function handoffMemory(value: unknown, limit: number): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const { stableConstraints, handoff } = record;
  if (
    Object.keys(record).length !== 2 ||
    typeof stableConstraints !== 'string' ||
    !stableConstraints.trim() ||
    typeof handoff !== 'string' ||
    !handoff.trim()
  )
    return null;
  const memory = JSON.stringify({ stableConstraints, handoff });
  return Buffer.byteLength(memory, 'utf8') <= limit ? memory : null;
}
function handoffPrompt(limit: number) {
  return `Maintain a resumption memory for the supplied goal using only previousMemory and new events. Return exactly JSON {"stableConstraints":"...","handoff":"..."}, both nonempty strings, no other fields or Markdown. The ENTIRE serialized JSON record, including both strings and JSON syntax, must fit ${limit} UTF-8 bytes (Chinese characters often need3 bytes). Aim below the hard limit. Give each section roughly half the space, transferring unused capacity. stableConstraints holds current user decisions and durable preservation/prohibition rules with explicit workspace-global versus design/file/object/field scope. handoff holds current goal, actual on-disk facts and revisions, correction/revocation transitions, unresolved choices, failed or missing verification, and immediate unfinished prerequisite actions. Retain original event IDs, seq, authority and source revision in compact citations, never replace them with the summary's identity. User intent differs from tool observations. A later file revision invalidates an older preview: retain both the original receipt and invalidating observation. Never infer successful work from failed/missing receipts. Keep corrections within the same design; do not inherit local decisions into another design. Workspace-wide constraints survive design switches. Separate superseded facts from currently applicable facts. Do not invent identifiers, choices, observations or success. You receive no downstream questions and cannot consult the archive.`;
}
export function parseMemoryStudyConfig(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Memory study config required');
  const { study, ...base } = value as Record<string, unknown>;
  if (study !== 'short' && study !== 'long') throw new Error('Specify short or long study');
  const config = parseUnifiedConfig(base);
  if (config.trials !== (study === 'short' ? 1 : 3))
    throw new Error('Short requires one trial; long requires three');
  return { ...config, study };
}
interface Input {
  id: string;
  family: string;
  goal: string;
  events: StateEvent[];
  derivedFrom: string | null;
}
interface Chain {
  id: string;
  trajectoryId: string;
  method: Method;
  trial: number;
  compactions: number;
  goal: string;
  stages: {
    round: number;
    cutoff: number;
    eventIds: string[];
    stateKeys: string[];
    probe: boolean;
    final: boolean;
  }[];
}

function longInput(input: Input, references: Record<string, StateReference>) {
  const events: StateEvent[] = [];
  input.events.forEach((core, index) => {
    events.push({ ...core, seq: events.length });
    if (index === input.events.length - 1) return;
    for (let i = 0; i < 10; i++) {
      const other = i % 2 === 0;
      events.push({
        id: `noise-${index}-${i}`,
        seq: events.length,
        authority: 'tool',
        designId: other ? 'Z' : core.designId,
        revision: null,
        text: `workspace w / design ${other ? 'Z' : core.designId} / ${other ? 'App.jsx' : 'diagnostics.json'}: performance-only diagnostic sample ${index * 10 + i}. latency=${i + 20}ms; bufferCounter=${index * 100 + i}; cacheLabel=transient. This measurement makes no artifact-state assertion. ${'Timing histogram bucket stable. '.repeat(3)}`,
      });
    }
  });
  const mapped = new Map(events.map((e) => [e.id, e]));
  const source = (s: StateReference['claims'][number]['sources'][number]) => {
    const event = mapped.get(s.eventId);
    if (!event) throw new Error('Missing derived source');
    return { ...s, seq: event.seq };
  };
  const id = `long-${input.id}`;
  const derived = Object.entries(references)
    .filter(([key]) => key.startsWith(`${input.id}/`))
    .map(([, ref]) => {
      const core = input.events.find((e) => e.seq === ref.cutoff),
        cutoff = core && mapped.get(core.id)?.seq;
      if (cutoff === undefined) throw new Error('Missing derived cutoff');
      return [
        `${id}/${cutoff}`,
        validateStateReference({
          cutoff,
          events: events.filter((e) => e.seq <= cutoff),
          claims: ref.claims.map((c) => ({
            ...c,
            sources: c.sources.map(source),
            acceptedSourceSets: c.acceptedSourceSets.map((set) => set.map(source)),
          })),
        }),
      ] as const;
    });
  return {
    input: { ...input, id, events, derivedFrom: input.id },
    references: Object.fromEntries(derived),
  };
}

export function prepareMemoryStudy(value: unknown) {
  const config = parseMemoryStudyConfig(value);
  const { study, ...base } = config;
  const approved = prepareStateStress({ ...base, trials: 1 });
  let inputs: Input[] = approved.plan.inputs.map((input) => ({ ...input, derivedFrom: null }));
  let references: Record<string, StateReference> = approved.references;
  if (study === 'long') {
    const derived = inputs
      .filter((input) => ['version-facts', 'correction-new-design'].includes(input.id))
      .map((input) => longInput(input, references));
    inputs = derived.map((d) => d.input);
    references = Object.assign({}, ...derived.map((d) => d.references));
  }
  const chains: Chain[] = inputs.flatMap((input) =>
    Array.from({ length: config.trials }, (_, i) => i + 1).flatMap((trial) =>
      (study === 'long' ? [...methods, 'full-prefix' as const] : methods).flatMap((method) => {
        const counts = method === 'full-prefix' ? [0] : study === 'short' ? [1, 3] : [3];
        const cutoffs = Object.entries(references)
          .filter(([key]) => key.startsWith(`${input.id}/`))
          .map(([, r]) => r.cutoff)
          .sort((a, b) => a - b);
        const last = cutoffs.at(-1);
        if (last === undefined) throw new Error('Missing final cutoff');
        return counts.map((compactions) => {
          const selected = compactions === 3 ? cutoffs : [last];
          return {
            id: `${input.id}/trial-${trial}/${compactions}/${method}`,
            trajectoryId: input.id,
            method,
            trial,
            compactions,
            goal: input.goal,
            stages: selected.map((cutoff, index) => ({
              round: index + 1,
              cutoff,
              eventIds: input.events
                .filter(
                  (e) => e.seq <= cutoff && (index === 0 || e.seq > (selected[index - 1] ?? -1)),
                )
                .map((e) => e.id),
              stateKeys: references[`${input.id}/${cutoff}`]?.claims.map((c) => c.key) ?? [],
              probe: study === 'short' || cutoff === last,
              final: cutoff === last,
            })),
          };
        });
      }),
    ),
  );
  let compressor = 0,
    reader = 0;
  for (const chain of chains)
    for (const stage of chain.stages) {
      if (!['goal-recall', 'full-prefix'].includes(chain.method)) compressor++;
      if (stage.probe) reader++;
    }
  const longControls =
    study === 'long'
      ? inputs.map((input) => {
          const memory = JSON.stringify({ goal: input.goal, events: input.events });
          const keys =
            references[`${input.id}/${input.events.at(-1)?.seq}`]?.claims.map((c) => c.key) ?? [];
          const check = requestChecks(
            [messageEnvelope(stateReaderMessages(approved.plan.probePrompt, memory, keys))],
            'reader',
            8192,
            config,
          );
          if (
            Buffer.byteLength(memory) <= config.summaryMaxBytes ||
            check.status !== 'within-budget'
          )
            throw new Error('Long control must exceed memory cap and fit8192 input');
          return {
            trajectoryId: input.id,
            historyBytes: Buffer.byteLength(memory),
            events: input.events.length,
            inputCheck: check,
          };
        })
      : [];
  const body = {
    protocol: 'trace-state-memory-study@1',
    annotationStatus:
      study === 'short' ? 'synthetic-user-reviewed' : 'synthetic-derived-reviewed-core',
    reviewId: approved.plan.reviewId,
    reviewHash: approved.plan.reviewHash,
    approvedFixtureHash: approved.plan.fixtureHash,
    config,
    fixtureHash: hashJson(inputs),
    referenceHash: hashJson(references),
    implementationHash: approved.plan.implementationHash,
    readerContractId: approved.plan.readerContractId,
    probePrompt: approved.plan.probePrompt,
    selectorVersion: goalMemoryVersion,
    handoffPrompt: handoffPrompt(config.summaryMaxBytes),
    compressorPrompts: approved.plan.compressorPrompts,
    inputs,
    chains,
    longControls,
    derivation:
      study === 'long'
        ? {
            noisePerGap: 10,
            sourceSeqMapping:
              'preserve core event IDs and text; remap seq/cutoffs/all evidence sets',
            families: 2,
          }
        : null,
    plannedCalls: { compressor, reader, total: compressor + reader },
    caveats: [
      'Development-calibrated reader remains imperfect; compare full-prefix control before attributing errors to compression.',
      'Goal recall explicitly accesses the archive; it is not closed-memory retention. All-fit short cases test wiring, not retrieval quality.',
      'Handoff changes both instructions and organization; this is a compound method intervention.',
      'Estimated UTF8-quarter-token budgets, not exact equal-token accounting. Wrapper usage may omit cached input.',
      'Long trials are descriptive repeats of two synthetic families, not independent corpus samples. Final-only long probes cannot locate a loss round.',
    ],
  };
  return { plan: { ...body, planHash: hashJson(body) }, references };
}

type Prepared = ReturnType<typeof prepareMemoryStudy>;
interface MemoryTrace {
  round: number;
  cutoff: number;
  status: string;
  memoryBytes: number | null;
  memoryHash: string | null;
  compressorCallId: string | null;
  compressorCheck: RequestCheck | null;
  retrieval: ReturnType<typeof selectGoalMemory> | null;
}
export interface MemoryObservation {
  chainId: string;
  trajectoryId: string;
  method: Method;
  trial: number;
  compactions: number;
  round: number;
  cutoff: number;
  final: boolean;
  status: string;
  failureCause: string | null;
  readerCallId: string | null;
  readerCheck: RequestCheck | null;
  memoryTrace: MemoryTrace[];
  score: ReturnType<typeof scoreTraceState>;
}
interface Options {
  execute?: boolean;
  signal?: AbortSignal;
  onCall?: (row: UnifiedCallResult) => void;
  onObservation?: (row: MemoryObservation) => void;
}
type Dependencies = SessionDependencies & { counters?: UnifiedCounters };
export async function runMemoryStudy(
  prepared: Prepared,
  options: Options = {},
  dependencies?: Dependencies,
) {
  const frozen = structuredClone(prepared),
    { planHash, ...body } = frozen.plan;
  if (
    hashJson(body) !== planHash ||
    prepareMemoryStudy(body.config).plan.planHash !== planHash ||
    hashJson(frozen.references) !== body.referenceHash
  )
    throw new Error('Frozen memory plan/references/source changed');
  const config = body.config,
    calls: UnifiedCallResult[] = [],
    observations: MemoryObservation[] = [];
  const report = {
    protocol: body.protocol,
    annotationStatus: body.annotationStatus,
    reviewId: body.reviewId,
    reviewHash: body.reviewHash,
    readerContractId: body.readerContractId,
    mode: options.execute ? 'execute' : 'dry-run',
    planHash,
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
    trialResults: [] as {
      chainId: string;
      trajectoryId: string;
      trial: number;
      method: Method;
      compactions: number;
      score: ReturnType<typeof stateTotals>;
    }[],
    caveats: body.caveats,
  };
  if (!options.execute) return { report, calls, observations };
  assertExecutableConfig(config);
  if (!dependencies) throw new Error('Explicit execution dependencies required');
  const session = createUnifiedSession(config, dependencies, options.signal);
  const invoke = async (id: string, role: 'compressor' | 'reader', messages: ChatMessage[]) => {
    const row = await session.call({ id, role, messages });
    calls.push(row);
    options.onCall?.(structuredClone(row));
    return row;
  };
  for (const chain of body.chains) {
    const input = body.inputs.find((i) => i.id === chain.trajectoryId);
    if (!input) throw new Error('Missing memory input');
    let memory: string | null = null,
      blocked: string | null = null,
      overflow = false;
    const trace: MemoryTrace[] = [],
      rows: MemoryObservation[] = [];
    for (const stage of chain.stages) {
      const reference = frozen.references[`${input.id}/${stage.cutoff}`];
      if (!reference) throw new Error('Missing memory reference');
      const update: MemoryTrace = {
        round: stage.round,
        cutoff: stage.cutoff,
        status: blocked ? 'blocked-by-prior-summary' : 'not-run',
        memoryBytes: null,
        memoryHash: null,
        compressorCallId: null,
        compressorCheck: null,
        retrieval: null,
      };
      trace.push(update);
      if (!blocked) {
        if (chain.method === 'goal-recall') {
          update.retrieval = selectGoalMemory({
            goal: chain.goal,
            events: input.events,
            cutoff: stage.cutoff,
            byteLimit: config.summaryMaxBytes,
          });
          memory = update.retrieval.frozenMemory;
          update.status = 'ok';
        } else if (chain.method === 'full-prefix') {
          memory = JSON.stringify({
            goal: chain.goal,
            events: input.events.filter((e) => e.seq <= stage.cutoff),
          });
          update.status = 'ok';
        } else {
          const delta = input.events.filter((e) => stage.eventIds.includes(e.id));
          const messages: ChatMessage[] =
            chain.method === 'stable-handoff'
              ? [
                  { role: 'system', content: body.handoffPrompt },
                  {
                    role: 'user',
                    content: JSON.stringify({
                      goal: chain.goal,
                      previousMemory: memory,
                      events: delta,
                    }),
                  },
                ]
              : (compressorMessages(
                  {
                    goal: chain.goal,
                    history: [
                      {
                        role: 'context',
                        text: JSON.stringify({ previousSummary: memory, events: delta }),
                      },
                    ],
                  },
                  chain.method,
                  config.summaryMaxBytes,
                ) as ChatMessage[]);
          const check = requestChecks(
            [messageEnvelope(messages)],
            'compressor',
            null,
            config,
            dependencies.counters,
          );
          update.compressorCheck = check;
          if (check.status !== 'within-budget') {
            blocked = check.status;
            update.status = blocked;
          } else {
            const compressed = await invoke(
              `${chain.id}/round-${stage.round}/compress`,
              'compressor',
              messages,
            );
            update.compressorCallId = compressed.id;
            if (reportedOverflow(compressed, check, 'compressor', config)) {
              blocked = 'provider-overflow';
              overflow = true;
            } else if (compressed.status !== 'ok') blocked = compressed.status;
            else {
              const next =
                chain.method === 'stable-handoff'
                  ? handoffMemory(compressed.value, config.summaryMaxBytes)
                  : validSummary(compressed.value, config.summaryMaxBytes)
                    ? (compressed.value as { summary: string }).summary
                    : null;
              if (next === null) blocked = 'invalid-summary';
              else memory = next;
            }
            update.status = blocked ?? 'ok';
          }
        }
      }
      if (update.status === 'ok' && memory !== null) {
        update.memoryBytes = Buffer.byteLength(memory);
        update.memoryHash = hashJson(memory);
      }
      if (!stage.probe) continue;
      const row: MemoryObservation = {
        chainId: chain.id,
        trajectoryId: chain.trajectoryId,
        method: chain.method,
        trial: chain.trial,
        compactions: chain.compactions,
        round: stage.round,
        cutoff: stage.cutoff,
        final: stage.final,
        status: blocked ? update.status : 'not-run',
        failureCause: blocked,
        readerCallId: null,
        readerCheck: null,
        memoryTrace: structuredClone(trace),
        score: scoreTraceState(reference, null),
      };
      rows.push(row);
      if (blocked || memory === null) continue;
      const messages = stateReaderMessages(body.probePrompt, memory, stage.stateKeys);
      const check = requestChecks(
        [messageEnvelope(messages)],
        'reader',
        chain.method === 'full-prefix' ? 8192 : 2048,
        config,
        dependencies.counters,
      );
      row.readerCheck = check;
      if (check.status !== 'within-budget') {
        row.status = check.status;
        continue;
      }
      const read = await invoke(`${chain.id}/round-${stage.round}/probe`, 'reader', messages);
      row.readerCallId = read.id;
      if (reportedOverflow(read, check, 'reader', config)) {
        row.status = 'provider-overflow';
        blocked = 'provider-overflow';
        overflow = true;
        continue;
      }
      row.score = scoreTraceState(reference, read);
      row.status =
        read.status !== 'ok' ? read.status : row.score.formatValid ? 'ok' : 'invalid-state';
    }
    for (const row of rows) {
      if (overflow) {
        row.status = 'provider-overflow';
        row.failureCause = 'provider-overflow';
        row.score = scoreTraceState(frozen.references[`${row.trajectoryId}/${row.cutoff}`], {
          status: 'provider-overflow',
          value: null,
        });
      } else if (!row.readerCallId) row.score.runtimeStatus = row.status;
      observations.push(row);
      options.onObservation?.(structuredClone(row));
    }
    report.trialResults.push({
      chainId: chain.id,
      trajectoryId: chain.trajectoryId,
      trial: chain.trial,
      method: chain.method,
      compactions: chain.compactions,
      score: stateTotals(rows.filter((r) => r.final)),
    });
  }
  report.actualProviderCalls = session.stats().providerCalls;
  const conditions = new Map(
    body.chains.map((c) => [
      `${c.method}/${c.compactions}`,
      { method: c.method, compactions: c.compactions },
    ]),
  );
  report.groups = [...conditions.values()].map((condition) => {
    const rows = observations.filter(
      (r) => r.method === condition.method && r.compactions === condition.compactions,
    );
    return {
      ...condition,
      final: stateTotals(rows.filter((r) => r.final)),
      allStages: stateTotals(rows),
    };
  });
  return { report, calls, observations };
}
