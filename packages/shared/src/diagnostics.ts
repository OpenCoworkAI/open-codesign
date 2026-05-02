import type { ReasoningLevel, WireApi } from './config';

export type ErrorCode =
  | '401'
  | '402'
  | '403'
  | '404'
  | '429'
  | 'ECONNREFUSED'
  | 'ETIMEDOUT'
  | 'NETWORK'
  | 'CORS'
  | 'SSL'
  | 'PARSE'
  | 'IPC_BAD_INPUT'
  | string;

export type DiagnosticCategory =
  | 'auth'
  | 'billing'
  | 'missing-base-v1'
  | 'endpoint-not-found'
  | 'rate-limit'
  | 'network-unreachable'
  | 'network-timeout'
  | 'cors'
  | 'ssl'
  | 'wrong-wire'
  | 'unsupported-role'
  | 'reasoning-policy'
  | 'model-id-shape'
  | 'relay-stream-cutoff'
  | 'model-discovery-degraded'
  | 'transport-interrupted'
  | 'upstream-server-error'
  | 'reference-url-invalid'
  | 'reference-url-fetch-failed'
  | 'reference-url-fetch-timeout'
  | 'reference-url-too-large'
  | 'bad-input'
  | 'unknown';

export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export type DiagnosticFixKind =
  | 'baseUrlTransform'
  | 'externalUrl'
  | 'openSettings'
  | 'updateProvider'
  | 'switchWire'
  | 'setReasoning'
  | 'normalizeModelId';

export interface DiagnosticFix {
  /** i18n key for the button label */
  label: string;
  /** Stable action family used by renderer recovery buttons and reports. */
  kind?: DiagnosticFixKind;
  /** When present, clicking "Apply fix" calls this to derive a new baseUrl */
  baseUrlTransform?: (current: string) => string;
  /** When present, open this URL in the browser instead of mutating baseUrl */
  externalUrl?: string;
  /** Wire value to write through config:v1:update-provider for safe wire fixes. */
  wire?: WireApi;
  /** Reasoning override to write through config:v1:update-provider. */
  reasoningLevel?: ReasoningLevel | null;
  /** Model-id normalization for provider-specific prefix/shape mismatches. */
  modelIdTransform?: (current: string) => string;
  /** Preferred Settings tab when the fix is informational. */
  settingsTab?: 'models' | 'diagnostics' | 'advanced';
}

export interface DiagnosticHypothesis {
  /** i18n key for the displayed cause sentence */
  cause: string;
  /** Stable machine-readable category for tests, reports, and UI branching. */
  category?: DiagnosticCategory;
  /** User-facing severity for UI styling. */
  severity?: DiagnosticSeverity;
  /** Primary action the user should take */
  suggestedFix?: DiagnosticFix;
}

export interface DiagnoseContext {
  provider: string;
  baseUrl: string;
  /** HTTP status code if the error came from an HTTP response */
  status?: number;
  /** Raw attempted URL, if available */
  attemptedUrl?: string;
}

const BILLING_URLS: Record<string, string> = {
  openai: 'https://platform.openai.com/settings/organization/billing',
  anthropic: 'https://console.anthropic.com/settings/billing',
  openrouter: 'https://openrouter.ai/settings/credits',
  google: 'https://aistudio.google.com/app/apikey',
  deepseek: 'https://platform.deepseek.com/usage',
};

function billingUrlFor(provider: string): string | undefined {
  return BILLING_URLS[provider.toLowerCase()];
}

function h(input: DiagnosticHypothesis): DiagnosticHypothesis {
  return input;
}

