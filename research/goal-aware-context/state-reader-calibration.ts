import { hashJson } from './corpus.js';
import { scoreTraceState } from './state-evaluation.js';
import { prepareStateStress, stateReaderMessages, stateTotals } from './state-stress.js';
import { reportedOverflow, requestChecks, type UnifiedCounters } from './unified-budget.js';
import { assertExecutableConfig } from './unified-config.js';
import { messageEnvelope } from './unified-plan.js';
import {
  createUnifiedSession,
  type SessionDependencies,
  type UnifiedCallResult,
} from './unified-session.js';

export function prepareStateCalibration(value: unknown) {
  const stress = prepareStateStress(value);
  const {
    config,
    inputs,
    probePrompt,
    referenceHash,
    fixtureHash,
    implementationHash,
    reviewId,
    reviewHash,
    annotationStatus,
    readerContractId,
  } = stress.plan;
  const probes = inputs.flatMap((input) =>
    [1, 3, 5].map((cutoff) => ({
      id: `reader-calibration/${input.id}/cutoff-${cutoff}/probe`,
      trajectoryId: input.id,
      cutoff,
      stateKeys: (stress.references[`${input.id}/${cutoff}`]?.claims ?? []).map(
        (claim) => claim.key,
      ),
    })),
  );
  const body = {
    protocol: 'trace-state-reader-calibration@1',
    config,
    inputs,
    probes,
    probePrompt,
    referenceHash,
    fixtureHash,
    implementationHash,
    reviewId,
    reviewHash,
    annotationStatus,
    readerContractId,
    stressPlanHash: stress.plan.planHash,
    plannedCalls: { compressor: 0, reader: probes.length, total: probes.length },
    caveats: [
      'Single-user-reviewed synthetic short cases; not independent dual annotation or compression performance evidence.',
      'Full original prefix for each independent reader probe; no compression or answer feedback.',
      'Exact scoring may require human review of new expressions; do not interpret every mismatch as forgetting.',
    ],
  };
  return { plan: { ...body, planHash: hashJson(body) }, references: stress.references };
}
type Prepared = ReturnType<typeof prepareStateCalibration>;
export interface CalibrationObservation {
  probeId: string;
  trajectoryId: string;
  cutoff: number;
  status: string;
  readerCallId: string | null;
  score: ReturnType<typeof scoreTraceState>;
}
interface Options {
  execute?: boolean;
  signal?: AbortSignal;
  onCall?: (row: UnifiedCallResult) => void;
  onObservation?: (row: CalibrationObservation) => void;
}
export async function runStateCalibration(
  prepared: Prepared,
  options: Options = {},
  dependencies?: SessionDependencies & { counters?: UnifiedCounters },
) {
  const frozen = structuredClone(prepared);
  const { planHash, ...body } = frozen.plan;
  const current = prepareStateCalibration(body.config);
  if (
    hashJson(body) !== planHash ||
    current.plan.planHash !== planHash ||
    hashJson(frozen.references) !== body.referenceHash ||
    current.plan.referenceHash !== body.referenceHash
  )
    throw new Error('Frozen reader calibration plan/references/approval/source changed');
  const calls: UnifiedCallResult[] = [],
    observations: CalibrationObservation[] = [];
  const report = {
    protocol: body.protocol,
    annotationStatus: body.annotationStatus,
    reviewId: body.reviewId,
    reviewHash: body.reviewHash,
    readerContractId: body.readerContractId,
    mode: options.execute ? 'execute' : 'dry-run',
    planHash,
    executionHash: hashJson({
      planHash,
      readerCounter:
        dependencies?.counters?.reader?.id ??
        (body.config.allowEstimatedBudget ? 'estimate-utf8-quarter-tokens@1' : 'unavailable@1'),
    }),
    plannedCalls: body.plannedCalls,
    actualProviderCalls: 0,
    groups: null as {
      fullPrefix: ReturnType<typeof stateTotals>;
      final: ReturnType<typeof stateTotals>;
    } | null,
    readiness: null as { passed: boolean; reasons: string[] } | null,
    caveats: body.caveats,
  };
  if (!options.execute) return { report, calls, observations };
  assertExecutableConfig(body.config);
  if (!dependencies) throw new Error('Explicit calibration execution dependencies required');
  const session = createUnifiedSession(body.config, dependencies, options.signal);
  for (const probe of body.probes) {
    const reference = frozen.references[`${probe.trajectoryId}/${probe.cutoff}`];
    const input = body.inputs.find((input) => input.id === probe.trajectoryId);
    if (!reference || !input) throw new Error('Missing calibration input/reference');
    const row: CalibrationObservation = {
      probeId: probe.id,
      trajectoryId: probe.trajectoryId,
      cutoff: probe.cutoff,
      status: 'not-run',
      readerCallId: null,
      score: scoreTraceState(reference, null),
    };
    const messages = stateReaderMessages(
      body.probePrompt,
      JSON.stringify({ events: input.events.filter((event) => event.seq <= probe.cutoff) }),
      probe.stateKeys,
    );
    const check = requestChecks(
      [messageEnvelope(messages)],
      'reader',
      2048,
      body.config,
      dependencies.counters,
    );
    if (check.status !== 'within-budget') row.status = check.status;
    else {
      const response = await session.call({ id: probe.id, role: 'reader', messages });
      calls.push(response);
      options.onCall?.(structuredClone(response));
      row.readerCallId = response.id;
      if (reportedOverflow(response, check, 'reader', body.config))
        row.status = 'provider-overflow';
      else {
        row.score = scoreTraceState(reference, response);
        row.status =
          response.status !== 'ok'
            ? response.status
            : row.score.formatValid
              ? 'ok'
              : 'invalid-state';
      }
    }
    if (row.status !== 'ok') row.score.runtimeStatus = row.status;
    observations.push(row);
    options.onObservation?.(structuredClone(row));
  }
  report.actualProviderCalls = session.stats().providerCalls;
  report.groups = {
    fullPrefix: stateTotals(observations),
    final: stateTotals(observations.filter((row) => row.cutoff === 5)),
  };
  const reasons: string[] = [];
  if (observations.some((row) => row.status !== 'ok' || !row.score.formatValid))
    reasons.push('runtime-or-format-failure');
  if (report.groups.fullPrefix.jointCorrect !== report.groups.fullPrefix.total)
    reasons.push('state-mismatch-or-unreviewed-expression');
  report.readiness = { passed: reasons.length === 0, reasons };
  return { report, calls, observations };
}
