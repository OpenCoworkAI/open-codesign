/**
 * Wrappers around @mariozechner/pi-ai that fill capability gaps documented
 * in docs/research/05-pi-ai-boundary.md. App code MUST go through this
 * package - never import a provider SDK directly.
 *
 * Tier 1 implementations: minimum viable. Tier 2 features tracked separately.
 */

import {
  type ChatMessage,
  CodesignError,
  ERROR_CODES,
  type ModelRef,
  type WireApi,
} from '@open-codesign/shared';
import {
  claudeCodeIdentityHeaders,
  looksLikeClaudeOAuthToken,
  shouldForceClaudeCodeIdentity,
} from './claude-code-compat';

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
  /** v3 wire override — when set, a synthetic PiModel is constructed so
   *  custom endpoints (DeepSeek, Ollama, LiteLLM, Azure, …) route through
   *  the correct pi-ai adapter even if the provider id isn't in pi-ai's
   *  registry. */
  wire?: WireApi;
  /** Extra HTTP headers (merged last). Supports Codex-style static headers
   *  for gateways that require custom auth keys. */
  httpHeaders?: Record<string, string>;
  userImages?: Array<{ data: string; mimeType: string }>;
  /**
   * Allow OpenAI-compatible keyless gateways. The upstream SDK still requires
   * a non-empty apiKey string to instantiate its client, so this uses a local
   * placeholder while auth is supplied by `httpHeaders` or by the gateway.
   */
  allowKeyless?: boolean;
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

