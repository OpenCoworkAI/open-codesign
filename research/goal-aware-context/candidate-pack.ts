import type {
  BuildDesignContextPackInput,
  DesignContextPackV1,
} from '../../packages/core/src/design-context.js';
import { formatUntrustedContext } from '../../packages/core/src/lib/context-format.js';
import {
  type BudgetLimits,
  type BudgetMeasurement,
  type CompleteModelInput,
  measureRequest,
  type TokenCounter,
} from './budget.js';
import {
  type ConstraintRecord,
  deriveGoalState,
  type GoalState,
  validateEvidenceContext,
} from './goal-state.js';
import { buildProductionBaseline } from './production-baseline.js';

export interface CandidateScope {
  records: unknown;
  designId: string;
  currentRevision: string;
  cutoffSeq: number;
}
export interface CandidateBudget {
  limits: BudgetLimits;
  systemPrompt: string;
  tools: CompleteModelInput['tools'];
  readerReserveTokens: number;
  counter?: TokenCounter;
}
export interface CandidatePackResult {
  schemaVersion: 1;
  condition: 'draft-oracle-state-only';
  mode: 'candidate' | 'fallback';
  fallbackReason:
    | 'empty-state'
    | 'invalid-state'
    | 'overflow'
    | 'unavailable-budget'
    | 'budget-error'
    | null;
  detail: string | null;
  pack: DesignContextPackV1;
  measurement: BudgetMeasurement | null;
  readerReserveTokens: number;
  selectedRecordIds: string[];
  omittedRecordIds: string[];
  state: GoalState | null;
}

function measure(pack: DesignContextPackV1, budget: CandidateBudget): BudgetMeasurement {
  const reserve = budget.readerReserveTokens;
  if (!Number.isSafeInteger(reserve) || reserve < 0) throw new Error('Invalid reader reserve');
  return measureRequest(
    {
      systemPrompt: budget.systemPrompt,
      tools: budget.tools,
      messages: pack.history,
      contextSections: pack.contextSections,
      question: null,
    },
    {
      inputBudgetTokens: budget.limits.inputBudgetTokens - reserve,
      contextWindowTokens: budget.limits.contextWindowTokens - reserve,
      reservedOutputTokens: budget.limits.reservedOutputTokens,
    },
    budget.counter,
  );
}

const categoryPriority: Record<ConstraintRecord['category'], number> = {
  goal: 2,
  scope: 3,
  constraint: 3,
  'open-task': 4,
  decision: 5,
  observation: 6,
  verification: 7,
};
function priority(record: ConstraintRecord): number {
  if (record.status === 'unresolved') return 0;
  if (record.status === 'revoked') return 1;
  return categoryPriority[record.category];
}
function makePack(
  base: DesignContextPackV1,
  records: readonly ConstraintRecord[],
): DesignContextPackV1 {
  const contextSections = [
    ...base.contextSections,
    formatUntrustedContext(
      'goal_state',
      'Research-only draft annotations. Active user intent, observed file facts, unresolved alternatives and revoked preferences have distinct statuses. A revoked preference is not an active requirement. Semantic correctness still needs human review.',
      JSON.stringify(records),
    ),
  ];
  return {
    history: [],
    contextSections,
    trace: {
      ...base.trace,
      briefChars: 0,
      historyChars: 0,
      selectedMessages: 0,
      sessionContextChars: contextSections.reduce((sum, section) => sum + section.length, 0),
    },
  };
}

/** Oracle state-selection ablation, not natural-language extraction or production memory. */
export function buildCandidatePack(
  input: BuildDesignContextPackInput,
  scope: CandidateScope,
  budget: CandidateBudget,
): CandidatePackResult {
  const evidence = { chatRows: input.chatRows, cutoffSeq: scope.cutoffSeq };
  // Bad host bounds must fail before a baseline fallback can expose a suffix.
  validateEvidenceContext(scope.designId, evidence);
  const original = buildProductionBaseline(input);
  let state: GoalState | null = null;
  const fallback = (
    reason: Exclude<CandidatePackResult['fallbackReason'], null>,
    detail: string | null,
  ): CandidatePackResult => {
    let measurement: BudgetMeasurement | null = null;
    try {
      measurement = measure(original, budget);
    } catch {
      /* The recorded fallback reason/detail retains failure. */
    }
    return {
      schemaVersion: 1,
      condition: 'draft-oracle-state-only',
      mode: 'fallback',
      fallbackReason: reason,
      detail,
      pack: original,
      measurement,
      readerReserveTokens: budget.readerReserveTokens,
      selectedRecordIds: [],
      omittedRecordIds: state?.records.map((record) => record.id) ?? [],
      state,
    };
  };
  try {
    state = deriveGoalState(scope.records, scope.designId, scope.currentRevision, evidence);
  } catch (error) {
    return fallback('invalid-state', error instanceof Error ? error.message : String(error));
  }
  if (state.records.length === 0) return fallback('empty-state', 'No effective in-scope state');
  // Cached brief/history and lastDone can contain stale decisions or verification.
  const hostInput: BuildDesignContextPackInput = { ...input, brief: null, historyBudgetChars: 0 };
  if (input.resourceState) hostInput.resourceState = { ...input.resourceState, lastDone: null };
  const base = buildProductionBaseline(hostInput);
  const ordered = [...state.records].sort(
    (a, b) =>
      priority(a) - priority(b) || b.sourceSeq - a.sourceSeq || a.id.localeCompare(b.id, 'en'),
  );
  const selected: ConstraintRecord[] = [];
  const omittedRecordIds: string[] = [];
  let measurement: BudgetMeasurement | null = null;
  try {
    const emptyMeasurement = measure(makePack(base, []), budget);
    if (emptyMeasurement.status === 'unavailable')
      return fallback('unavailable-budget', emptyMeasurement.error ?? 'No count');
    if (emptyMeasurement.overflow)
      return fallback('overflow', 'Fixed request overhead exceeds available input');
    for (const record of ordered) {
      const next = measure(makePack(base, [...selected, record]), budget);
      if (next.status === 'unavailable')
        return fallback('unavailable-budget', next.error ?? 'No count');
      if (next.overflow) {
        if (record.status === 'unresolved' || record.status === 'revoked') {
          return fallback('overflow', 'Critical unresolved/revoked state cannot fit intact');
        }
        omittedRecordIds.push(record.id);
        continue;
      }
      selected.push(record);
      measurement = next;
    }
  } catch (error) {
    return fallback('budget-error', error instanceof Error ? error.message : String(error));
  }
  if (selected.length === 0) return fallback('overflow', 'No complete state record fits');
  return {
    schemaVersion: 1,
    condition: 'draft-oracle-state-only',
    mode: 'candidate',
    fallbackReason: null,
    detail: null,
    pack: makePack(base, selected),
    measurement,
    readerReserveTokens: budget.readerReserveTokens,
    selectedRecordIds: selected.map((record) => record.id),
    omittedRecordIds,
    state,
  };
}
