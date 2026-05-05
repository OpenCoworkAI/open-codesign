import { completeWithRetry } from '@open-codesign/providers';
import type {
  ChatMessage,
  DesignRunPreferenceConfidence,
  DesignRunPreferenceMode,
  DesignRunPreferenceProvenance,
  DesignRunPreferencesV1,
  ModelRef,
  ReasoningLevel,
  WireApi,
} from '@open-codesign/shared';
import { remapProviderError } from './errors.js';
import { type CoreLogger, NOOP_LOGGER } from './logger.js';
import type { AskInput } from './tools/ask.js';

const ROUTER_MAX_OUTPUT_TOKENS = 1_000;
const MODES = new Set<DesignRunPreferenceMode>(['yes', 'no', 'auto']);
const PROVENANCES = new Set<DesignRunPreferenceProvenance>(['explicit', 'inferred', 'default']);
const CONFIDENCES = new Set<DesignRunPreferenceConfidence>(['high', 'medium', 'low']);
const VISUAL_DIRECTIONS = new Set(['editorial', 'professional', 'bold', 'custom']);

export const DEFAULT_RUN_PREFERENCES: DesignRunPreferencesV1 = {
  schemaVersion: 1,
  tweaks: 'auto',
  bitmapAssets: 'auto',
  reusableSystem: 'auto',
  routing: {
    tweaks: { provenance: 'default', confidence: 'low' },
    bitmapAssets: { provenance: 'default', confidence: 'low' },
    reusableSystem: { provenance: 'default', confidence: 'low' },
  },
};

export const RUN_PREFERENCES_ROUTER_SYSTEM_PROMPT = [
  'You route Open CoDesign run preferences from semantic intent.',
  'Output ONLY valid JSON. No markdown.',
  '',
  'Return shape:',
  '{',
  '  "preferences": {',
  '    "tweaks": "yes" | "no" | "auto",',
  '    "bitmapAssets": "yes" | "no" | "auto",',
  '    "reusableSystem": "yes" | "no" | "auto",',
  '    "visualDirection"?: "editorial" | "professional" | "bold" | "custom",',
  '    "routing": { "<field>": { "provenance": "explicit" | "inferred" | "default", "confidence": "high" | "medium" | "low", "reason"?: string } }',
  '  },',
  '  "needsClarification": boolean,',
  '  "clarificationQuestions"?: AskInput["questions"]',
  '}',
  '',
  'Rules:',
  '- Use explicit only when the user clearly asked for or refused a capability.',
  '- Use inferred for likely intent from task context; use default for no evidence.',
  '- Prefer auto when unsure; do not over-route.',
  '- Ask clarification only for high-impact ambiguity that would materially change the run.',
].join('\n');

interface RunPreferenceRouterModelInput {
  model: ModelRef;
  apiKey: string;
  baseUrl?: string | undefined;
  wire?: WireApi | undefined;
  httpHeaders?: Record<string, string> | undefined;
  allowKeyless?: boolean | undefined;
  reasoningLevel?: ReasoningLevel | undefined;
  logger?: CoreLogger | undefined;
}

export interface RouteRunPreferencesInput extends RunPreferenceRouterModelInput {
  prompt: string;
  existingPreferences: DesignRunPreferencesV1 | null;
  recentHistory?: string | undefined;
  workspaceState?: Record<string, unknown> | undefined;
  designBrief?: string | null | undefined;
  userMemory?: string | null | undefined;
  workspaceMemory?: string | null | undefined;
}

export interface RouteRunPreferencesResult {
  preferences: DesignRunPreferencesV1;
  needsClarification: boolean;
  clarificationQuestions?: AskInput['questions'];
}

export function defaultRunPreferences(): DesignRunPreferencesV1 {
  return JSON.parse(JSON.stringify(DEFAULT_RUN_PREFERENCES)) as DesignRunPreferencesV1;
}

