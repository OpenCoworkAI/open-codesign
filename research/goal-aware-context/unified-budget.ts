import {
  type BudgetMeasurement,
  type CompleteModelInput,
  estimateUtf8QuarterTokens,
  measureRequest,
  type TokenCounter,
} from './budget.js';
import type { UnifiedConfig } from './unified-config.js';
import type { UnifiedCallResult } from './unified-session.js';

export type UnifiedCounters = Partial<Record<'compressor' | 'reader', TokenCounter>>;
export interface RequestCheck {
  status: 'within-budget' | 'overflow' | 'unavailable-budget';
  measurements: BudgetMeasurement[];
}
export function requestChecks(
  requests: CompleteModelInput[],
  role: 'compressor' | 'reader',
  tier: number | null,
  config: UnifiedConfig,
  counters: UnifiedCounters = {},
): RequestCheck {
  const target = config.models[role];
  let counter =
    counters[role] ?? (config.allowEstimatedBudget ? estimateUtf8QuarterTokens : undefined);
  if (counter?.unit === 'estimate' && !config.allowEstimatedBudget) counter = undefined;
  const limit = Math.min(
    tier ?? target.contextWindowTokens,
    target.contextWindowTokens - config.maxOutputTokens,
  );
  const measurements = requests.map((request) => {
    try {
      return measureRequest(
        request,
        {
          inputBudgetTokens: tier ?? target.contextWindowTokens,
          contextWindowTokens: target.contextWindowTokens,
          reservedOutputTokens: config.maxOutputTokens,
        },
        counter,
      );
    } catch {
      return {
        unit: 'unavailable' as const,
        count: null,
        counterId: counter?.id ?? 'unavailable@1',
        overflow: false,
        status: 'unavailable' as const,
        inputLimitTokens: limit,
        error: 'counter-or-envelope-error',
      };
    }
  });
  return {
    status: measurements.some((m) => m.status === 'unavailable')
      ? 'unavailable-budget'
      : measurements.some((m) => m.overflow)
        ? 'overflow'
        : 'within-budget',
    measurements,
  };
}
export function reportedOverflow(
  row: UnifiedCallResult,
  check: RequestCheck,
  role: 'compressor' | 'reader',
  config: UnifiedConfig,
): boolean {
  const usage = row.usage;
  if (!usage) return false;
  const input = usage.reportedInputTokens,
    output = usage.reportedOutputTokens;
  const limit = check.measurements[0]?.inputLimitTokens ?? 0;
  return (
    (input !== null && input > limit) ||
    (output !== null && output > config.maxOutputTokens) ||
    (input !== null && output !== null && input + output > config.models[role].contextWindowTokens)
  );
}
