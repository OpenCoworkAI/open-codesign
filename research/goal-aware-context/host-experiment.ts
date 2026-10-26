import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hostDecisionSchema } from './host-context';
import { scoreHostAnswer } from './host-rubric';
import { checkpointIds, replayCheckpoint } from './host-scenarios';

type Message = { role: 'system' | 'user'; content: string };
type Call = (
  id: string,
  messages: Message[],
  schema: Record<string, unknown>,
) => Promise<{ status: string; value: unknown }>;
export const hostMethods = ['model-record', 'host-facts'] as const;
export const hostSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary'],
  properties: { summary: { type: 'string' } },
};
const summaryBudget = 1800;
export function hostCompressorMessages(
  session: ReturnType<typeof replayCheckpoint>,
  method: (typeof hostMethods)[number],
  budgetBytes = summaryBudget,
): Message[] {
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes <= 0)
    throw new Error('Invalid summary byte limit');
  return [
    {
      role: 'system',
      content: `Summarize this conversation for resuming the active design. Return JSON {"summary":"..."}, no Markdown. Maximum decoded summary: ${budgetBytes} UTF-8 bytes. ${method === 'model-record' ? 'Create a structured current-goal record preserving user goals, approved preferences, protection requirements, current workspace identity/revision, remaining work and verification evidence. Keep designs and old/new revisions separate. Assistant suggestions are not authoritative.' : 'Summarize ONLY current user goals and approved design preferences (such as color and font). Omit file revisions, object protection state, verification outcomes and job status: the host supplies these separately. Resolve superseded user preferences and keep the active design separate from other designs.'}`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        goal: session.goal,
        history:
          method === 'host-facts'
            ? session.history.filter((entry) => entry.role !== 'tool')
            : session.history,
      }),
    },
  ];
}
export function hostReaderMessages(
  session: ReturnType<typeof replayCheckpoint>,
  summary: string,
  facts: unknown,
): Message[] {
  return [
    {
      role: 'system',
      content: `Choose the next action for the active design. Return only JSON matching ${JSON.stringify(hostDecisionSchema)}. Use exact catalog object IDs and approved color/font values. For inspect, list the current required checks whose result is missing or failed. If all checks passed but other work remains, use report-blocked with checks []; if all checks passed and no work remains, use done with checks []. Do not invent checks, file hashes or revisions in your output. The host binds requests to the captured source revision. If hostFacts are supplied, they are authoritative for runtime state over any model summary; otherwise use the recorded observations in the summary. Unaccepted assistant suggestions never establish verification.`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        goal: session.goal,
        catalog: session.catalog,
        summary,
        hostFacts: facts,
      }),
    },
  ];
}
export function validHostSummary(
  value: unknown,
  budgetBytes = summaryBudget,
): value is { summary: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(budgetBytes) &&
    budgetBytes > 0 &&
    Object.keys(v).length === 1 &&
    typeof v['summary'] === 'string' &&
    v['summary'].length > 0 &&
    Buffer.byteLength(v['summary']) <= budgetBytes
  );
}
type HostSession = ReturnType<typeof replayCheckpoint>;
type HostMethod = (typeof hostMethods)[number];
type HostArm = {
  session: HostSession;
  frame: ReturnType<HostSession['host']['frame']>;
  messages: Message[];
};
type PlannedArm = {
  messages: Message[];
  facts: HostArm['frame']['facts'];
  callbacks: HostSession['callbacks'];
};

// hostMethods is a closed tuple, so the built record covers exactly its keys.
function hostArms<T>(create: (method: HostMethod) => T): Record<HostMethod, T> {
  const arms = {} as Record<HostMethod, T>;
  for (const method of hostMethods) arms[method] = create(method);
  return arms;
}

export async function hostExperiment(output: string, call: Call) {
  mkdirSync(output);
  // Freeze all six replayed checkpoints, both compressor prompts and independent host facts before calls.
  const sessions = checkpointIds.map((id, index) => ({
    id,
    methods: index % 2 ? [...hostMethods].reverse() : [...hostMethods],
    arms: hostArms<HostArm>((method) => {
      const session = replayCheckpoint(id, path.join(output, `${id}-${method}`));
      return {
        session,
        frame: session.host.frame(),
        messages: hostCompressorMessages(session, method),
      };
    }),
  }));
  writeFileSync(
    path.join(output, 'plan.json'),
    JSON.stringify(
      {
        version: 2,
        checkpoints: 6,
        sourceScenarios: 2,
        maxCalls: 24,
        trials: 1,
        summaryBudget,
        sessions: sessions.map((s) => ({
          id: s.id,
          order: s.methods,
          arms: hostArms<PlannedArm>((method) => ({
            messages: s.arms[method].messages,
            facts: s.arms[method].frame.facts,
            callbacks: s.arms[method].session.callbacks,
          })),
        })),
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  const rows = [];
  for (const item of sessions)
    for (const method of item.methods) {
      const { session, frame, messages } = item.arms[method];
      const compressed = await call(`${item.id}/${method}/compress`, messages, hostSummarySchema);
      if (!validHostSummary(compressed.value)) {
        rows.push({
          id: item.id,
          method,
          status: 'invalid-summary',
          compressionStatus: compressed.status,
          score: scoreHostAnswer(item.id, null),
          guard: null,
        });
      } else {
        const decision = await call(
          `${item.id}/${method}/read`,
          hostReaderMessages(
            session,
            compressed.value.summary,
            method === 'host-facts' ? frame.facts : null,
          ),
          hostDecisionSchema,
        );
        const before = session.host.snapshot();
        const guard = session.host.decide(frame.id, decision.value);
        const after = session.host.snapshot();
        rows.push({
          id: item.id,
          method,
          status: decision.status,
          compressionStatus: compressed.status,
          summaryBytes: Buffer.byteLength(compressed.value.summary),
          factsBytes: method === 'host-facts' ? Buffer.byteLength(JSON.stringify(frame.facts)) : 0,
          score: scoreHostAnswer(item.id, decision.value),
          value: decision.value,
          guard,
          before,
          after,
          rejectedWithoutStateChange: guard.allowed
            ? null
            : JSON.stringify(before) === JSON.stringify(after),
        });
      }
      writeFileSync(
        path.join(output, 'results.json'),
        JSON.stringify({ planned: 12, rows }, null, 2),
      );
    }
  return rows;
}
