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
  const obj = input as Record<string, unknown>;
  const unsupportedField = Object.keys(obj).find(
    (key) => key !== 'questions' && key !== 'rationale',
  );
  if (unsupportedField !== undefined) {
    return { ok: false, reason: `unsupported field: ${unsupportedField}` };
  }
  if (obj['rationale'] !== undefined && typeof obj['rationale'] !== 'string') {
    return { ok: false, reason: 'rationale must be a string' };
  }
  const questions = obj['questions'];
  if (!Array.isArray(questions)) return { ok: false, reason: 'questions must be an array' };
  if (questions.length === 0) return { ok: false, reason: 'at least one question required' };
  if (questions.length > 25) return { ok: false, reason: 'at most 25 questions per turn' };
  const ids = new Set<string>();
  for (const [index, question] of questions.entries()) {
    const result = validateAskQuestion(question);
    if (!result.ok) return { ok: false, reason: `question ${index + 1}: ${result.reason}` };
    if (ids.has(result.id)) return { ok: false, reason: `duplicate question id: ${result.id}` };
    ids.add(result.id);
  }
  return { ok: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateStringArray(value: unknown, minItems: number): boolean {
  return (
    Array.isArray(value) && value.length >= minItems && value.every((item) => nonEmptyString(item))
  );
}

function assertKnownQuestionFields(
  question: Record<string, unknown>,
  fields: readonly string[],
): { ok: true } | { ok: false; reason: string } {
  const unsupported = Object.keys(question).find((key) => !fields.includes(key));
  return unsupported === undefined
    ? { ok: true }
    : { ok: false, reason: `unsupported field: ${unsupported}` };
}

function validateAskQuestion(
  question: unknown,
): { ok: true; id: string } | { ok: false; reason: string } {
  if (!isRecord(question)) return { ok: false, reason: 'must be an object' };
  const id = question['id'];
  if (!nonEmptyString(id)) return { ok: false, reason: 'id must be a non-empty string' };
  if (!nonEmptyString(question['prompt'])) {
    return { ok: false, reason: 'prompt must be a non-empty string' };
  }
  switch (question['type']) {
    case 'text-options': {
      const known = assertKnownQuestionFields(question, [
        'id',
        'type',
        'prompt',
        'options',
        'multi',
      ]);
      if (!known.ok) return known;
      if (!validateStringArray(question['options'], 2)) {
        return { ok: false, reason: 'text-options requires at least two string options' };
      }
      if (question['multi'] !== undefined && typeof question['multi'] !== 'boolean') {
        return { ok: false, reason: 'multi must be a boolean' };
      }
      return { ok: true, id };
    }
    case 'svg-options': {
      const known = assertKnownQuestionFields(question, ['id', 'type', 'prompt', 'options']);
      if (!known.ok) return known;
      const options = question['options'];
      if (!Array.isArray(options) || options.length < 2) {
        return { ok: false, reason: 'svg-options requires at least two options' };
      }
      for (const option of options) {
        if (
          !isRecord(option) ||
          !nonEmptyString(option['id']) ||
          !nonEmptyString(option['label']) ||
          !nonEmptyString(option['svg'])
        ) {
          return {
            ok: false,
            reason: 'svg-options entries require id, label, and svg strings',
          };
        }
      }
      return { ok: true, id };
    }
    case 'slider': {
      const known = assertKnownQuestionFields(question, [
        'id',
        'type',
        'prompt',
        'min',
        'max',
        'step',
        'default',
        'unit',
      ]);
      if (!known.ok) return known;
      const min = question['min'];
      const max = question['max'];
      const step = question['step'];
      if (
        typeof min !== 'number' ||
        typeof max !== 'number' ||
        typeof step !== 'number' ||
        !Number.isFinite(min) ||
        !Number.isFinite(max) ||
        !Number.isFinite(step) ||
        min >= max ||
        step <= 0
      ) {
        return { ok: false, reason: 'slider requires finite min < max and step > 0' };
      }
      if (
        question['default'] !== undefined &&
        (typeof question['default'] !== 'number' ||
          !Number.isFinite(question['default']) ||
          question['default'] < min ||
          question['default'] > max)
      ) {
        return { ok: false, reason: 'slider default must be between min and max' };
      }
      if (question['unit'] !== undefined && typeof question['unit'] !== 'string') {
        return { ok: false, reason: 'slider unit must be a string' };
      }
      return { ok: true, id };
    }
    case 'file': {
      const known = assertKnownQuestionFields(question, [
        'id',
        'type',
        'prompt',
        'accept',
        'multiple',
      ]);
      if (!known.ok) return known;
      if (question['accept'] !== undefined && !validateStringArray(question['accept'], 1)) {
        return { ok: false, reason: 'file accept must be a non-empty string array' };
      }
      if (question['multiple'] !== undefined && typeof question['multiple'] !== 'boolean') {
        return { ok: false, reason: 'file multiple must be a boolean' };
      }
      return { ok: true, id };
    }
    case 'freeform': {
      const known = assertKnownQuestionFields(question, [
        'id',
        'type',
        'prompt',
        'placeholder',
        'multiline',
      ]);
      if (!known.ok) return known;
      if (question['placeholder'] !== undefined && typeof question['placeholder'] !== 'string') {
        return { ok: false, reason: 'placeholder must be a string' };
      }
      if (question['multiline'] !== undefined && typeof question['multiline'] !== 'boolean') {
        return { ok: false, reason: 'multiline must be a boolean' };
      }
      return { ok: true, id };
    }
    default:
      return { ok: false, reason: 'type must be a known ask question type' };
  }
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