function fieldRouting(
  raw: unknown,
  fallback?: { provenance?: string; confidence?: string; reason?: string | undefined },
): {
  provenance: DesignRunPreferenceProvenance;
  confidence: DesignRunPreferenceConfidence;
  reason?: string;
} {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const provenanceRaw = record['provenance'] ?? fallback?.provenance;
  const confidenceRaw = record['confidence'] ?? fallback?.confidence;
  const provenance = PROVENANCES.has(provenanceRaw as DesignRunPreferenceProvenance)
    ? (provenanceRaw as DesignRunPreferenceProvenance)
    : 'default';
  const confidence = CONFIDENCES.has(confidenceRaw as DesignRunPreferenceConfidence)
    ? (confidenceRaw as DesignRunPreferenceConfidence)
    : 'low';
  const reasonRaw = record['reason'] ?? fallback?.reason;
  return {
    provenance,
    confidence,
    ...(typeof reasonRaw === 'string' && reasonRaw.trim().length > 0
      ? { reason: reasonRaw.trim().slice(0, 300) }
      : {}),
  };
}

function mode(raw: unknown, fallback: DesignRunPreferenceMode): DesignRunPreferenceMode {
  return MODES.has(raw as DesignRunPreferenceMode) ? (raw as DesignRunPreferenceMode) : fallback;
}

function visualDirection(raw: unknown, fallback: DesignRunPreferencesV1['visualDirection']) {
  return VISUAL_DIRECTIONS.has(raw as string)
    ? (raw as DesignRunPreferencesV1['visualDirection'])
    : fallback;
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return JSON.parse(fenced?.[1] ?? trimmed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeQuestions(raw: unknown): AskInput['questions'] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const questions: AskInput['questions'] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = item['id'];
    const type = item['type'];
    const prompt = item['prompt'];
    if (typeof id !== 'string' || typeof prompt !== 'string') continue;
    if (type === 'text-options') {
      const options = Array.isArray(item['options'])
        ? item['options'].filter((option): option is string => typeof option === 'string')
        : [];
      if (options.length >= 2) questions.push({ id, type, prompt, options });
    } else if (type === 'freeform') {
      questions.push({ id, type, prompt });
    }
    if (questions.length >= 4) break;
  }
  return questions.length > 0 ? questions : undefined;
}

export function normalizeRunPreferencesRouterResult(
  raw: unknown,
  fallback: DesignRunPreferencesV1 | null,
): RouteRunPreferencesResult {
  if (!isRecord(raw)) {
    return { preferences: fallback ?? defaultRunPreferences(), needsClarification: false };
  }
  const fallbackPrefs = fallback ?? defaultRunPreferences();
  const prefsRaw = isRecord(raw['preferences']) ? raw['preferences'] : {};
  const routingRaw = isRecord(prefsRaw['routing']) ? prefsRaw['routing'] : {};
  const fallbackRouting = fallbackPrefs.routing ?? {};
  const preferences: DesignRunPreferencesV1 = {
    schemaVersion: 1,
    tweaks: mode(prefsRaw['tweaks'], fallbackPrefs.tweaks),
    bitmapAssets: mode(prefsRaw['bitmapAssets'], fallbackPrefs.bitmapAssets),
    reusableSystem: mode(prefsRaw['reusableSystem'], fallbackPrefs.reusableSystem),
    routing: {
      tweaks: fieldRouting(routingRaw['tweaks'], fallbackRouting.tweaks),
      bitmapAssets: fieldRouting(routingRaw['bitmapAssets'], fallbackRouting.bitmapAssets),
      reusableSystem: fieldRouting(routingRaw['reusableSystem'], fallbackRouting.reusableSystem),
    },
  };
  const vd = visualDirection(prefsRaw['visualDirection'], fallbackPrefs.visualDirection);
  if (vd !== undefined) {
    preferences.visualDirection = vd;
    preferences.routing = {
      ...preferences.routing,
      visualDirection: fieldRouting(routingRaw['visualDirection'], fallbackRouting.visualDirection),
    };
  }
  const clarificationQuestions = normalizeQuestions(raw['clarificationQuestions']);
  return {
    preferences,
    needsClarification: raw['needsClarification'] === true && clarificationQuestions !== undefined,
    ...(clarificationQuestions !== undefined ? { clarificationQuestions } : {}),
  };
}