function stripModelsPrefix(modelId: string): string {
  return modelId.replace(/^models\//, '');
}

/**
 * Map an ErrorCode + context to one or more DiagnosticHypothesis items.
 * The first item is the "most likely" cause; subsequent items are alternatives.
 */
export function diagnose(code: ErrorCode, ctx: DiagnoseContext): DiagnosticHypothesis[] {
  // Normalise the code — some callers pass the HTTP status as a string like "404"
  const normalised = String(code).toUpperCase();

  if (normalised === '401' || normalised === '403') {
    return [
      h({
        cause: 'diagnostics.cause.keyInvalid',
        category: 'auth',
        severity: 'error',
        suggestedFix: {
          kind: 'openSettings',
          label: 'diagnostics.fix.updateKey',
          settingsTab: 'models',
        },
      }),
    ];
  }

  if (normalised === '402') {
    const externalUrl = billingUrlFor(ctx.provider);
    return [
      h({
        cause: 'diagnostics.cause.balanceEmpty',
        category: 'billing',
        severity: 'error',
        suggestedFix: {
          kind: externalUrl ? 'externalUrl' : 'openSettings',
          label: externalUrl ? 'diagnostics.fix.addCredits' : 'diagnostics.fix.addCreditsGeneric',
          ...(externalUrl ? { externalUrl } : {}),
          ...(!externalUrl ? { settingsTab: 'models' as const } : {}),
        },
      }),
    ];
  }

  if (normalised === '404') {
    // If the baseUrl already encodes a version segment (/v1, /v4, /v1beta,
    // etc.), suggesting "add /v1" is wrong — Zhipu GLM uses /v4, AI Studio
    // uses /v1beta, and some Cloudflare Workers AI gateways already carry
    // /v1. A 404 on such endpoints usually means /models simply isn't
    // exposed, not that the path is malformed. Use the generic
    // hypothesis so the user isn't pushed into corrupting a correct baseUrl.
    const hasVersionSegment = /\/v\d+[a-z]*(?:\/|$)/i.test(ctx.baseUrl);
    if (hasVersionSegment) {
      return [
        h({
          cause: 'diagnostics.cause.endpointNotFound',
          category: 'endpoint-not-found',
          severity: 'warning',
        }),
      ];
    }
    return [
      h({
        cause: 'diagnostics.cause.missingV1',
        category: 'missing-base-v1',
        severity: 'warning',
        suggestedFix: {
          kind: 'baseUrlTransform',
          label: 'diagnostics.fix.addV1',
          baseUrlTransform: (cur: string) => {
            const cleaned = cur.replace(/\/+$/, '');
            return cleaned.endsWith('/v1') ? cleaned : `${cleaned}/v1`;
          },
        },
      }),
    ];
  }

  if (normalised === '429') {
    return [
      h({
        cause: 'diagnostics.cause.rateLimit',
        category: 'rate-limit',
        severity: 'warning',
        suggestedFix: { kind: 'openSettings', label: 'diagnostics.fix.waitAndRetry' },
      }),
    ];
  }

  if (normalised === 'ECONNREFUSED' || normalised === 'ENOTFOUND') {
    return [
      h({
        cause: 'diagnostics.cause.hostUnreachable',
        category: 'network-unreachable',
        severity: 'error',
        suggestedFix: { kind: 'openSettings', label: 'diagnostics.fix.checkNetwork' },
      }),
    ];
  }

  if (normalised === 'ETIMEDOUT') {
    return [
      h({
        cause: 'diagnostics.cause.timedOut',
        category: 'network-timeout',
        severity: 'warning',
        suggestedFix: {
          kind: 'openSettings',
          label: 'diagnostics.fix.checkVpn',
          settingsTab: 'advanced',
        },
      }),
    ];
  }

  if (normalised === 'CORS') {
    return [
      h({
        cause: 'diagnostics.cause.corsError',
        category: 'cors',
        severity: 'error',
        suggestedFix: { kind: 'openSettings', label: 'diagnostics.fix.reportBug' },
      }),
    ];
  }

  if (normalised === 'SSL') {
    return [
      h({
        cause: 'diagnostics.cause.sslError',
        category: 'ssl',
        severity: 'error',
        suggestedFix: {
          kind: 'openSettings',
          label: 'diagnostics.fix.disableTls',
          settingsTab: 'models',
        },
      }),
    ];
  }

  return [
    h({
      cause: 'diagnostics.cause.unknown',
      category: 'unknown',
      severity: 'error',
    }),
  ];
}

export interface GenerateFailureContext {
  /** Active provider ID at the time of failure. */
  provider: string;
  /** Per-provider baseUrl override. Empty / undefined means "vendor default". */
  baseUrl?: string;
  /** Wire protocol the request was sent over (anthropic / openai-chat / openai-responses). */
  wire?: string;
  /** HTTP status code, if the failure came from an HTTP response. */
  status?: number;
  /** Error message — inspected for heuristic hints (e.g. "page not found", "instructions"). */
  message?: string;
  /** CodesignError code, if available. */
  code?: string;
  /** Active model id, if available. */
  modelId?: string;
}

/**
 * Map a generate-time failure to the same DiagnosticHypothesis shape the
 * connection-test path uses, so renderer toast / panel code can render
 * identical "most likely cause + suggested fix" affordances.
 *
 * Cases covered today:
 *   - 400 with "instructions" in body → openai-responses misconfigured,
 *     suggest switching wire to openai-chat
 *   - 5xx with "not implemented" / "page not found" in body → gateway
 *     does not implement the upstream Messages API, suggest switching wire
 *   - 404 → delegates to diagnose('404') for the missing-/v1 hint
 *   - 401 / 402 / 403 / 429 → delegates to diagnose(String(status))
 *   - 404-shaped message even when no status is attached (e.g. a raw
 *     "404 page not found" body surfaced as message text)
 *   - openai-responses + custom baseUrl + truncated-stream error shape →
 *     relayStreamingBug (third-party gateway mishandles response.* SSE events, #180)
 *   - Everything else → generic unknown hypothesis
 */

function looksLikeTruncatedStream(message: string): boolean {
  return (
    /stream\s*(ended|closed)/i.test(message) ||
    /premature\s*close/i.test(message) ||
    /\bterminated\b/i.test(message) ||
    /ECONNRESET/i.test(message) ||
    /aborted/i.test(message)
  );
}

function isCustomBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host !== 'api.openai.com' && !host.endsWith('.openai.com');
  } catch {
    return false;
  }
}

