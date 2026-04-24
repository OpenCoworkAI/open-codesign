import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { type Static, Type } from '@sinclair/typebox';

/**
 * `ask` tool (T3.1). Renders a structured questionnaire to the user
 * and ends the agent's turn until the answers come back. Five question
 * types per docs/v0.2-plan.md §3.
 *
 * Wire format only — execution lives in the renderer's <AskModal />.
 * The main-process IPC bridge resolves the agent's pending tool call
 * with the user's answers (or a `cancelled` marker).
 */

export const TextOptionQuestion = Type.Object({
  id: Type.String(),
  type: Type.Literal('text-options'),
  prompt: Type.String(),
  options: Type.Array(Type.String(), { minItems: 2 }),
  multi: Type.Optional(Type.Boolean()),
});
export type TextOptionQuestion = Static<typeof TextOptionQuestion>;

export const SvgOptionQuestion = Type.Object({
  id: Type.String(),
  type: Type.Literal('svg-options'),
  prompt: Type.String(),
  options: Type.Array(
    Type.Object({ id: Type.String(), label: Type.String(), svg: Type.String() }),
    { minItems: 2 },
  ),
});
export type SvgOptionQuestion = Static<typeof SvgOptionQuestion>;

export const SliderQuestion = Type.Object({
  id: Type.String(),
  type: Type.Literal('slider'),
  prompt: Type.String(),
  min: Type.Number(),
  max: Type.Number(),
  step: Type.Number(),
  default: Type.Optional(Type.Number()),
  unit: Type.Optional(Type.String()),
});
export type SliderQuestion = Static<typeof SliderQuestion>;

export const FileQuestion = Type.Object({
  id: Type.String(),
  type: Type.Literal('file'),
  prompt: Type.String(),
  accept: Type.Optional(Type.Array(Type.String())),
  multiple: Type.Optional(Type.Boolean()),
});
export type FileQuestion = Static<typeof FileQuestion>;

export const FreeformQuestion = Type.Object({
  id: Type.String(),
  type: Type.Literal('freeform'),
  prompt: Type.String(),
  placeholder: Type.Optional(Type.String()),
  multiline: Type.Optional(Type.Boolean()),
});
export type FreeformQuestion = Static<typeof FreeformQuestion>;

export const AskQuestion = Type.Union([
  TextOptionQuestion,
  SvgOptionQuestion,
  SliderQuestion,
  FileQuestion,
  FreeformQuestion,
]);
export type AskQuestion = Static<typeof AskQuestion>;

export const AskInput = Type.Object({
  questions: Type.Array(AskQuestion, { minItems: 1, maxItems: 25 }),
  rationale: Type.Optional(Type.String()),
});
export type AskInput = Static<typeof AskInput>;

export const AskAnswer = Type.Object({
  questionId: Type.String(),
  value: Type.Union([Type.String(), Type.Number(), Type.Array(Type.String()), Type.Null()]),
});
export type AskAnswer = Static<typeof AskAnswer>;

export const AskResult = Type.Object({
  status: Type.Union([Type.Literal('answered'), Type.Literal('cancelled')]),
  answers: Type.Array(AskAnswer),
});
export type AskResult = Static<typeof AskResult>;

/**
 * Pure validation helper — used by both the runtime tool and tests.
 * Confirms the wire-format shape; UI is responsible for rendering.
 */
export function validateAskInput(input: unknown): { ok: true } | { ok: false; reason: string } {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'not an object' };
  const obj = input as { questions?: unknown };
  if (!Array.isArray(obj.questions)) return { ok: false, reason: 'questions must be an array' };
  if (obj.questions.length === 0) return { ok: false, reason: 'at least one question required' };
  if (obj.questions.length > 25) return { ok: false, reason: 'at most 25 questions per turn' };
  return { ok: true };
}

export type AskBridge = (input: AskInput) => Promise<AskResult>;

export function makeAskTool(askBridge: AskBridge): AgentTool<typeof AskInput, AskResult> {
  return {
    name: 'ask',
    label: 'Ask',
    description:
      'Render a structured questionnaire (1–25 questions, 5 types: text-options / ' +
      'svg-options / slider / file / freeform) to the user and wait for answers. ' +
      'Use BEFORE implementing when the request is ambiguous or when aesthetic / ' +
      "content direction is unclear. Returns `{status: 'answered', answers}` or " +
      "`{status: 'cancelled', answers: []}`.",
    parameters: AskInput,
    async execute(_toolCallId, params): Promise<AgentToolResult<AskResult>> {
      const valid = validateAskInput(params);
      if (!valid.ok) {
        return {
          content: [{ type: 'text', text: `ask: invalid input — ${valid.reason}` }],
          details: { status: 'cancelled', answers: [] },
        };
      }
      const result = await askBridge(params);
      const summary =
        result.status === 'answered'
          ? `user answered ${result.answers.length} question(s)`
          : 'user cancelled';
      return {
        content: [{ type: 'text', text: summary }],
        details: result,
      };
    },
  };
}