export function applyRunPreferenceAnswers(
  base: DesignRunPreferencesV1,
  answers: Array<{ questionId: string; value: string | number | string[] | null }>,
): DesignRunPreferencesV1 {
  const next: DesignRunPreferencesV1 = JSON.parse(JSON.stringify(base)) as DesignRunPreferencesV1;
  const routing = { ...(next.routing ?? {}) };
  for (const answer of answers) {
    const value = typeof answer.value === 'string' ? answer.value : null;
    if (value === null) continue;
    if (answer.questionId === 'tweaks' && MODES.has(value as DesignRunPreferenceMode)) {
      next.tweaks = value as DesignRunPreferenceMode;
      routing.tweaks = { provenance: 'explicit', confidence: 'high' };
    } else if (
      answer.questionId === 'bitmapAssets' &&
      MODES.has(value as DesignRunPreferenceMode)
    ) {
      next.bitmapAssets = value as DesignRunPreferenceMode;
      routing.bitmapAssets = { provenance: 'explicit', confidence: 'high' };
    } else if (
      answer.questionId === 'reusableSystem' &&
      MODES.has(value as DesignRunPreferenceMode)
    ) {
      next.reusableSystem = value as DesignRunPreferenceMode;
      routing.reusableSystem = { provenance: 'explicit', confidence: 'high' };
    } else if (answer.questionId === 'visualDirection' && VISUAL_DIRECTIONS.has(value)) {
      next.visualDirection = value as DesignRunPreferencesV1['visualDirection'];
      routing.visualDirection = { provenance: 'explicit', confidence: 'high' };
    }
  }
  next.routing = routing;
  return next;
}

export function runPreferencesFromJson(
  rawContent: string,
  fallback: DesignRunPreferencesV1 | null,
): RouteRunPreferencesResult {
  try {
    return normalizeRunPreferencesRouterResult(parseJsonObject(rawContent), fallback);
  } catch {
    return { preferences: fallback ?? defaultRunPreferences(), needsClarification: false };
  }
}

export async function routeRunPreferences(
  input: RouteRunPreferencesInput,
): Promise<RouteRunPreferencesResult> {
  const log = input.logger ?? NOOP_LOGGER;
  const fallback = input.existingPreferences ?? defaultRunPreferences();
  const userContent = [
    '## Current prompt',
    input.prompt,
    '',
    '## Existing run preferences',
    JSON.stringify(input.existingPreferences ?? null, null, 2),
    '',
    '## Recent history',
    input.recentHistory ?? '(none)',
    '',
    '## Workspace state',
    JSON.stringify(input.workspaceState ?? {}, null, 2),
    '',
    '## Design brief',
    input.designBrief ?? '(none)',
    '',
    '## User memory',
    input.userMemory ?? '(none)',
    '',
    '## Workspace memory',
    input.workspaceMemory ?? '(none)',
    '',
    'Return JSON now.',
  ].join('\n');
  try {
    const result = await completeWithRetry(
      input.model,
      [
        { role: 'system', content: RUN_PREFERENCES_ROUTER_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ] satisfies ChatMessage[],
      {
        apiKey: input.apiKey,
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
        ...(input.wire !== undefined ? { wire: input.wire } : {}),
        ...(input.httpHeaders !== undefined ? { httpHeaders: input.httpHeaders } : {}),
        ...(input.allowKeyless === true ? { allowKeyless: true } : {}),
        ...(input.reasoningLevel !== undefined ? { reasoning: input.reasoningLevel } : {}),
        maxTokens: ROUTER_MAX_OUTPUT_TOKENS,
      },
      {
        logger: log,
        provider: input.model.provider,
        ...(input.wire !== undefined ? { wire: input.wire } : {}),
      },
    );
    return runPreferencesFromJson(result.content, fallback);
  } catch (err) {
    log.warn('[run-preferences-router] fail', {
      message: err instanceof Error ? err.message : String(err),
    });
    const remapped = remapProviderError(err, input.model.provider, input.wire);
    log.warn('[run-preferences-router] fallback', {
      message: remapped instanceof Error ? remapped.message : String(remapped),
    });
    return { preferences: fallback, needsClarification: false };
  }
}
