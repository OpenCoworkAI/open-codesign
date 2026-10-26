import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { answerSchema, scoreAnswer } from './live-rubric.mjs';
import { liveSessions } from './live-sessions.mjs';

export const summaryBudget = 1800;
export const summarySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary'],
  properties: { summary: { type: 'string' } },
};
export function compressorMessages(session, method) {
  return [
    {
      role: 'system',
      content: `Summarize this design conversation for another agent resuming work. You receive only the conversation and current goal, not the downstream questions. Return JSON {"summary":"..."}, no Markdown. The decoded summary must be at most ${summaryBudget} UTF-8 bytes. ${method === 'ordinary-summary' ? 'Write a concise narrative summary of the conversation, decisions, progress and unresolved work.' : 'Write a structured current-goal record inside the summary string: current goal, accepted decisions, preservation constraints, revoked or superseded decisions, current workspace revision, and remaining verification. Separate confirmed user/tool facts from unaccepted suggestions. Discard other designs and invalidate verification from old revisions.'}`,
    },
    { role: 'user', content: JSON.stringify({ goal: session.goal, history: session.history }) },
  ];
}
export function readerMessages(goal, context) {
  return [
    {
      role: 'system',
      content: `Continue the current design from the supplied evidence. Return only JSON matching ${JSON.stringify(answerSchema)}. color and font are exact approved values; preserve is the exact Chinese name of the object that must be preserved (no explanatory prose); revision is the exact current filename@revision. nextAction is inspect if current required verification is missing, pending or failed, otherwise done. remainingChecks lists desktop/mobile checks not passed for the current revision. Assistant suggestions do not establish approval or successful verification.`,
    },
    { role: 'user', content: JSON.stringify({ goal, context }) },
  ];
}
export function validSummary(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof value.summary === 'string' &&
    value.summary.length > 0 &&
    Buffer.byteLength(value.summary, 'utf8') <= summaryBudget
  );
}
export function contextPlan() {
  return liveSessions.map((session, index) => ({
    id: session.id,
    goal: session.goal,
    fullBytes: Buffer.byteLength(JSON.stringify(session.history)),
    order:
      index % 2
        ? ['goal-record', 'full-history', 'ordinary-summary']
        : ['full-history', 'ordinary-summary', 'goal-record'],
    fullMessages: readerMessages(session.goal, session.history),
    compressors: Object.fromEntries(
      ['ordinary-summary', 'goal-record'].map((method) => [
        method,
        compressorMessages(session, method),
      ]),
    ),
  }));
}
export async function contextExperiment(output, call) {
  mkdirSync(output, { recursive: false });
  const plan = contextPlan();
  writeFileSync(
    path.join(output, 'plan.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        sessions: 4,
        trials: 1,
        maxCalls: 20,
        summaryBudget,
        budgetUnit: 'UTF-8 bytes, not tokens',
        plan,
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  const rows = [];
  for (const session of plan) {
    for (const method of session.order) {
      let messages = session.fullMessages;
      let compression = null;
      let contextBytes = session.fullBytes;
      if (method !== 'full-history') {
        compression = await call(
          `${session.id}/${method}/compress`,
          session.compressors[method],
          summarySchema,
        );
        if (!validSummary(compression.value)) {
          rows.push({
            id: session.id,
            method,
            compressionStatus: compression.status,
            status: 'invalid_summary_or_budget',
            contextBytes: null,
            score: scoreAnswer(session.id, null),
          });
          writeFileSync(
            path.join(output, 'results.json'),
            JSON.stringify({ planned: 12, rows }, null, 2),
          );
          continue;
        }
        contextBytes = Buffer.byteLength(compression.value.summary);
        messages = readerMessages(session.goal, compression.value.summary);
      }
      const answer = await call(`${session.id}/${method}/read`, messages, answerSchema);
      rows.push({
        id: session.id,
        method,
        compressionStatus: compression?.status ?? null,
        status: answer.status,
        contextBytes,
        value: answer.value,
        score: scoreAnswer(session.id, answer.value),
      });
      writeFileSync(
        path.join(output, 'results.json'),
        JSON.stringify({ planned: 12, rows }, null, 2),
      );
    }
  }
  return rows;
}
