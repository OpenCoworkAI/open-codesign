export interface UsageRecord {
  designId: string;
  startedAt: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface UsageBudget {
  design: UsageTotals;
  today: UsageTotals;
  week: UsageTotals;
}

function startOfLocalDay(now: number): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** The next local midnight after now. Monday 00:00 is the week boundary too. */
export function nextLocalMidnight(now: number): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

/** Local weeks start on Monday. */
function startOfLocalWeek(now: number): number {
  const date = new Date(now);
  const daysSinceMonday = (date.getDay() + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysSinceMonday).getTime();
}

function add(total: UsageTotals, record: UsageRecord): void {
  total.inputTokens += record.inputTokens;
  total.outputTokens += record.outputTokens;
  total.costUsd += record.costUsd;
}

export function summarizeUsageBudget(
  records: readonly UsageRecord[],
  designId: string,
  now: number,
): UsageBudget {
  const design: UsageTotals = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const today: UsageTotals = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const week: UsageTotals = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const dayStart = startOfLocalDay(now);
  const weekStart = startOfLocalWeek(now);
  for (const record of records) {
    if (record.designId !== designId || !Number.isFinite(record.startedAt)) continue;
    add(design, record);
    if (record.startedAt > now) continue;
    if (record.startedAt >= weekStart) add(week, record);
    if (record.startedAt >= dayStart) add(today, record);
  }
  return { design, today, week };
}

export function formatUsageTokens(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

export function formatUsageCost(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0';
  const digits = value >= 1 ? 2 : value >= 0.01 ? 4 : 6;
  const text = value
    .toFixed(digits)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
  return `$${text}`;
}