export function diagnoseGenerateFailure(ctx: GenerateFailureContext): DiagnosticHypothesis[] {
  const message = (ctx.message ?? '').toLowerCase();
  const status = ctx.status;
  const code = ctx.code;

  if (code === 'REFERENCE_URL_UNSUPPORTED') {
    return [
      h({
        cause: 'diagnostics.cause.referenceUrlInvalid',
        category: 'reference-url-invalid',
        severity: 'warning',
        suggestedFix: {
          kind: 'openSettings',
          label: 'diagnostics.fix.checkReferenceUrl',
        },
      }),
    ];
  }
  if (code === 'REFERENCE_URL_FETCH_TIMEOUT') {
    return [
      h({
        cause: 'diagnostics.cause.referenceUrlTimeout',
        category: 'reference-url-fetch-timeout',
        severity: 'warning',
        suggestedFix: {
          kind: 'openSettings',
          label: 'diagnostics.fix.checkReferenceUrl',
        },
      }),
    ];
  }
  if (code === 'REFERENCE_URL_FETCH_FAILED') {
    return [
      h({
        cause: 'diagnostics.cause.referenceUrlFetchFailed',
        category: 'reference-url-fetch-failed',
        severity: 'warning',
        suggestedFix: {
          kind: 'openSettings',
          label: 'diagnostics.fix.checkReferenceUrl',
        },
      }),
    ];
  }
  if (code === 'REFERENCE_URL_TOO_LARGE') {
    return [
      h({
        cause: 'diagnostics.cause.referenceUrlTooLarge',
        category: 'reference-url-too-large',
        severity: 'warning',
        suggestedFix: {
          kind: 'openSettings',
          label: 'diagnostics.fix.checkReferenceUrl',
        },
      }),
    ];
  }

  if (/model\s+['"]?models\//i.test(ctx.message ?? '')) {
    return [
      h({
        cause: 'diagnostics.cause.modelIdShape',
        category: 'model-id-shape',
        severity: 'warning',
        suggestedFix: {
          kind: 'normalizeModelId',
          label: 'diagnostics.fix.normalizeModelId',
          modelIdTransform: stripModelsPrefix,
        },
      }),
    ];
  }

  if (message.includes('reasoning_content')) {
    return [
      h({
        cause: 'diagnostics.cause.reasoningPolicy',
        category: 'reasoning-policy',
        severity: 'warning',
        suggestedFix: {
          kind: 'setReasoning',
          label: 'diagnostics.fix.disableReasoning',
          reasoningLevel: 'off',
        },
      }),
    ];
  }

  if (
    (status === 400 || status === 422) &&
    message.includes('developer') &&
    message.includes('role') &&
    message.includes('system')
  ) {
    return [
      h({
        cause: 'diagnostics.cause.unsupportedRole',
        category: 'unsupported-role',
        severity: 'warning',
        suggestedFix: {
          kind: 'switchWire',
          label: 'diagnostics.fix.switchWire',
          wire: 'openai-chat',
        },
      }),
    ];
  }

  // Third-party relay bug: openai-responses wire pointed at a custom gateway
  // that mishandles `response.*` SSE events, causing the stream to die with
  // no HTTP status — only a transport-level "terminated" / "premature close".
  if (
    status === undefined &&
    ctx.wire === 'openai-responses' &&
    isCustomBaseUrl(ctx.baseUrl) &&
    looksLikeTruncatedStream(message)
  ) {
    return [
      h({
        cause: 'diagnostics.cause.relayStreamingBug',
        category: 'relay-stream-cutoff',
        severity: 'warning',
        suggestedFix: {
          kind: 'openSettings',
          label: 'diagnostics.fix.relayStreamingBug',
          settingsTab: 'models',
        },
      }),
    ];
  }

  if (
    status === undefined &&
    (looksLikeTruncatedStream(message) || message.includes('connection error'))
  ) {
    return [
      h({
        cause: 'diagnostics.cause.transportInterrupted',
        category: 'transport-interrupted',
        severity: 'warning',
        suggestedFix: {
          kind: 'openSettings',
          label: 'diagnostics.fix.checkNetwork',
          settingsTab: 'advanced',
        },
      }),
    ];
  }

  if (status === 400 && message.includes('instructions')) {
    return [
      h({
        cause: 'diagnostics.cause.openaiResponsesMisconfigured',
        category: 'wrong-wire',
        severity: 'warning',
        suggestedFix: {
          kind: 'switchWire',
          label: 'diagnostics.fix.switchWire',
          wire: 'openai-chat',
        },
      }),
    ];
  }

  if (status !== undefined && status >= 500 && status < 600) {
    if (
      message.includes('not implemented') ||
      message.includes('page not found') ||
      message.includes('404 page')
    ) {
      return [
        h({
          cause: 'diagnostics.cause.gatewayIncompatible',
          category: 'wrong-wire',
          severity: 'warning',
          suggestedFix: {
            kind: 'switchWire',
            label: 'diagnostics.fix.switchWire',
            wire: 'openai-chat',
          },
        }),
      ];
    }
    return [
      h({
        cause: 'diagnostics.cause.serverError',
        category: 'upstream-server-error',
        severity: 'warning',
        suggestedFix: { kind: 'openSettings', label: 'diagnostics.fix.waitAndRetry' },
      }),
    ];
  }

  if (status !== undefined) {
    return diagnose(String(status), {
      provider: ctx.provider,
      baseUrl: ctx.baseUrl ?? '',
    });
  }

  // No status attached — the Win11 gateway case surfaces as a plain
  // "404 page not found" message with no HTTP metadata. Use
  // pattern-matching so #130 reaches a helpful hypothesis anyway.
  if (message.includes('404') && message.includes('page not found')) {
    return diagnose('404', {
      provider: ctx.provider,
      baseUrl: ctx.baseUrl ?? '',
    });
  }

  return [h({ cause: 'diagnostics.cause.unknown', category: 'unknown', severity: 'error' })];
}