interface PiImageContent {
  type: 'image';
  data: string;
  mimeType: string;
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
  content: string | (PiTextContent | PiImageContent)[];
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

const MAX_TOTAL_CODEX_IMAGE_BYTES = 4_000_000;

/**
 * Synthesize a PiModel for a wire + custom baseUrl so custom provider ids
 * (DeepSeek, Ollama, LiteLLM, Azure, …) route to the correct pi-ai adapter
 * without being in pi-ai's model registry.
 */
function synthesizeWireModel(
  provider: string,
  modelId: string,
  wire: GenerateOptions['wire'],
  baseUrl: string | undefined,
): PiModel {
  const supportsImageInput = wire === 'openai-codex-responses';
  const api =
    wire === 'anthropic'
      ? 'anthropic-messages'
      : wire === 'openai-responses'
        ? 'openai-responses'
        : wire === 'openai-codex-responses'
          ? 'openai-codex-responses'
          : 'openai-completions';
  const base: PiModel = {
    id: modelId,
    name: modelId,
    api,
    provider,
    reasoning: true,
    input: supportsImageInput ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131072,
    maxTokens: 131072,
  };
  if (baseUrl !== undefined) base.baseUrl = baseUrl;
  return base;
}

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
  if (!opts.apiKey && opts.allowKeyless !== true) {
    throw new CodesignError('Missing API key', ERROR_CODES.PROVIDER_AUTH_MISSING);
  }
  const apiKey = opts.apiKey || 'open-codesign-keyless';

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
        headers?: Record<string, string>;
      },
    ) => Promise<PiAssistantMessage>;
  };

  let piModel = pi.getModel(model.provider, model.modelId);
  if (!piModel) {
    if (opts.wire !== undefined) {
      piModel = synthesizeWireModel(model.provider, model.modelId, opts.wire, opts.baseUrl);
    } else if (model.provider === 'openrouter') {
      piModel = synthesizeOpenRouterModel(model.modelId);
    } else {
      throw new CodesignError(
        `Unknown model ${model.provider}:${model.modelId}`,
        ERROR_CODES.PROVIDER_MODEL_UNKNOWN,
      );
    }
  }

  const piOpts: {
    apiKey: string;
    baseUrl?: string;
    signal?: AbortSignal;
    maxTokens?: number;
    reasoning?: ReasoningLevel;
    headers?: Record<string, string>;
  } = {
    apiKey,
  };
  if (opts.baseUrl !== undefined) piOpts.baseUrl = opts.baseUrl;
  if (opts.signal !== undefined) piOpts.signal = opts.signal;
  if (opts.maxTokens !== undefined) piOpts.maxTokens = opts.maxTokens;
  if (opts.reasoning !== undefined) piOpts.reasoning = opts.reasoning;
  if (opts.httpHeaders !== undefined) piOpts.headers = { ...opts.httpHeaders };

  // sub2api / claude2api gateways 403 requests without claude-cli identity
  // headers. pi-ai only injects those on OAuth tokens — paste a
  // sub2api-issued key and you hit the plain API-key branch. Force the
  // identity headers for custom anthropic endpoints so the WAF admits us.
  // User-supplied httpHeaders keep precedence.
  if (
    shouldForceClaudeCodeIdentity(opts.wire, opts.baseUrl) &&
    !looksLikeClaudeOAuthToken(apiKey)
  ) {
    piOpts.headers = { ...claudeCodeIdentityHeaders(), ...(piOpts.headers ?? {}) };
  }

  validateCodexImageInputs(opts);
  const result = await pi.completeSimple(piModel, toPiContext(messages, piModel, opts), piOpts);

  if (result.stopReason === 'error') {
    throw new CodesignError(
      result.errorMessage ?? 'Provider returned an error',
      ERROR_CODES.PROVIDER_ERROR,
    );
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

function validateCodexImageInputs(opts: GenerateOptions): void {
  if (opts.wire !== 'openai-codex-responses' || (opts.userImages?.length ?? 0) === 0) return;
  const totalImageBytes = (opts.userImages ?? []).reduce((sum, image) => {
    // Count trailing = padding to avoid regex ReDoS warning from CodeQL
    // base64: 4 chars -> 3 bytes, each = padding represents 1 byte less
    let len = image.data.length;
    if (len >= 2 && image.data[len - 1] === '=' && image.data[len - 2] === '=') {
      len -= 2;
    } else if (len >= 1 && image.data[len - 1] === '=') {
      len -= 1;
    }
    return sum + Math.floor((len * 3) / 4);
  }, 0);
  if (totalImageBytes > MAX_TOTAL_CODEX_IMAGE_BYTES) {
    throw new CodesignError(
      'Attached images are too large in total for ChatGPT Codex. Reduce image count or image size.',
      ERROR_CODES.ATTACHMENT_TOO_LARGE,
    );
  }
}

function toPiContext(messages: ChatMessage[], model: PiModel, opts: GenerateOptions): PiContext {
  const systemPrompt = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter((content) => content.length > 0)
    .join('\n\n');
  const userImages = opts.userImages ?? [];

  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      lastUserIndex = index;
      break;
    }
  }

  return {
    ...(systemPrompt.length > 0 ? { systemPrompt } : {}),
    messages: messages.flatMap((message, index) => {
      const timestamp = index + 1;

      if (message.role === 'system') {
        return [];
      }

      if (message.role === 'user') {
        if (index === lastUserIndex && userImages.length > 0) {
          return {
            role: 'user',
            content: [
              { type: 'text', text: message.content },
              ...userImages.map((image) => ({
                type: 'image' as const,
                data: image.data,
                mimeType: image.mimeType,
              })),
            ],
            timestamp,
          };
        }
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

export {
  claudeCodeIdentityHeaders,
  isOfficialAnthropicBaseUrl,
  looksLikeClaudeOAuthToken,
  shouldForceClaudeCodeIdentity,
  withClaudeCodeIdentity,
} from './claude-code-compat';

export { completeWithRetry, classifyError, sleepWithAbort } from './retry';
export type { CompleteWithRetryOptions, RetryReason } from './retry';

export { injectSkillsIntoMessages, formatSkillsForPrompt, filterActive } from './skill-injector';

// Tier 2 surface (not yet implemented):
//   structuredComplete<T>(model, schema, messages, opts): Promise<T>
//   streamArtifacts(model, messages, opts): AsyncIterable<ArtifactEvent>
//   streamWithFallback(models[], messages, opts)
//   completeWithRetry(model, messages, opts, { maxRetries, baseDelayMs })
//   completeWithPdf(pdfBase64, prompt, opts)
