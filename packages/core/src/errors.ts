/**
 * Provider-aware error remapping.
 *
 * Upstream SDKs (pi-ai, OpenAI client, etc.) embed an OpenAI key-help URL in
 * 4xx error messages — even when the *active* provider is something else
 * (e.g. DeepSeek behind an OpenAI-compatible base URL, or OpenRouter). That
 * URL is misleading: clicking it sends the user to the wrong dashboard.
 *
 * We rewrite leaked openai.com URLs in 4xx upstream messages to the active
 * provider's billing/key-help URL. Unknown providers get the URL stripped and
 * a generic hint appended.
 *
 * This runs only on 4xx errors. 5xx and network errors pass through verbatim
 * because their messages are usually already provider-neutral and the retry
 * layer logs them with `reason`.
 */

import type { ProviderId } from '@open-codesign/shared';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';

export const PROVIDER_KEY_HELP_URL: Partial<Record<ProviderId, string>> = {
  openai: 'https://platform.openai.com/account/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  openrouter: 'https://openrouter.ai/settings/keys',
  google: 'https://aistudio.google.com/app/apikey',
};

// deepseek is not in the ProviderId enum yet but commonly used via openai-
// compatible base URL — keyed by string so callers passing a free-form string
// still get the rewrite. Kept separate so the typed map stays exhaustive-checked.
const EXTRA_KEY_HELP_URL: Record<string, string> = {
  deepseek: 'https://platform.deepseek.com/api_keys',
};

const OPENAI_URL_PATTERN = /https?:\/\/(?:platform\.openai\.com|openai\.com)\/[^\s)<>"']*/gi;
const GENERIC_HINT = "Check your provider's API key settings.";

function statusFromError(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const candidates = [
    (err as { status?: unknown }).status,
    (err as { statusCode?: unknown }).statusCode,
    (err as { response?: { status?: unknown } }).response?.status,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  if (err instanceof Error) {
    const m = /\b(\d{3})\b/.exec(err.message);
    if (m?.[1]) {
      const n = Number(m[1]);
      if (n >= 400 && n < 600) return n;
    }
  }
  return undefined;
}

function lookupKeyHelpUrl(provider: string | undefined): string | undefined {
  if (!provider) return undefined;
  const typed = PROVIDER_KEY_HELP_URL[provider as ProviderId];
  if (typed) return typed;
  return EXTRA_KEY_HELP_URL[provider];
}

export interface RewriteResult {
  message: string;
  rewritten: boolean;
  status?: number;
}

export function rewriteUpstreamMessage(
  rawMessage: string,
  provider: string | undefined,
  status: number | undefined,
): RewriteResult {
  const result: RewriteResult = { message: rawMessage, rewritten: false };
  if (status !== undefined) result.status = status;
  if (status === undefined || status < 400 || status >= 500) return result;
  if (!OPENAI_URL_PATTERN.test(rawMessage)) {
    OPENAI_URL_PATTERN.lastIndex = 0;
    return result;
  }
  OPENAI_URL_PATTERN.lastIndex = 0;
  const target = lookupKeyHelpUrl(provider);
  if (provider === 'openai') return result;
  if (target) {
    result.message = rawMessage.replace(OPENAI_URL_PATTERN, target);
  } else {
    const stripped = rawMessage.replace(OPENAI_URL_PATTERN, '').replace(/\s+/g, ' ').trim();
    result.message = `${stripped} ${GENERIC_HINT}`.trim();
  }
  result.rewritten = true;
  return result;
}

/**
 * Wrap an upstream error so its message is safe to surface to the user. Only
 * 4xx errors are rewritten — everything else is rethrown unchanged so the
 * retry/network layer keeps its own taxonomy.
 */
export function remapProviderError(err: unknown, provider: string | undefined): unknown {
  if (!(err instanceof Error)) return err;
  if (err instanceof CodesignError && err.code === ERROR_CODES.PROVIDER_ABORTED) return err;
  const status = statusFromError(err);
  if (status === undefined || status < 400 || status >= 500) return err;
  const { message, rewritten } = rewriteUpstreamMessage(err.message, provider, status);
  if (!rewritten) return err;
  const code = err instanceof CodesignError ? err.code : ERROR_CODES.PROVIDER_HTTP_4XX;
  return new CodesignError(message, code, { cause: err });
}
