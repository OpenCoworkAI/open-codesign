import type { ChatMessage } from '@open-codesign/shared';
export interface SummarySource {
  goal: string;
  history: unknown;
}
export const summaryBudget: number;
export const summarySchema: Record<string, unknown>;
export function compressorMessages(
  source: SummarySource,
  method: 'ordinary-summary' | 'goal-record',
  budgetBytes?: number,
): ChatMessage[];
export function readerMessages(goal: string, context: unknown): ChatMessage[];
export function validSummary(value: unknown, budgetBytes?: number): value is { summary: string };
export function contextPlan(): unknown[];
export function contextExperiment(
  output: string,
  call: (
    id: string,
    messages: ChatMessage[],
    schema: unknown,
  ) => Promise<{ status: string; value: unknown }>,
): Promise<unknown[]>;
