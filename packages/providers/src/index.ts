/**
 * Wrappers around @mariozechner/pi-ai that fill capability gaps documented
 * in docs/research/05-pi-ai-boundary.md. App code MUST go through this
 * package - never import a provider SDK directly.
 *
 * Tier 1 implementations: minimum viable. Tier 2 features tracked separately.
 */

import { type ChatMessage, CodesignError, type ModelRef } from '@open-codesign/shared';

/** Subset of pi-ai's `ThinkingLevel` we expose. Maps directly to its `reasoning`
 * field, which Anthropic adapters translate to extended-thinking effort/budget
 * (and OpenAI/Gemini adapters translate to their respective reasoning knobs).
 *
 * Only the named effort levels pi-ai actually understands. Sending this to a
 * non-reasoning model is a silent fallback, so callers must whitelist
 * known-capable models before passing a value (see `reasoningForModel`). */
export type ReasoningLevel = 'low' | 'medium' | 'high' | 'xhigh';

export interface GenerateOptions {
  apiKey: string;
  baseUrl?: string;
  signal?: AbortSignal;
  /** Hard cap on output tokens. When omitted, pi-ai falls back to ~1/3 of
   *  the model's context window. */
  maxTokens?: number;
  /** When set, asks the provider to "think before answering". On Anthropic
   *  Claude 4.x models this enables extended thinking; on OpenAI/Gemini it
   *  maps to their reasoning effort. Older/non-reasoning models ignore it. */
  reasoning?: ReasoningLevel;
}

export interface GenerateResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface PiTextContent {
  type: 'text';
  text: string;
}

interface PiUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

interface PiUserMessage {
  role: 'user';
  content: string | PiTextContent[];
  timestamp: number;
}

interface PiAssistantMessage {
  role: 'assistant';
  content: Array<{ type: string; text?: string }>;
  api: string;
  provider: string;
  model: string;
  usage: PiUsage;
  stopReason: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';
  errorMessage?: string;
  timestamp: number;
}

interface PiContext {
  systemPrompt?: string;
  messages: Array<PiUserMessage | PiAssistantMessage>;
}

interface PiModel {
  id: string;
  api: string;
  provider: string;
  name?: string;
  baseUrl?: string;
  reasoning?: boolean;
  input?: string[];
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow?: number;
  maxTokens?: number;
}

/**
 * OpenRouter is a pass-through gateway whose catalog grows faster than pi-ai's
 * generated registry. When a model id is unknown to pi-ai, we synthesize a
 * Model object so the request can still go through. Defaults match pi-ai's
 * shape for OpenRouter entries (verified against 0.67.68).
 *
 * Notes:
 *  - reasoning: true lets upstream try reasoning; the retry layer self-heals
 *    on 400 "not supported" responses.
 *  - contextWindow / maxTokens are best-effort; pi-ai uses them for budgeting,
 *    not validation.
 *  - cost zeroed because we don't know it; only display is affected.
 */
function synthesizeOpenRouterModel(modelId: string): PiModel {
  return {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131072,
    maxTokens: 131072,
  };
}

const EMPTY_USAGE: PiUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

/**
 * Single non-streaming completion. Tier 1: thin shim, no caching, no retry.
 * Tier 2 will swap to pi-ai's streaming API and emit ArtifactEvents directly.
 *
 * Lazy-imports pi-ai so the bundle is not loaded at app startup.
 */
export async function complete(
  model: ModelRef,
  messages: ChatMessage[],
  opts: GenerateOptions,
): Promise<GenerateResult> {
  if (!opts.apiKey) {
    throw new CodesignError('Missing API key', 'PROVIDER_AUTH_MISSING');
  }

  const pi = (await import('@mariozechner/pi-ai')) as unknown as {
    getModel: (provider: string, modelId: string) => PiModel | undefined;
    completeSimple: (
      model: PiModel,
      context: PiContext,
      opts: {
        apiKey: string;
        baseUrl?: string;
        signal?: AbortSignal;
        maxTokens?: number;
        reasoning?: ReasoningLevel;
      },
    ) => Promise<PiAssistantMessage>;
  };

  let piModel = pi.getModel(model.provider, model.modelId);
  if (!piModel) {
    if (model.provider === 'openrouter') {
      piModel = synthesizeOpenRouterModel(model.modelId);
    } else {
      throw new CodesignError(
        `Unknown model ${model.provider}:${model.modelId}`,
        'PROVIDER_MODEL_UNKNOWN',
      );
    }
  }

  const piOpts: {
    apiKey: string;
    baseUrl?: string;
    signal?: AbortSignal;
    maxTokens?: number;
    reasoning?: ReasoningLevel;
  } = {
    apiKey: opts.apiKey,
  };
  if (opts.baseUrl !== undefined) piOpts.baseUrl = opts.baseUrl;
  if (opts.signal !== undefined) piOpts.signal = opts.signal;
  if (opts.maxTokens !== undefined) piOpts.maxTokens = opts.maxTokens;
  if (opts.reasoning !== undefined) piOpts.reasoning = opts.reasoning;

  const result = await pi.completeSimple(piModel, toPiContext(messages, piModel), piOpts);

  if (result.stopReason === 'error') {
    throw new CodesignError(result.errorMessage ?? 'Provider returned an error', 'PROVIDER_ERROR');
  }

  const text = result.content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text ?? '')
    .join('');

  return {
    content: text,
    inputTokens: result.usage?.input ?? 0,
    outputTokens: result.usage?.output ?? 0,
    costUsd: result.usage?.cost?.total ?? 0,
  };
}

function toPiContext(messages: ChatMessage[], model: PiModel): PiContext {
  const systemPrompt = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter((content) => content.length > 0)
    .join('\n\n');

  return {
    ...(systemPrompt.length > 0 ? { systemPrompt } : {}),
    messages: messages.flatMap((message, index) => {
      const timestamp = index + 1;

      if (message.role === 'system') {
        return [];
      }

      if (message.role === 'user') {
        return {
          role: 'user',
          content: message.content,
          timestamp,
        };
      }

      return {
        role: 'assistant',
        content:
          message.content.trim().length === 0 ? [] : [{ type: 'text', text: message.content }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: EMPTY_USAGE,
        stopReason: 'stop',
        timestamp,
      };
    }),
  };
}

/**
 * Detect API provider from a pasted key prefix. Used by the onboarding flow
 * to spare the user from picking a provider manually.
 */
export function detectProviderFromKey(key: string): ModelRef['provider'] | null {
  const trimmed = key.trim();
  if (trimmed.startsWith('sk-ant-')) return 'anthropic';
  if (trimmed.startsWith('sk-or-')) return 'openrouter';
  if (trimmed.startsWith('sk-')) return 'openai';
  if (trimmed.startsWith('AIza')) return 'google';
  if (trimmed.startsWith('xai-')) return 'xai';
  if (trimmed.startsWith('gsk_')) return 'groq';
  return null;
}

export { pingProvider } from './validate';
export type { ValidateResult } from './validate';

export { completeWithRetry, classifyError, sleepWithAbort } from './retry';
export type { CompleteWithRetryOptions, RetryReason } from './retry';

export { injectSkillsIntoMessages, formatSkillsForPrompt, filterActive } from './skill-injector';

// Tier 2 surface (not yet implemented):
//   structuredComplete<T>(model, schema, messages, opts): Promise<T>
//   streamArtifacts(model, messages, opts): AsyncIterable<ArtifactEvent>
//   streamWithFallback(models[], messages, opts)
//   completeWithRetry(model, messages, opts, { maxRetries, baseDelayMs })
//   completeWithPdf(pdfBase64, prompt, opts)
