/**
 * Wrappers around @mariozechner/pi-ai that fill capability gaps documented
 * in docs/research/05-pi-ai-boundary.md. App code MUST go through this
 * package — never import a provider SDK directly.
 *
 * Tier 1 implementations: minimum viable. Tier 2 features tracked separately.
 */

import { type ChatMessage, CodesignError, type ModelRef } from '@open-codesign/shared';

export interface GenerateOptions {
  apiKey: string;
  baseUrl?: string;
  signal?: AbortSignal;
}

export interface GenerateResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
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
  if (!opts.apiKey) {
    throw new CodesignError('Missing API key', 'PROVIDER_AUTH_MISSING');
  }

  const pi = (await import('@mariozechner/pi-ai')) as unknown as {
    getModel: (provider: string, modelId: string) => unknown;
    completeSimple: (
      model: unknown,
      context: { messages: ChatMessage[] },
      opts: { apiKey: string; baseUrl?: string; signal?: AbortSignal },
    ) => Promise<{
      stopReason?: string;
      errorMessage?: string;
      content: Array<{ type: string; text?: string }>;
      usage?: { input?: number; output?: number; cost?: { total?: number } };
    }>;
  };

  const piModel = pi.getModel(model.provider, model.modelId);
  if (!piModel) {
    throw new CodesignError(
      `Unknown model ${model.provider}:${model.modelId}`,
      'PROVIDER_MODEL_UNKNOWN',
    );
  }

  const piOpts: { apiKey: string; baseUrl?: string; signal?: AbortSignal } = {
    apiKey: opts.apiKey,
  };
  if (opts.baseUrl !== undefined) piOpts.baseUrl = opts.baseUrl;
  if (opts.signal !== undefined) piOpts.signal = opts.signal;

  const result = await pi.completeSimple(piModel, { messages }, piOpts);

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

export { classifyError, completeWithRetry, sleepWithAbort } from './retry';
export type { CompleteWithRetryOptions, RetryReason } from './retry';

// Tier 2 surface (not yet implemented):
//   structuredComplete<T>(model, schema, messages, opts): Promise<T>
//   streamArtifacts(model, messages, opts): AsyncIterable<ArtifactEvent>
//   streamWithFallback(models[], messages, opts)
//   completeWithPdf(pdfBase64, prompt, opts)
